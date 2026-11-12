import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateApiTestSemantics, validateTypeScriptAST } from './test_guardrails.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'application_code/docs/swagger.json'), 'utf8')
);
const apiTest = fs.readFileSync(
  path.join(rootDir, 'playwright_template/tests/api/generated-api.spec.ts'),
  'utf8'
);

test('accepts generated API tests whose paths, statuses, and response fields match Swagger', () => {
  assert.doesNotThrow(() => validateTypeScriptAST(apiTest));
  assert.doesNotThrow(() => validateApiTestSemantics(apiTest, spec));
});

test('rejects endpoints that are not declared in Swagger', () => {
  const invalidTest = apiTest.replace(
    "request.get('/api/health')",
    "request.get('/api/not-documented')"
  );
  assert.throws(() => validateApiTestSemantics(invalidTest, spec), /not defined in Swagger/);
});

test('rejects response status codes that are not declared for the endpoint', () => {
  const invalidTest = apiTest.replace(
    "const response = await request.get('/api/health');\n    expect(response.status()).toBe(200);",
    "const response = await request.get('/api/health');\n    expect(response.status()).toBe(503);"
  );
  assert.throws(() => validateApiTestSemantics(invalidTest, spec), /503.*not declared in Swagger/);
});

test('rejects response fields and types that do not match the Swagger schema', () => {
  const invalidFieldTest = apiTest.replace(
    "expect(body).toHaveProperty('status', 'healthy');",
    "expect(body).toHaveProperty('madeUpField', 'healthy');"
  );
  assert.throws(
    () => validateApiTestSemantics(invalidFieldTest, spec),
    /response property "madeUpField" is not declared/
  );

  const invalidTypeTest = apiTest.replace(
    "expect(typeof body.status).toBe('string');",
    "expect(typeof body.status).toBe('boolean');"
  );
  assert.throws(
    () => validateApiTestSemantics(invalidTypeTest, spec),
    /"status" is asserted as boolean, but Swagger declares string/
  );
});
