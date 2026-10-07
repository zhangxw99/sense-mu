# sense-mu 前端 dev1 部署（39.105.189.49）

## 一键部署

```bash
cd sense-mu/apps/web/deploy
./deploy-web.sh              # 构建 + 打包 + 同步 + 服务器重建 + 健康检查
./deploy-web.sh --no-build   # 跳过 npm run build（用现有 dist）
```

流程：本地 vinext build（固定 `AUTH_MODE=development`、PREVIEW 关闭）→ pack.sh 组装
artifact（dist + package.json，**不含 node_modules**）→ scp 到 `/home/app/sensemu-web`
→ 服务器 `docker compose up -d --build`（镜像内 npm install，原生二进制按
linux-x64-musl 解析）→ 健康检查 `/__sensemu/health`。

## 架构

```
浏览器 → dev1:80 sensemu-nginx
             ├─ /sz-api/*  → host.docker.internal:9991/api/*（sz-boot，deploy-bundle compose）
             └─ 其余       → web:3000（sensemu-web 容器，vinext start，SSR）
```

- 前端只认同源相对路径，服务地址全部在 nginx.conf 解耦。
- `/edge-agent` `/edge-api` `/edge-api-session` `/sam-api` 在云端无目标（边缘服务
  在设备侧，云端不可直连），相关功能在 dev1 部署上不可用，属预期。
- 构建参数：认证走 `development`（automl 页面 token 手工录入；`/automl/**` 在后端
  白名单内免 token），PREVIEW 关闭（market/data-market 旧演示页数据不可用，属预期）。

## 注意事项

1. **原生依赖必须在镜像内安装**：rolldown/esbuild 等带平台二进制，mac 上装的
   node_modules 在 alpine 容器里起不来（踩过：`rolldown-binding.linux-x64-musl` 缺失）。
2. 服务器镜像拉取走已配的 registry-mirrors（daemon.json）。
3. 手动更新页面后只需重跑 `./deploy-web.sh`；改 nginx/compose 配置则 scp 后
   `docker compose up -d --build`。
