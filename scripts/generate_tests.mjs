#!/usr/bin/env node

/**
 * Programmatic LLM-Based Test Generator
 * Senior SDET Challenge - PayMongo
 * 
 * Generates Playwright API & Web E2E tests using Gemini LLM
 * with built-in AST syntax validation guardrails and error handling.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from '../playwright_template/node_modules/typescript/lib/typescript.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to extract environment variable from .env or process.env
function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GEMINI_APIKEY) return process.env.GEMINI_APIKEY;

  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/GEMINI_API(?:KEY|_KEY)=["']?([^"'\r\n]+)["']?/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  throw new Error('GEMINI_API_KEY is not defined in process.env or .env file');
}

// Clean markdown fences and extract raw TS code
function extractCode(rawOutput) {
  let text = rawOutput.trim();

  // If there is a complete code block, extract it
  const codeBlockMatch = text.match(/```(?:typescript|ts|javascript|js)?\r?\n([\s\S]*?)```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  // If there is an opening fence without closing fence
  const openFenceMatch = text.match(/```(?:typescript|ts|javascript|js)?\r?\n([\s\S]*)/i);
  if (openFenceMatch && openFenceMatch[1]) {
    return openFenceMatch[1].replace(/\s*```$/, '').trim();
  }

  // Fallback: strip leading and trailing fences
  text = text.replace(/^```(?:typescript|ts|javascript|js)?\s*/i, '');
  text = text.replace(/\s*```$/i, '');
  return text.trim();
}

// Guardrail: TypeScript AST syntax validator
function validateTypeScriptAST(code, type = 'API') {
  if (!code || code.length < 50) {
    throw new Error(`Generated ${type} test code is suspiciously empty.`);
  }

  // Parse code into AST to detect syntax errors
  const sourceFile = ts.createSourceFile(
    `temp-${type}.spec.ts`,
    code,
    ts.ScriptTarget.Latest,
    true
  );

  const diagnostics = sourceFile.parseDiagnostics || [];
  if (diagnostics.length > 0) {
    const errorMessages = diagnostics.slice(0, 3).map(d => {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
      return `Line ${line + 1}:${character + 1} - ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
    throw new Error(`TypeScript syntax validation failed for ${type} test:\n${errorMessages.join('\n')}`);
  }

  // Structural sanity checks
  if (!code.includes('@playwright/test')) {
    throw new Error(`Generated ${type} test is missing '@playwright/test' import.`);
  }
  if (!code.includes('test(') && !code.includes('test.describe(')) {
    throw new Error(`Generated ${type} test contains no Playwright test definitions.`);
  }

  console.log(`🛡️  Guardrail Passed: ${type} test is valid TypeScript without syntax errors.`);
  return true;
}

// Call Gemini API with retry and fallback
async function callGemini(apiKey, systemInstruction, prompt, model = 'gemini-3.5-flash-lite', retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const payload = {
    contents: [
      {
        parts: [
          { text: `${systemInstruction}\n\n${prompt}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 8192
    }
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[LLM] Requesting ${model} (attempt ${attempt}/${retries})...`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) {
        throw new Error('Empty response received from Gemini API');
      }

      return content;
    } catch (err) {
      console.warn(`[LLM Warning] Attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
}

// Generate with automated validation and retry on syntax failure
async function generateWithGuardrails(apiKey, systemInstruction, prompt, type) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const rawOutput = await callGemini(apiKey, systemInstruction, prompt);
      const cleanCode = extractCode(rawOutput);
      validateTypeScriptAST(cleanCode, type);
      return cleanCode;
    } catch (err) {
      console.warn(`⚠️ Guardrail caught an issue on attempt ${attempt} for ${type}: ${err.message}`);
      if (attempt === maxAttempts) {
        throw new Error(`Failed to generate valid ${type} tests after ${maxAttempts} attempts: ${err.message}`);
      }
      console.log(`🔄 Retrying ${type} test generation...`);
    }
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function main() {
  console.log('====================================================');
  console.log('🚀 Starting Programmatic LLM-Based Test Generation');
  console.log('====================================================');

  const apiKey = getApiKey();
  console.log('🔑 Gemini API key loaded securely.');

  // 1. Generate API Tests
  console.log('\n--- Step 1: Generating API Tests from Swagger Spec ---');
  const apiPromptTemplate = fs.readFileSync(path.join(__dirname, 'prompts', 'api-prompt.txt'), 'utf8');
  const swaggerSpec = fs.readFileSync(path.join(rootDir, 'application_code', 'docs', 'swagger.yaml'), 'utf8');
  const fullApiPrompt = `${apiPromptTemplate}\n\n=== SWAGGER / OPENAPI SPECIFICATION ===\n${swaggerSpec}`;

  const cleanApiCode = await generateWithGuardrails(
    apiKey,
    'You are an expert SDET generating Playwright API tests in TypeScript. Output ONLY the test code inside a single ```typescript markdown fence without preamble or explanation.',
    fullApiPrompt,
    'API'
  );

  const playwrightApiDest = path.join(rootDir, 'playwright_template', 'tests', 'api', 'generated-api.spec.ts');
  const submissionApiDest = path.join(rootDir, 'generated_test', 'api', 'generated-api.spec.ts');
  ensureDir(path.dirname(playwrightApiDest));
  ensureDir(path.dirname(submissionApiDest));
  fs.writeFileSync(playwrightApiDest, cleanApiCode, 'utf8');
  fs.writeFileSync(submissionApiDest, cleanApiCode, 'utf8');
  console.log(`✅ Saved API tests to: ${playwrightApiDest}`);
  console.log(`✅ Mirrored API tests to: ${submissionApiDest}`);

  // 2. Generate Web E2E Tests
  console.log('\n--- Step 2: Generating Web E2E Tests from Frontend Component ---');
  const webPromptTemplate = fs.readFileSync(path.join(__dirname, 'prompts', 'web-prompt.txt'), 'utf8');
  const pageComponent = fs.readFileSync(path.join(rootDir, 'application_code', 'app', 'page.tsx'), 'utf8');
  const fullWebPrompt = `${webPromptTemplate}\n\n=== FRONTEND NEXT.JS COMPONENT (page.tsx) ===\n${pageComponent}`;

  const cleanWebCode = await generateWithGuardrails(
    apiKey,
    'You are an expert SDET generating Playwright Web E2E tests in TypeScript. Output ONLY the test code inside a single ```typescript markdown fence without preamble or explanation. Ensure all blocks and parentheses are properly closed.',
    fullWebPrompt,
    'Web E2E'
  );

  const playwrightWebDest = path.join(rootDir, 'playwright_template', 'tests', 'web', 'generated-web.spec.ts');
  const submissionWebDest = path.join(rootDir, 'generated_test', 'web', 'generated-web.spec.ts');
  ensureDir(path.dirname(playwrightWebDest));
  ensureDir(path.dirname(submissionWebDest));
  fs.writeFileSync(playwrightWebDest, cleanWebCode, 'utf8');
  fs.writeFileSync(submissionWebDest, cleanWebCode, 'utf8');
  console.log(`✅ Saved Web E2E tests to: ${playwrightWebDest}`);
  console.log(`✅ Mirrored Web E2E tests to: ${submissionWebDest}`);

  console.log('\n🎉 Test generation completed successfully with AST guardrails verified!');
}

main().catch(err => {
  console.error('\n❌ Fatal Test Generation Error:', err.message);
  process.exit(1);
});
