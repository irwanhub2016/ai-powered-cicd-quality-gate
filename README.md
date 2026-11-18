# AI-Driven API Automation & CI Quality Gate Challenge

---

## 📑 Table of Contents
1. [Overview & Architecture](#-overview--architecture)
2. [Project & Submission Layout](#-project--submission-layout)
3. [Quick Start & Local Execution](#-quick-start--local-execution)
4. [Secret Management & Security](#-secret-management--security)
5. [Technical Deep Dive (Assessment Requirements)](#-technical-deep-dive)
   - [1. LLM Prompt Design](#1-llm-prompt-design)
   - [2. How Swagger is Translated into Playwright Tests](#2-how-swagger-is-translated-into-playwright-tests)
   - [3. How the Generation Process Works](#3-how-the-generation-process-works)
   - [4. How CI Gates Production](#4-how-ci-gates-production)
   - [5. Scaling to Hundreds of Endpoints](#5-scaling-to-hundreds-of-endpoints)
   - [6. Preventing & Detecting Hallucinated / Incorrect AI Tests](#6-preventing--detecting-hallucinated--incorrect-ai-tests)
   - [7. Handling Flaky or Unstable Tests](#7-handling-flaky-or-unstable-tests)
   - [8. E2E Selector Generation & Stability](#8-e2e-selector-generation--stability)
   - [9. Preventing Flaky Frontend Tests](#9-preventing-flaky-frontend-tests)
6. [Bonus Implementations](#-bonus-implementations)
7. [Sample Test Execution (Local)](#-sample-test-execution-local)
8. [CI Quality Gate Evidence](#-ci-quality-gate-evidence)

---

## 🏗 Overview & Architecture

This solution integrates **Generative AI directly into a CI/CD Quality Gate pipeline**. Rather than treating LLMs as offline developer chatbots, the pipeline uses Gemini programmatically with AST and Swagger guardrails to generate Playwright API and E2E tests from an OpenAPI 2.0 specification and React frontend component. These checks reduce risk but do not prove generated tests are behaviorally correct.

```
                    ┌────────────────────────┐
                    │ application_code/      │
                    │ ├── docs/swagger.json │
                    │ └── app/page.tsx       │
                    └───────────┬────────────┘
                                │ Ingested by
                                ▼
                    ┌────────────────────────┐
                    │ scripts/               │
                    │ ├── generate_tests.mjs │ ◄── [GEMINI_API_KEY]
                    │ └── prompts/           │
                    └───────────┬────────────┘
                                │ Calls Gemini (temp=0.1)
                                ▼
                    ┌────────────────────────┐
                    │ AST + Swagger          │
                    │ Guardrails             │ ──► [Auto-Retry on Error]
                    └───────────┬────────────┘
                                │ Verified Code
                                ▼
                    ┌────────────────────────┐
                    │ playwright_template/   │
                    │ └── tests/             │
                    │     ├── api/generated  │
                    │     └── web/generated  │
                    └───────────┬────────────┘
                                │ Executed by
                                ▼
         ┌──────────────────────────────────────────────────┐
         │ Playwright Test Runner (CI / Local)             │
         │  ├── Target: Go Backend (:8080)                 │
         │  └── Target: Next.js Frontend (:3000)           │
         │  └── Quality Gate: Pass ──► Eligible to Merge   │
         │  └── Quality Gate: Fail ──► Fail PR Check       │
         └──────────────────────────────────────────────────┘
```

---

## 📁 Project & Submission Layout

Aligned with the assessment layout guidelines:

```text
.
├── README.md                      # Comprehensive technical architecture & answers
├── package.json                   # Root orchestrator scripts
├── .env                           # Local secrets (GEMINI_APIKEY) - not committed
├── scripts/
│   ├── generate_tests.mjs         # Programmatic LLM test generator
│   ├── run_all.sh                 # Local pipeline orchestration (start -> gen -> test)
│   ├── generation_cache.mjs       # Generated-test cache and fingerprinting
│   ├── generation_cache.test.mjs  # Cache regression tests
│   ├── test_guardrails.mjs        # TypeScript and Swagger conformance checks
│   ├── test_guardrails.test.mjs   # Guardrail regression tests
│   └── prompts/
│       ├── api-prompt.txt         # Few-shot Swagger-to-API test generation prompt
│       └── web-prompt.txt         # Grounded React-to-Playwright E2E prompt
├── generated_test/                # Permanent archive of generated test artifacts
│   ├── api/
│   │   └── generated-api.spec.ts  # Generated Playwright API tests
│   └── web/
│       └── generated-web.spec.ts  # Generated Playwright Web E2E tests
├── .github/
│   └── workflows/
│       └── quality-gate.yml       # Active GitHub Actions pipeline
├── application_code/              # System under test (Go backend + Next.js frontend)
└── playwright_template/           # Provided Playwright framework (config kept unchanged)
    └── tests/
        ├── api/generated-api.spec.ts
        └── web/generated-web.spec.ts
```

---

## 🚀 Quick Start & Local Execution

### 1. Prerequisites
- **Node.js**: v20.9+
- **Go**: v1.21+
- Playwright browsers: Chromium

Install the JavaScript dependencies and Chromium browser once from the repository root:

```bash
npm --prefix application_code install
npm --prefix playwright_template install
npm --prefix playwright_template exec -- playwright install chromium
```

### 2. Automated One-Command Orchestration
Run the end-to-end flow (starts background services, waits for health checks, generates tests via Gemini, and executes tests):

```bash
bash scripts/run_all.sh
```

### 3. Step-by-Step Manual Execution

```bash
# Terminal 1: Start Go Backend
cd /path/to/repository/application_code
go run main.go

# Terminal 2: Start Next.js Frontend
cd /path/to/repository/application_code
npm run dev

# Terminal 3: Generate Tests via LLM
cd /path/to/repository
npm run generate-tests

# Still in the repository root: Run Test Suite
npm run test:api   # Run API tests against Go backend
npm run test:web   # Run E2E tests against Next.js checkout UI
npm test           # Run complete suite
```

---

## 🔑 Secret Management & Security

The assessment specifies strict secret hygiene:
1. **Zero Hardcoded Secrets**: Secrets are never hardcoded in scripts, prompts, or test files.
2. **Local Environment**: `scripts/generate_tests.mjs` reads `GEMINI_API_KEY` (or `GEMINI_APIKEY`) dynamically from `process.env` or from the local `.env` file using regex pattern matching.
3. **CI Pipeline Injection**: In GitHub Actions (`.github/workflows/quality-gate.yml`), the secret is passed via GitHub Secrets context:
   ```yaml
   env:
     GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
   ```
4. **Header-Based Transport**: The API key is sent via the standard `x-goog-api-key` HTTP header, preventing accidental leakage in command-line inspection (`ps aux`) or process logging.

---

## 📘 Technical Deep Dive

### 1. LLM Prompt Design
Our prompt design leverages **strict system grounding**, **role prompting**, and **structural formatting constraints**:
- **Role & Identity**: The model is prompted as a *Principal SDET* specializing in `@playwright/test` TypeScript.
- **Grounding to Source**: The Swagger specification for API tests and `page.tsx` for web tests are included in the prompts, with instructions to use only documented endpoints, fields, and behaviors. This reduces hallucination risk but cannot eliminate it.
- **Explicit Edge Cases & Quirks**:
  - *Email Validation*: The API returns whether the supplied email matches the expected format; the E2E test separately mocks a 500 response to verify the frontend soft-fail behavior.
  - *Luhn Algorithm*: Directs the LLM to use valid credit card numbers (`4242 4242 4242 4242`) for positive flows and invalid numbers for negative flows.
- **Pure Code Output**: Prompt enforces fenced code blocks (` ```typescript `) with no conversational filler, allowing clean automated extraction.

### 2. How Swagger is Translated into Playwright Tests
The translation pipeline follows a deterministic mapping from OpenAPI elements to Playwright `APIRequestContext` calls:
- **Paths & Methods**: `paths['/api/checkout'].post` maps to `await request.post('/api/checkout', { data: { ... } })`.
- **Parameter Schemas**: Definitions like `#/definitions/main.PaymentRequest` map to TypeScript payload fixtures (`cardNumber`, `expiry`, `cvv`, `amount`).
- **Checkout UI fields**: The E2E flow also fills the required shipping name and address fields. The current mock Go `PaymentRequest` does not model or persist shipping details; the frontend's extra JSON fields are ignored by the handler.
- **Response Validation**:
  - `status()` matches declared HTTP status codes (200, 400).
  - Schema-aware assertions verify payload contracts (`expect(typeof body.status).toBe('string')`).
  - Business assertions verify expected messages (`expect(body.message).toBe('Payment processed successfully!')`).

### 3. How the Generation Process Works
The generation pipeline runs as a reproducible node script (`scripts/generate_tests.mjs`):
1. **Source Ingestion**: Ingests the machine-readable Swagger spec at `application_code/docs/swagger.json` and `app/page.tsx`.
2. **Model Call**: Dispatches the prompt to the configured Gemini model fallback chain with low temperature (`0.1`) to reduce output variation; generated output is not guaranteed to be identical across uncached runs.
3. **Regex Extraction**: Strips markdown fences and any surrounding text.
4. **AST and Swagger Guardrails**: Checks TypeScript syntax and Playwright test structure, then validates every API request method/path, asserted status code, asserted response property, and asserted property type against Swagger. Invalid output is rejected and generation is retried.
5. **Destination Sync**: Writes tests only after guardrails pass, then mirrors them in `generated_test/`.
6. **Intelligent Cache**: Reuses generated files only when a SHA-256 fingerprint of the Swagger spec, frontend component, prompts, generator, guardrails, and TypeScript lockfile matches. Cached file checksums and guardrails are verified again before skipping LLM calls.

On a cache hit, test generation does not require the Gemini API key. If any tracked input changes, an output is missing/modified, or validation fails, generation runs again. GitHub Actions persists generated outputs and the manifest with `actions/cache`; local runs use the same manifest under `.cache/generated-tests/`.

Run the guardrail and cache regression tests locally with:

```bash
node --test scripts/test_guardrails.test.mjs scripts/generation_cache.test.mjs
```

### 4. How CI Gates Production
The active workflow is [`.github/workflows/quality-gate.yml`](./.github/workflows/quality-gate.yml):
- **Workflow Triggers**: Runs on pushes and pull requests targeting `main` or `master`, and can be started manually.
- **Generation and Validation**: Restores the generated-test cache, runs its generation/validation step, and executes the API and web Playwright suites with up to two workers.
- **Failure Behavior**: A failing guardrail, generation step, or Playwright test makes the workflow fail. To block merges, configure this workflow as a required status check in the repository's GitHub branch protection or ruleset; that repository setting is not defined by the workflow file itself.
- **Artifact Diagnostics**: Playwright reports and test results are uploaded even when the job fails.

### 5. Scaling to Hundreds of Endpoints
**Current implementation:** the generator reads the full Swagger document and writes one generated API test file. The current sample has only a few endpoints, so endpoint chunking and parallel LLM generation are not implemented.

**Scaling approach for a larger API:**
- **Tag-Based Chunking**: Partition OpenAPI operations and their referenced schemas by tags (e.g., `auth`, `payments`, `refunds`, `webhooks`) to keep prompts within model context limits.
- **Bounded Parallel Generation**: Generate per-tag test files with a concurrency limit and explicit handling of partial failures rather than launching an unbounded request per endpoint.
- **Modular Output and Execution**: Write separate test files (e.g., `tests/api/payments.spec.ts`, `tests/api/auth.spec.ts`) and use Playwright sharding when the suite becomes large.
- **Schema Validation per Slice**: Validate generated endpoints and assertions against each operation's corresponding OpenAPI slice before saving.

### 6. Preventing & Detecting Hallucinated / Incorrect AI Tests
The generator reduces incorrect API tests with multiple checks, while recognizing that static checks cannot prove a test is behaviorally correct:
1. **Implemented Swagger Conformance Checks**: Before saving, an AST validator rejects API request paths or methods absent from the Swagger `paths`, status assertions not declared for the operation, response properties absent from the relevant response schema, and `typeof` assertions that conflict with the schema.
2. **Negative Grounding Rule**: The API prompt instructs the model not to invent endpoints or fields outside the supplied schema.
3. **Implemented Syntax and Structure Checks**: TypeScript parse errors, empty output, missing Playwright imports, or missing test declarations cause generation to retry instead of saving.
4. **Remaining validation opportunity**: These checks cannot verify business logic, input coverage, or whether assertions would pass against the real service. Add execution against a known-good mock/backend and review failures before treating generated tests as trusted.

### 7. Handling Flaky or Unstable Tests
**Implemented:** the provided Playwright config retries tests twice in CI, while generated E2E tests use route interception for deterministic API responses and fixed test data.

**Recommended for a larger suite, not currently implemented:** track first-run failures separately from final failures, quarantine repeatedly flaky tests with an owner and expiry, and report flaky rates. Retries should provide diagnostics, not silently convert unstable tests into a passing quality gate.

### 8. E2E Selector Generation & Stability
The generator prompt enforces Playwright's **Selector Priority Ladder**:
1. **Stable Form-Field Locators**: Name-based selectors such as `input[name="shippingName"]`, `textarea[name="shippingAddress"]`, `input[name="email"]`, and `input[name="cardNumber"]`, plus `button[type="submit"]`.
2. **User-Facing Accessibility**: `button:has-text("Check Backend Status")`.
3. **Prohibited Selectors**: Strict ban on fragile XPath (`//div[2]/div/form/button`), auto-generated CSS classes (`.css-1a2b3c`), or deep layout hierarchies.
4. **Async Event Handling**: Trigger explicit blur events (`await input.blur()`) to allow client-side validation listeners to evaluate cleanly.

### 9. Preventing Flaky Frontend Tests
1. **Web-First Auto-Waiting Assertions**: Use `await expect(locator).toBeVisible()` rather than checking immediate DOM properties. Playwright automatically polls the DOM until timeout.
2. **No Arbitrary Sleep Timers**: Prohibit hardcoded `page.waitForTimeout(3000)`. Instead, await observable UI states (e.g., waiting for validation checkmarks or success messages).
3. **Handling Soft-Fail Gracefully**: The frontend handles email-validation 500 responses by soft-failing, and the E2E test mocks that outage to verify the behavior without forcing the Go API to fail.
4. **Clean Route Interceptions**: `page.route` intercepts guarantee deterministic responses and isolate frontend tests from network lag.

## 🌟 Bonus Implementations

- **Multi-Model Fallback Chain:** Tries configured Gemini models in order when a request fails. This is a fallback sequence, not a circuit breaker.
- **AST and Swagger Guardrails:** TypeScript AST validation checks syntax and structure, then checks API methods, paths, response statuses, fields, and asserted field types against Swagger before saving.
- **Automated LLM Self-Healing:** If generation or output validation fails, the generator retries generation up to three times.
- **Schema-Aware Assertions:** Generated API tests validate response data types (`typeof body.status === 'string'`) and payload structure per Swagger definitions.
- **Deterministic Generation:** Temperature pinned to `0.1` with structured prompts; a content-addressed cache reuses validated outputs when all generation inputs are unchanged.
- **Intelligent Caching of Generated Tests:** SHA-256 fingerprints of generation inputs plus generated-output checksums; re-validates cached outputs and persists the cache across GitHub Actions runs.
- **Rate-Limit Resilience:** Generic request retries and model fallback provide limited resilience; rate-limit-specific handling (including `Retry-After` and status-aware backoff) is not implemented.
- **Parallel CI Test Execution:** Playwright CI runs with up to 2 workers, allowing API and web tests to execute in parallel while limiting runner resource usage.
- **Dual-Target Orchestration:** `scripts/run_all.sh` orchestrates Go backend, Next.js frontend, Gemini generator, and Playwright execution seamlessly.

---

## 🧪 Sample Test Execution (Local)

The following is a recorded local run using one worker. CI currently runs with up to two workers; this log is not a CI execution record.
The 8 skipped tests are the provided example/template tests in `playwright_template/tests/api/example-api.spec.ts` and `playwright_template/tests/web/example-web.spec.ts`; their suites are marked with `test.describe.skip` because they target placeholder endpoints and generic flows. The 11 passing tests are the generated API and checkout-flow tests.

```text
Running 19 tests using 1 worker

  ✓ [chromium] › Checkout Flow E2E Tests › Happy Path - Full Checkout Completion (904ms)
  ✓ [chromium] › Checkout Flow E2E Tests › Negative Path - Invalid Card Validation (589ms)
  ✓ [chromium] › Checkout Flow E2E Tests › Resiliency / Soft-Fail Behavior (547ms)
  ✓ [chromium] › Checkout Flow E2E Tests › Health Check Verification (619ms)
  ✓ [api-tests] › API Tests: Payment API › GET /api/health - should return healthy status (39ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/validate-card - happy path with valid Luhn card (7ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/validate-card - negative path with invalid Luhn card (6ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/validate-card - bad request path with malformed payload (5ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/validate-email - should validate a valid email address (4ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/checkout - happy path with valid payment details (4ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/checkout - bad request path with malformed amount payload (4ms)

  8 skipped (template boilerplate)
  11 passed (3.8s)
```

---

## ✅ CI Quality Gate Evidence

These pull requests demonstrate the quality gate with both passing and intentionally failing changes. Open each PR's **Checks** tab for the latest GitHub Actions result:

- **Positive case:** [Sample PR for a passing quality gate](https://github.com/irwanhub2016/sdet-automation-ai/pull/3) — documentation-only change. The workflow was still running when this README was updated; confirm its final result in the PR checks before describing it as a successful run.
- **Intentional API failure:** [Demo failing API validation quality gate](https://github.com/irwanhub2016/sdet-automation-ai/pull/1) — `/api/validate-email` returns HTTP 500 while its API test expects HTTP 200.
- **Intentional UI failure:** [Demo failing checkout UI quality gate](https://github.com/irwanhub2016/sdet-automation-ai/pull/2) — the checkout success response is rendered as a payment failure, causing the happy-path E2E assertion to fail.

The two failure PRs are demonstrations only and must not be merged.
