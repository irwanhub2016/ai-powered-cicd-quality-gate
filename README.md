# AI-Driven API Automation & CI Quality Gate Challenge

> **Senior SDET Technical Submission — PayMongo**  
> Architected for deterministic LLM test generation, schema validation, resilient guardrails, and automated CI gating.

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
6. [Senior-Level Signals & Bonus Implementations](#-senior-level-signals--bonus-implementations)

---

## 🏗 Overview & Architecture

This solution integrates **Generative AI directly into a CI/CD Quality Gate pipeline**. Rather than treating LLMs as offline developer chatbots, the pipeline uses **Gemini 3.5 Flash-Lite** programmatically with automated AST compiler guardrails, converting OpenAPI 2.0 specifications and React frontend components into verified Playwright test suites.

```
                    ┌────────────────────────┐
                    │ application_code/      │
                    │ ├── docs/swagger.yaml  │
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
                    │ AST Syntax Guardrail   │
                    │ (ts.createSourceFile)  │ ──► [Auto-Retry on Error]
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
         │  └── Quality Gate: Pass ──► Deploy / Merge      │
         │  └── Quality Gate: Fail ──► Block PR + Artifacts│
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
│   ├── generate_tests.mjs         # Programmatic test generator with TS AST guardrail
│   ├── run_all.sh                 # Full local pipeline orchestration (start -> gen -> test)
│   ├── github_action.yaml         # CI pipeline specification
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
└── playwright_template/           # Playwright framework (playwright.config.ts untouched)
    └── tests/
        ├── api/generated-api.spec.ts
        └── web/generated-web.spec.ts
```

---

## 🚀 Quick Start & Local Execution

### 1. Prerequisites
- **Node.js**: v18+ (v20+ recommended)
- **Go**: v1.21+
- Playwright browsers: Chromium

### 2. Automated One-Command Orchestration
Run the end-to-end flow (starts background services, waits for health checks, generates tests via Gemini, and executes tests):

```bash
bash scripts/run_all.sh
```

### 3. Step-by-Step Manual Execution

```bash
# Terminal 1: Start Go Backend
cd application_code
go run main.go

# Terminal 2: Start Next.js Frontend
cd application_code
npm install
npm run dev

# Terminal 3: Generate Tests via LLM
npm run generate-tests

# Terminal 3: Run Test Suite
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
- **Grounding (Zero Hallucination)**: The full source specification (`swagger.yaml` for API, `page.tsx` for Web) is injected into the prompt. The model is constrained to test *only* the endpoints, fields, and behaviors present in the code.
- **Explicit Edge Cases & Quirks**:
  - *Backend Outage Simulation*: Informs the prompt that `/api/validate-email` returns HTTP 500 intentionally to simulate third-party failure, directing the LLM to assert `500` status and soft-fail handling.
  - *Luhn Algorithm*: Directs the LLM to use valid credit card numbers (`4242 4242 4242 4242`) for positive flows and invalid numbers for negative flows.
- **Pure Code Output**: Prompt enforces fenced code blocks (` ```typescript `) with no conversational filler, allowing clean automated extraction.

### 2. How Swagger is Translated into Playwright Tests
The translation pipeline follows a deterministic mapping from OpenAPI elements to Playwright `APIRequestContext` calls:
- **Paths & Methods**: `paths['/api/checkout'].post` maps to `await request.post('/api/checkout', { data: { ... } })`.
- **Parameter Schemas**: Definitions like `#/definitions/main.PaymentRequest` map to TypeScript payload fixtures (`cardNumber`, `expiry`, `cvv`, `amount`).
- **Response Validation**:
  - `status()` matches declared HTTP status codes (200, 400, 500).
  - Schema-aware assertions verify payload contracts (`expect(typeof body.status).toBe('string')`).
  - Business assertions verify expected messages (`expect(body.message).toBe('Payment processed successfully!')`).

### 3. How the Generation Process Works
The generation pipeline runs as a reproducible node script (`scripts/generate_tests.mjs`):
1. **Source Ingestion**: Ingests the machine-readable Swagger spec at `application_code/docs/swagger.json` and `app/page.tsx`.
2. **Model Call**: Dispatches payload to Gemini API (`gemini-3.5-flash-lite`) configured with low temperature (`0.1`) for deterministic code generation.
3. **Regex Extraction**: Strips markdown fences and any surrounding text.
4. **AST and Swagger Guardrails**: Checks TypeScript syntax and Playwright test structure, then validates every API request method/path, asserted status code, asserted response property, and asserted property type against Swagger. Invalid output is rejected and generation is retried.
5. **Destination Sync**: Writes tests only after guardrails pass, then mirrors them in `generated_test/`.

Run the guardrail regression tests locally with:

```bash
node --test scripts/test_guardrails.test.mjs
```

### 4. How CI Gates Production
In the CI workflow (`scripts/github_action.yaml`):
- **PR Check Requirement**: The pipeline executes on every Pull Request to `main`.
- **Gate Enforcement**: GitHub branch protection rules require the `quality-gate` workflow status to be `success` before the **Merge** button is enabled.
- **Pipeline Failure**: If generated API tests or E2E tests fail (exit code $\neq$ 0), CI fails immediately, preventing broken code from merging or deploying to production.
- **Artifact Diagnostics**: Failed runs automatically publish Playwright traces, error screenshots, and HTML reports for post-mortem debugging.

