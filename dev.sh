#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT=3000
FRONTEND_PORT=5173
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down...${NC}"
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  echo -e "${GREEN}All processes stopped.${NC}"
}
trap cleanup EXIT INT TERM

free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo -e "${YELLOW}Port $port is in use (PIDs: $pids). Killing...${NC}"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
    echo -e "${GREEN}Port $port freed.${NC}"
  fi
}

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  ClawConsole Dev Server${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Free ports
free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

# Check dependencies
if [ ! -d "$ROOT_DIR/backend/node_modules" ]; then
  echo -e "${YELLOW}Installing backend dependencies...${NC}"
  (cd "$ROOT_DIR/backend" && npm install)
fi

if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo -e "${YELLOW}Installing frontend dependencies...${NC}"
  (cd "$ROOT_DIR/frontend" && npm install)
fi

# Start backend
echo -e "${CYAN}Starting backend on :${BACKEND_PORT}...${NC}"
(cd "$ROOT_DIR/backend" && npm run dev) &
BACKEND_PID=$!

# Start frontend
echo -e "${CYAN}Starting frontend on :${FRONTEND_PORT}...${NC}"
(cd "$ROOT_DIR/frontend" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Backend:  http://localhost:${BACKEND_PORT}/api${NC}"
echo -e "${GREEN}  Frontend: http://localhost:${FRONTEND_PORT}${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop both servers.${NC}"
echo ""

wait
