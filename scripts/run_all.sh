#!/usr/bin/env bash

# ==============================================================================
# Orchestration Script: Senior SDET AI-Driven Quality Gate
# AI Automation Technical Assessment
# ==============================================================================

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=========================================================="
echo "🎯 Orchestrating Full Pipeline (Build -> Run -> Generate -> Test)"
echo "=========================================================="

# Cleanup background processes on exit
cleanup() {
  echo ""
  echo "🧹 Shutting down background services..."
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. Start Go Backend Server on port 8080 (if not already running)
if lsof -i :8080 >/dev/null 2>&1; then
  echo "✅ Go backend is already running on :8080"
else
  echo "🚀 Starting Go backend on :8080..."
  (cd application_code && go run main.go) &
  BACKEND_PID=$!
fi

# 2. Start Next.js Frontend on port 3000 (if not already running)
if lsof -i :3000 >/dev/null 2>&1; then
  echo "✅ Next.js frontend is already running on :3000"
else
  echo "🚀 Starting Next.js frontend on :3000..."
  (cd application_code && npm run dev) &
  FRONTEND_PID=$!
fi

# 3. Wait for services to be healthy
echo "⏳ Waiting for backend (8080) and frontend (3000) readiness..."
MAX_RETRIES=30
COUNT=0
until curl -s http://localhost:8080/api/health >/dev/null 2>&1; do
  sleep 1
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -ge "$MAX_RETRIES" ]; then
    echo "❌ Timeout waiting for Go backend on :8080"
    exit 1
  fi
done

COUNT=0
until curl -s http://localhost:3000 >/dev/null 2>&1; do
  sleep 1
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -ge "$MAX_RETRIES" ]; then
    echo "❌ Timeout waiting for Next.js frontend on :3000"
    exit 1
  fi
done
echo "🟢 Both services are live and ready!"

# 4. Programmatic LLM Test Generation
echo ""
echo "🤖 Triggering Programmatic LLM Test Generation with AST Guardrails..."
node scripts/generate_tests.mjs

# 5. Execute Playwright Quality Gate
echo ""
echo "🎭 Executing Playwright Test Suite (Quality Gate)..."
export CI=1
export STAGING_API_URL=http://127.0.0.1:8080
export STAGING_BASE_URL=http://127.0.0.1:3000

npm run test

echo ""
echo "=========================================================="
echo "🎉 Quality Gate PASSED: All generated API and Web tests succeeded!"
echo "=========================================================="
