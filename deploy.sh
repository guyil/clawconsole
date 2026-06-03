#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
REMOTE_HOST="47.236.11.65"
REMOTE_USER="root"
REMOTE_DIR="/opt/clawconsole"
SSH_KEY="${SSH_KEY:-$HOME/Documents/Work/WorkSpace/AWS/credential/aliyun/aigc.pem}"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REMOTE="$REMOTE_USER@$REMOTE_HOST"

# ─── Helper Functions ─────────────────────────────────────────────────────────
log_step()  { echo -e "\n${CYAN}[$(date +%H:%M:%S)]${NC} ${BOLD}$1${NC}"; }
log_ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
log_warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "  ${RED}✗${NC} $1"; }

# Run a command on the remote. The whole argument list is forwarded to ssh as
# the remote command, so shell operators (&&, |, 2>&1) and quoting inside the
# string are evaluated by the REMOTE shell — not the local one.
remote_exec() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$REMOTE" "$@"
}

# ─── Pre-flight Checks ───────────────────────────────────────────────────────
preflight() {
  log_step "Pre-flight checks"

  if [ ! -f "$SSH_KEY" ]; then
    log_error "SSH key not found: $SSH_KEY"
    echo -e "  Set SSH_KEY env var to override. Example:"
    echo -e "  ${CYAN}SSH_KEY=/path/to/key.pem ./deploy.sh${NC}"
    exit 1
  fi
  log_ok "SSH key found"

  if ! remote_exec "echo ok" &>/dev/null; then
    log_error "Cannot connect to $REMOTE_HOST"
    exit 1
  fi
  log_ok "SSH connection to $REMOTE_HOST"

  if ! remote_exec "docker --version" &>/dev/null; then
    log_error "Docker not installed on remote host"
    exit 1
  fi
  log_ok "Docker available on remote"

  if [ ! -f "$ROOT_DIR/.env.production" ]; then
    log_error ".env.production not found — create it from .env.example first"
    exit 1
  fi
  log_ok ".env.production found"
}

# ─── Sync Files ──────────────────────────────────────────────────────────────
sync_files() {
  log_step "Syncing project files to $REMOTE_HOST:$REMOTE_DIR"

  rsync -az --delete --progress \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='.github' \
    --exclude='.claude' \
    --exclude='.cursor' \
    --exclude='.vscode' \
    --exclude='.idea' \
    --exclude='.DS_Store' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='coverage' \
    --exclude='.cache' \
    --exclude='.next' \
    --exclude='.turbo' \
    --exclude='backend/.env' \
    --exclude='backend/.env.bak' \
    --exclude='backend/logs' \
    --exclude='backend/downloads' \
    --exclude='backend/tests' \
    --exclude='backups' \
    --exclude='prd' \
    --exclude='docs' \
    --exclude='*.test.ts' \
    --exclude='*.log' \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
    "$ROOT_DIR/" \
    "$REMOTE:$REMOTE_DIR/"

  log_ok "Files synced"
}

# ─── Build & Deploy ──────────────────────────────────────────────────────────
deploy() {
  log_step "Building and deploying containers"

  remote_exec "cd $REMOTE_DIR && docker compose up -d --build 2>&1"

  log_ok "Containers built and started"
}

