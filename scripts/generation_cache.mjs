import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_VERSION = 1;

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function computeInputHash(rootDir, inputFiles, config) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(config));
  hash.update('\0');

  for (const relativePath of [...inputFiles].sort()) {
    const contents = fs.readFileSync(path.join(rootDir, relativePath));
    hash.update(`${relativePath}\0${contents.length}\0`);
    hash.update(contents);
    hash.update('\0');
  }

  return hash.digest('hex');
}

export function inspectGenerationCache(manifestPath, inputHash, artifacts, validate) {
  if (!fs.existsSync(manifestPath)) {
    return { hit: false, reason: 'cache manifest not found' };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { hit: false, reason: 'cache manifest is invalid JSON' };
    }
    throw error;
  }

  if (manifest.version !== CACHE_VERSION || manifest.inputHash !== inputHash) {
    return { hit: false, reason: 'generator inputs have changed' };
  }

  const contents = {};
  for (const [name, artifactPath] of Object.entries(artifacts)) {
    if (!fs.existsSync(artifactPath)) {
      return { hit: false, reason: `cached output is missing: ${name}` };
    }
    const content = fs.readFileSync(artifactPath, 'utf8');
    if (manifest.outputHashes?.[name] !== hashContent(content)) {
      return { hit: false, reason: `cached output has changed: ${name}` };
    }
    contents[name] = content;
  }

  try {
    validate(contents);
  } catch (error) {
    return { hit: false, reason: `cached output failed validation: ${error.message}` };
  }

  return { hit: true };
}

export function writeGenerationCache(manifestPath, inputHash, artifacts) {
  const outputHashes = {};
  for (const [name, artifactPath] of Object.entries(artifacts)) {
    outputHashes[name] = hashContent(fs.readFileSync(artifactPath));
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify({ version: CACHE_VERSION, inputHash, outputHashes }, null, 2)}\n`,
    'utf8'
  );
  fs.renameSync(temporaryPath, manifestPath);
}