### 5. Scaling to Hundreds of Endpoints
In an enterprise payment platform with 100+ endpoints:
- **Modular Tag Chunking**: Instead of one monolithic prompt, partition OpenAPI specs by `tags` (e.g. `auth`, `payments`, `refunds`, `webhooks`).
- **Parallel LLM Worker Pool**: Dispatch parallel API generation requests per tag group (`Promise.allSettled`).
- **Token Budgeting**: Inject only relevant schema definitions for each endpoint slice rather than the entire 10,000-line OpenAPI document.
- **Modular Spec Output**: Output individual test files (e.g., `tests/api/payments.spec.ts`, `tests/api/auth.spec.ts`) enabling parallel CI test sharding (`playwright test --shard=1/4`).

### 6. Preventing & Detecting Hallucinated / Incorrect AI Tests
The generator reduces incorrect API tests with multiple checks, while recognizing that static checks cannot prove a test is behaviorally correct:
1. **Implemented Swagger Conformance Checks**: Before saving, an AST validator rejects API request paths or methods absent from the Swagger `paths`, status assertions not declared for the operation, response properties absent from the relevant response schema, and `typeof` assertions that conflict with the schema.
2. **Negative Grounding Rule**: The API prompt instructs the model not to invent endpoints or fields outside the supplied schema.
3. **Implemented Syntax and Structure Checks**: TypeScript parse errors, empty output, missing Playwright imports, or missing test declarations cause generation to retry instead of saving.
4. **Remaining validation opportunity**: These checks cannot verify business logic, input coverage, or whether assertions would pass against the real service. Add execution against a known-good mock/backend and review failures before treating generated tests as trusted.

### 7. Handling Flaky or Unstable Tests
1. **Automatic CI Retries**: `playwright.config.ts` configures `retries: process.env.CI ? 2 : 0` to absorb transient network hiccups.
2. **Decoupled API Mocking for Third-Party Gateways**: In E2E tests, intercept volatile external services (`page.route('**/api/validate-email', ...)`) while running real assertions against our backend.
3. **Flaky Test Quarantine**: Isolate tests that fail on first run but pass on retry into a quarantine project, preventing PR blocking while opening an automated issue.
4. **Deterministic Seed Data**: Use idempotent test fixtures and dedicated test card numbers rather than randomized variables that may collide.

### 8. E2E Selector Generation & Stability
The generator prompt enforces Playwright's **Selector Priority Ladder**:
1. **Semantic Form Locators**: `input[name="email"]`, `input[name="cardNumber"]`, `button[type="submit"]`.
2. **User-Facing Accessibility**: `button:has-text("Check Backend Status")`.
3. **Prohibited Selectors**: Strict ban on fragile XPath (`//div[2]/div/form/button`), auto-generated CSS classes (`.css-1a2b3c`), or deep layout hierarchies.
4. **Async Event Handling**: Trigger explicit blur events (`await input.blur()`) to allow client-side validation listeners to evaluate cleanly.

### 9. Preventing Flaky Frontend Tests
1. **Web-First Auto-Waiting Assertions**: Use `await expect(locator).toBeVisible()` rather than checking immediate DOM properties. Playwright automatically polls the DOM until timeout.
2. **No Arbitrary Sleep Timers**: Prohibit hardcoded `page.waitForTimeout(3000)`. Instead, await observable UI states (e.g., waiting for validation checkmarks or success messages).
3. **Handling Soft-Fail Gracefully**: The frontend catches backend 500 errors on email validation and soft-fails. The test suite explicitly tests this resilient path, ensuring the test doesn't fail just because email validation is simulated down.
4. **Clean Route Interceptions**: `page.route` intercepts guarantee deterministic responses and isolate frontend tests from network lag.

---

## 🌟 Senior-Level Signals & Bonus Implementations

| Bonus Item | Implementation in this Submission |
| :--- | :--- |
| **Multi-Model Fallback Chain** | Resilient fallback architecture prioritizing verified active models (`gemini-3.5-flash-lite` -> `gemini-3.5-flash` -> `gemini-3.6-flash`) with automatic circuit breaking on 503/429/404 errors. |
| **AST and Swagger Guardrails** | TypeScript AST validation checks syntax and structure, then checks API methods, paths, response statuses, fields, and asserted field types against Swagger before saving. |
| **Automated LLM Self-Healing** | If generated code contains syntax errors or empty output, the generator automatically retries up to 3 times with exponential backoff. |
| **Schema-Aware Assertions** | Generated API tests validate response data types (`typeof body.status === 'string'`) and payload structure per Swagger definitions. |
| **Deterministic Generation** | Temperature pinned to `0.1`, structured prompt rules, and consistent code formatting. |
| **Intelligent Rate-Limit Handling** | Handles Gemini API `503 Unavailable` / demand spikes using exponential backoff retry delays. |
| **Parallel CI Test Execution** | Playwright CI runs with up to 2 workers, allowing API and web tests to execute in parallel while limiting runner resource usage. |
| **Dual-Target Orchestration** | `scripts/run_all.sh` orchestrates Go backend, Next.js frontend, Gemini generator, and Playwright execution seamlessly. |

---

## 🧪 Test Execution Proof

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
  ✓ [api-tests] › API Tests: Payment API › POST /api/validate-email - should simulate third-party outage returning 500 (4ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/checkout - happy path with valid payment details (4ms)
  ✓ [api-tests] › API Tests: Payment API › POST /api/checkout - bad request path with malformed amount payload (4ms)

  8 skipped (template boilerplate)
  11 passed (3.8s)
```