# ─── Health Check ────────────────────────────────────────────────────────────
health_check() {
  log_step "Running health checks (waiting 15s for startup)"
  sleep 15

  local status
  status=$(remote_exec "docker compose -f $REMOTE_DIR/docker-compose.yml ps --format '{{.Service}}\t{{.Status}}' 2>/dev/null" || true)
  echo "$status" | while IFS=$'\t' read -r svc st; do
    if echo "$st" | grep -qi "up"; then
      log_ok "$svc: $st"
    else
      log_warn "$svc: $st"
    fi
  done

  # Use /api/health (whitelisted by the auth gate) instead of /api/machines
  # so the check doesn't false-fail with 401 now that the password gate is on.
  local http_code
  http_code=$(remote_exec "curl -s -o /dev/null -w '%{http_code}' http://localhost/api/health" 2>/dev/null || echo "000")
  if [ "$http_code" = "200" ]; then
    log_ok "API responding (HTTP $http_code)"
  else
    log_warn "API returned HTTP $http_code — check logs with: ./deploy.sh logs"
  fi

  # Verify the auth gate is actually on: an un-authed call to a protected
  # route should now return 401, not 200. If we see 200 here, APP_PASSWORD
  # or APP_AUTH_SECRET likely failed to load and the gate was disabled.
  local auth_code
  auth_code=$(remote_exec "curl -s -o /dev/null -w '%{http_code}' http://localhost/api/machines" 2>/dev/null || echo "000")
  if [ "$auth_code" = "401" ]; then
    log_ok "Auth gate active (unauth → 401)"
  elif [ "$auth_code" = "200" ]; then
    log_error "Auth gate appears DISABLED (unauth /api/machines → 200). Check APP_PASSWORD/APP_AUTH_SECRET in .env.production."
  else
    log_warn "Auth gate probe returned HTTP $auth_code (expected 401)"
  fi
}

# ─── Subcommands ─────────────────────────────────────────────────────────────
cmd_deploy() {
  echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   ClawConsole Deploy → $REMOTE_HOST    ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"

  preflight
  sync_files
  deploy
  health_check

  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   Deployment complete!                   ║${NC}"
  echo -e "${GREEN}║                                          ║${NC}"
  echo -e "${GREEN}║   Web:  http://$REMOTE_HOST          ║${NC}"
  echo -e "${GREEN}║   SSH:  ssh root@100.75.148.116          ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
}

cmd_logs() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    remote_exec "docker compose -f $REMOTE_DIR/docker-compose.yml logs --tail=100 -f $service"
  else
    remote_exec "docker compose -f $REMOTE_DIR/docker-compose.yml logs --tail=50 -f"
  fi
}

cmd_status() {
  log_step "Service status on $REMOTE_HOST"
  remote_exec "docker compose -f $REMOTE_DIR/docker-compose.yml ps 2>&1"
  echo ""
  remote_exec "free -h | head -2"
}

cmd_restart() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    log_step "Restarting $service"
    remote_exec "cd $REMOTE_DIR && docker compose restart $service 2>&1"
  else
    log_step "Restarting all services"
    remote_exec "cd $REMOTE_DIR && docker compose restart 2>&1"
  fi
  log_ok "Restart complete"
}

cmd_ssh() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$REMOTE"
}

cmd_help() {
  echo -e "${BOLD}ClawConsole Deployment Tool${NC}"
  echo ""
  echo -e "${CYAN}Usage:${NC} ./deploy.sh [command] [args]"
  echo ""
  echo -e "${CYAN}Commands:${NC}"
  echo "  (default)       Full deploy: sync → build → start → health check"
  echo "  logs [service]  Tail logs (all services, or specify: backend/frontend/redis)"
  echo "  status          Show container status and memory usage"
  echo "  restart [svc]   Restart all services or a specific one"
  echo "  ssh             SSH into the remote server"
  echo "  help            Show this help message"
  echo ""
  echo -e "${CYAN}Examples:${NC}"
  echo "  ./deploy.sh                  # Full deployment"
  echo "  ./deploy.sh logs backend     # Tail backend logs"
  echo "  ./deploy.sh restart backend  # Restart backend only"
  echo "  ./deploy.sh status           # Check service status"
  echo "  ./deploy.sh ssh              # SSH into server"
  echo ""
  echo -e "${CYAN}Environment:${NC}"
  echo "  SSH_KEY   Path to SSH private key (default: ~/Documents/.../aigc.pem)"
}

# ─── Main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
  logs)     shift; cmd_logs "$@" ;;
  status)   cmd_status ;;
  restart)  shift; cmd_restart "$@" ;;
  ssh)      cmd_ssh ;;
  help|-h)  cmd_help ;;
  *)        cmd_deploy ;;
esac
