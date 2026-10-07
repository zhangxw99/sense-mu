#!/usr/bin/env bash
# dev1 前端一键部署：打包 → 同步 → 服务器构建镜像并重启 → 健康检查
#
# 用法（在 sense-mu/apps/web/deploy 下）：
#   ./deploy-web.sh              # 完整流程
#   ./deploy-web.sh --no-build   # 跳过 npm run build，用现有 dist 打包
#
# 前置：Node >=24 <25；构建参数固定为 AUTH_MODE=development + PREVIEW 关闭。
# 登录凭证：优先 SSH key，不通时取钥匙串 env-manager 的 dev1 密码（expect）。
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"

SSH_HOST="${DEPLOY_HOST:-39.105.189.49}"
SSH_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/home/app/sensemu-web}"
FRONT_PORT="${DEPLOY_FRONT_PORT:-80}"
NO_BUILD="${1:-}"

log()  { printf '[deploy-web] %s\n' "$*"; }
fail() { printf '[deploy-web] 失败：%s\n' "$*" >&2; exit 1; }

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3)
DEST="$SSH_USER@$SSH_HOST"
PASSWORD=""
AUTH_MODE="key"

remote_run() { # remote_run "命令" [超时秒]
  local cmd="$1" timeout="${2:-600}"
  if [ "$AUTH_MODE" = "key" ]; then
    ssh "${SSH_OPTS[@]}" "$DEST" "$cmd"
  else
    DEST="$DEST" PW="$PASSWORD" TIMEOUT="$timeout" REMOTE_CMD="$cmd" expect -c '
      set timeout $env(TIMEOUT)
      spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 $env(DEST) $env(REMOTE_CMD)
      expect {
        -re "(?i)password" { send "$env(PW)\r"; exp_continue }
        timeout { puts stderr "\n[deploy-web] 连接超时"; exit 124 }
        eof
      }
      catch wait result
      exit [lindex $result 3]
    '
  fi
}

remote_scp() { # remote_scp "文件列表"
  if [ "$AUTH_MODE" = "key" ]; then
    scp "${SSH_OPTS[@]}" $1 "$DEST:$REMOTE_DIR/"
  else
    SRC_ARGS="$1" DEST="$DEST" REMOTE_DIR="$REMOTE_DIR" PW="$PASSWORD" expect -c '
      set timeout 600
      spawn scp {*}$env(SRC_ARGS) $env(DEST):$env(REMOTE_DIR)/
      expect {
        -re "(?i)password" { send "$env(PW)\r"; exp_continue }
        timeout { puts stderr "\n[deploy-web] 传输超时"; exit 124 }
        eof
      }
      catch wait result
      exit [lindex $result 3]
    '
  fi
}

# ---------- 0. 前置 ----------

command -v expect >/dev/null || fail "本机没有 expect"
if command -v security >/dev/null 2>&1; then
  PASSWORD="$(security find-generic-password -s codex-env-manager -a dev1 -w 2>/dev/null || true)"
fi
if [ -n "$PASSWORD" ] && ! ssh -o BatchMode=yes "${SSH_OPTS[@]}" "$DEST" true 2>/dev/null; then
  AUTH_MODE="password"
fi
remote_run "mkdir -p '$REMOTE_DIR'" 30 || fail "SSH 连不上 $DEST"
log "登录方式：${AUTH_MODE}；目标：${DEST}:${REMOTE_DIR}"

# ---------- 1. 构建 ----------

cd "$WEB_DIR"
if [ "$NO_BUILD" != "--no-build" ]; then
  log "npm run build（AUTH_MODE=development，PREVIEW 关闭）..."
  NEXT_PUBLIC_SENSEMU_AUTH_MODE=development \
  NEXT_PUBLIC_SENSEMU_PREVIEW_MODE=false \
  SENSEMU_PREVIEW_MODE=false \
    npm run build || fail "前端构建失败"
else
  [ -d dist ] || fail "没有 dist/，去掉 --no-build 先构建"
  log "跳过构建（--no-build）"
fi

# ---------- 2. 打包 + 同步 ----------

log "组装 artifact ..."
"$DEPLOY_DIR/pack.sh"
(cd "$DEPLOY_DIR" && tar czf artifact.tgz artifact)

log "同步部署文件 ..."
(cd "$DEPLOY_DIR" && remote_scp "Dockerfile.web docker-compose.yml nginx.conf artifact.tgz")

# ---------- 3. 远端重建 + 健康检查 ----------

log "服务器构建镜像并重启 ..."
remote_run "cd '$REMOTE_DIR' && rm -rf artifact && tar xzf artifact.tgz && docker compose up -d --build" 900

log "等待就绪（最长 2 分钟）..."
ok=""
for _ in $(seq 1 24); do
  # expect 走 pty，回显里混着 IP 等数字，所以远端打 HC= 标记、本地只抠标记后的码
  code="$(remote_run "echo HC=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$FRONT_PORT/__sensemu/health)" 30 \
    | sed -n 's/.*HC=\([0-9]\{3\}\).*/\1/p' | tail -1)"
  [ "$code" = "200" ] && { ok="$code"; break; }
  sleep 5
done
[ -n "$ok" ] || {
  printf '[deploy-web] 健康检查超时，最近日志：\n' >&2
  remote_run "cd '$REMOTE_DIR' && docker compose logs --tail 40" 30 || true
  exit 1
}

log "完成。访问：http://${SSH_HOST}（nginx:80 → web:3000，/sz-api → 后端 9991）"
