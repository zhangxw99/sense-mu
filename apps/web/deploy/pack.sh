#!/usr/bin/env bash
# 组装前端部署物：本地构建产物 + package.json → deploy/artifact/
# 依赖不在这里装：rolldown/esbuild 等原生二进制跟平台走，必须由 Dockerfile.web
# 在目标机（linux/alpine）上 npm install（见 Dockerfile.web 注释）。
#
# 前置：先在 apps/web 用生产参数构建：
#   NEXT_PUBLIC_SENSEMU_AUTH_MODE=development NEXT_PUBLIC_SENSEMU_PREVIEW_MODE=false SENSEMU_PREVIEW_MODE=false npm run build
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART="$WEB_DIR/deploy/artifact"

cd "$WEB_DIR"
[ -d dist ] || { echo "缺少 dist/，先 npm run build" >&2; exit 1; }

VITE_VER="$(python3 -c "import json;print(json.load(open('node_modules/vite/package.json'))['version'])")"
REACT_VER="$(python3 -c "import json;print(json.load(open('node_modules/react/package.json'))['version'])")"

rm -rf "$ART"
mkdir -p "$ART"
cp -R dist "$ART/dist"

cat > "$ART/package.json" <<EOF
{
  "name": "sensemu-web-runtime",
  "private": true,
  "dependencies": {
    "react": "$REACT_VER",
    "react-dom": "$REACT_VER",
    "spark-md5": "^3.0.2",
    "vinext": "1.0.0-beta.6",
    "vite": "$VITE_VER"
  }
}
EOF

echo "artifact 就绪：$(du -sh "$ART" | cut -f1)"
echo "打包：cd deploy && tar czf artifact.tgz artifact"
