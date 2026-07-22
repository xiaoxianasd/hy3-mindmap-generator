#!/bin/bash
set -e

echo "========================================"
echo "  MindGraph AI - Starting..."
echo "========================================"
echo ""

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Trap to kill both on Ctrl+C
cleanup() {
    echo ""
    echo "Stopping services..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo "Stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "[1/2] Starting backend (Python FastAPI)..."
cd "$ROOT/backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

echo "[2/2] Starting frontend (Next.js)..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "========================================"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "  Press Ctrl+C to stop both"
echo "========================================"

wait
