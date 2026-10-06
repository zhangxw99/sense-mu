import { execFileSync } from "node:child_process";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./vite/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

function resolveBuildRelease() {
  const releaseFromEnvironment =
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.CLOUDFLARE_COMMIT_SHA ??
    process.env.GITHUB_SHA;

  if (releaseFromEnvironment) return releaseFromEnvironment.slice(0, 12);

  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  const buildRelease = resolveBuildRelease();

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      __SENSEMU_BUILD_RELEASE__: JSON.stringify(buildRelease),
    },
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    optimizeDeps: {
      exclude: ["lucide-react"],
    },
    server: {
      proxy: {
        "/sz-api": {
          target: "http://127.0.0.1:9992",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/sz-api/, "/api"),
        },
        // SAM3 分割服务（见工作区根目录 SAMAPI.md），路径原样转发（/sam-api/predict → /predict）
        "/sam-api": {
          target: process.env.SENSEMU_SAM_API_TARGET ?? "http://127.0.0.1:8800",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/sam-api/, ""),
        },
        // 临时推理会话实例（测试验证用，默认 8101，与常驻服务隔离）
        // 注意必须放在 /edge-api 之前，避免被更短前缀先匹配
        "/edge-api-session": {
          target: process.env.SENSEMU_EDGE_SESSION_TARGET ?? "http://127.0.0.1:8101",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/edge-api-session/, ""),
        },
        // edge ONNX 推理服务（edge/inference-service），路径原样转发（/edge-api/v1/detect → /v1/detect）
        "/edge-api": {
          target: process.env.SENSEMU_EDGE_API_TARGET ?? "http://127.0.0.1:8100",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/edge-api/, ""),
        },
        // edge-service 会话管理 API（临时推理会话创建/销毁，默认 8102）
        "/edge-agent": {
          target: process.env.SENSEMU_EDGE_AGENT_TARGET ?? "http://127.0.0.1:8102",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/edge-agent/, ""),
        },
      },
      watch: isCodexSeatbeltSandbox
        ? { useFsEvents: false, usePolling: true }
        : undefined,
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
