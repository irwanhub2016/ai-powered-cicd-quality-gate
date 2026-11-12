import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  computeInputHash,
  inspectGenerationCache,
  writeGenerationCache
} from './generation_cache.mjs';

function createFixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paymongo-test-cache-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  const manifestPath = path.join(rootDir, '.cache', 'manifest.json');
  const artifactPath = path.join(rootDir, 'generated.spec.ts');
  fs.writeFileSync(artifactPath, 'generated test content');

  return { rootDir, manifestPath, artifactPath };
}

test('input fingerprint changes when generation inputs or config changes', t => {
  const { rootDir } = createFixture(t);
  const inputPath = path.join(rootDir, 'spec.json');
  fs.writeFileSync(inputPath, '{"version":1}');

  const originalHash = computeInputHash(rootDir, ['spec.json'], { temperature: 0.1 });
  assert.equal(computeInputHash(rootDir, ['spec.json'], { temperature: 0.1 }), originalHash);
  assert.notEqual(computeInputHash(rootDir, ['spec.json'], { temperature: 0.2 }), originalHash);

  fs.writeFileSync(inputPath, '{"version":2}');
  assert.notEqual(computeInputHash(rootDir, ['spec.json'], { temperature: 0.1 }), originalHash);
});

test('reuses outputs only when fingerprint, output checksums, and validation pass', t => {
  const { manifestPath, artifactPath } = createFixture(t);
  const artifacts = { generatedTest: artifactPath };
  writeGenerationCache(manifestPath, 'input-hash', artifacts);

  const validation = contents => {
    assert.equal(contents.generatedTest, 'generated test content');
  };
  assert.deepEqual(
    inspectGenerationCache(manifestPath, 'input-hash', artifacts, validation),
    { hit: true }
  );
  assert.equal(
    inspectGenerationCache(manifestPath, 'changed-input-hash', artifacts, validation).hit,
    false
  );

  fs.writeFileSync(artifactPath, 'manually modified test');
  assert.equal(inspectGenerationCache(manifestPath, 'input-hash', artifacts, validation).hit, false);
});

test('treats missing or invalid cached output as a cache miss', t => {
  const { rootDir, manifestPath, artifactPath } = createFixture(t);
  const artifacts = { generatedTest: artifactPath };
  assert.equal(inspectGenerationCache(manifestPath, 'input-hash', artifacts, () => {}).hit, false);

  writeGenerationCache(manifestPath, 'input-hash', artifacts);
  assert.equal(
    inspectGenerationCache(manifestPath, 'input-hash', artifacts, () => {
      throw new Error('schema mismatch');
    }).hit,
    false
  );

  fs.rmSync(artifactPath);
  assert.equal(inspectGenerationCache(manifestPath, 'input-hash', artifacts, () => {}).hit, false);
  assert.ok(fs.existsSync(rootDir));
});
