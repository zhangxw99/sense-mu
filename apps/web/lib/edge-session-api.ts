// edge-service 会话管理 + 临时推理会话客户端：
// - /edge-agent → edge-service 管理 API（默认 127.0.0.1:8102）：创建/查询/销毁临时推理会话
// - /edge-api-session → 会话推理实例（默认 127.0.0.1:8101）：/v1/detect 直接打临时实例
// 会话由 edge-service 在设备上起独立 inference-service 进程，与常驻服务隔离；
// 离开页面必须销毁（edge-service 侧另有空闲 TTL 兜底）。

import type { EdgeDetection } from "./edge-inference-api";

const SESSION_DETECT_TIMEOUT_MS = 120_000;

export type EdgeInferenceSession = {
  sessionId: string;
  deploymentId: string | null;
  modelId: string;
  modelVersion: string;
  port: number;
  baseUrl: string;
  idleTtlSeconds: number;
};

export async function createEdgeInferenceSession(params: {
  deploymentId?: string;
  modelId: string;
  version: string;
}): Promise<EdgeInferenceSession> {
  const response = await fetch("/edge-agent/v1/inference-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deploymentId: params.deploymentId ?? undefined,
      modelId: params.modelId,
      version: params.version,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => ({})) as { error?: string } | null;
  if (!response.ok) {
    const detail = body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`临时推理会话创建失败：${detail}`);
  }
  return body as unknown as EdgeInferenceSession;
}

export async function stopEdgeInferenceSession(sessionId?: string): Promise<boolean> {
  const path = sessionId
    ? `/edge-agent/v1/inference-sessions/${encodeURIComponent(sessionId)}`
    : "/edge-agent/v1/inference-sessions/current";
  try {
    const response = await fetch(path, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({})) as { stopped?: boolean } | null;
    return Boolean(body && body.stopped);
  } catch {
    // 页面卸载等场景下请求可能被中断，edge-service 的 TTL 兜底会回收
    return false;
  }
}

/** 关闭一机多模型常驻实例（MULTI_MODEL 部署模式，instanceId 为 mm-{deploymentId}）。 */
export async function stopMultiModelInstance(deploymentId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/edge-agent/v1/multi-model/${encodeURIComponent(deploymentId)}`,
      { method: "DELETE", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({})) as { stopped?: boolean } | null;
    return Boolean(body && body.stopped);
  } catch {
    return false;
  }
}

export async function renewEdgeInferenceSession(): Promise<EdgeInferenceSession | null> {
  const response = await fetch("/edge-agent/v1/inference-sessions/current", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return await response.json() as EdgeInferenceSession;
}

export async function detectWithSessionModel(
  image: Blob,
  threshold: number,
): Promise<{ modelName: string; detections: EdgeDetection[] }> {
  const form = new FormData();
  form.append("image", image, "inference.jpg");
  form.append("threshold", String(threshold));
  const response = await fetch("/edge-api-session/v1/detect", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(SESSION_DETECT_TIMEOUT_MS),
  });
  if (!response.ok) {
    let detail = `临时推理会话请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // 非 JSON 错误体
    }
    throw new Error(detail);
  }
  const body = await response.json() as {
    modelId?: string;
    modelVersion?: string;
    image?: { width?: number; height?: number };
    detections?: {
      className: string;
      confidence: number;
      bbox: { x1: number; y1: number; x2: number; y2: number };
      segmentation?: number[][] | null;
    }[];
  };
  // /v1/detect 返回像素坐标 bbox，换算为图片百分比 0-100（与 edge-inference-api 同约定）
  const width = body.image?.width || 1;
  const height = body.image?.height || 1;
  return {
    modelName: `${body.modelId ?? "model"} · v${body.modelVersion ?? ""}`,
    detections: (body.detections ?? []).map((detection) => {
      // 分割：每条外轮廓一个像素平铺环 → 百分比顶点（与 edge-inference-api 同约定）
      const rings = Array.isArray(detection.segmentation) ? detection.segmentation : [];
      const points = rings
        .map((flat) => {
          if (!Array.isArray(flat) || flat.length < 6 || !flat.every((value) => Number.isFinite(value))) return null;
          return Array.from({ length: flat.length / 2 }, (_, index) => ({
            x: (flat[index * 2] / width) * 100,
            y: (flat[index * 2 + 1] / height) * 100,
          }));
        })
        .filter((ring): ring is { x: number; y: number }[] => ring !== null);
      return {
        label: detection.className,
        confidence: detection.confidence,
        x: (Math.max(0, detection.bbox.x1 / width)) * 100,
        y: (Math.max(0, detection.bbox.y1 / height)) * 100,
        width: (Math.min(1, Math.max(0, (detection.bbox.x2 - detection.bbox.x1) / width))) * 100,
        height: (Math.min(1, Math.max(0, (detection.bbox.y2 - detection.bbox.y1) / height))) * 100,
        points: points.length > 0 ? points : null,
      };
    }),
  };
}

// ---- 推理服务生命周期控制（常驻实例 + 临时会话实例），走设备管理 API（/edge-agent 代理）----

async function postServiceControl(path: string): Promise<boolean> {
  try {
    const response = await fetch(`/edge-agent${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({})) as Record<string, unknown> | null;
    return Boolean(body && Object.values(body).some((value) => value === true));
  } catch {
    return false;
  }
}

/** 重启常驻推理服务（当前激活模型不变，进程重建）。 */
export function restartResidentInferenceService(): Promise<boolean> {
  return postServiceControl("/v1/services/resident/restart");
}

/** 关闭常驻推理服务：进程停止，看门狗不再自动拉起，直到显式启动。 */
export function stopResidentInferenceService(): Promise<boolean> {
  return postServiceControl("/v1/services/resident/stop");
}

/** 启动常驻推理服务（关闭后重新拉起）。 */
export function startResidentInferenceService(): Promise<boolean> {
  return postServiceControl("/v1/services/resident/start");
}

/** 重启临时推理会话：按同一模型销毁重建，临时状态文件随之清理重建。 */
export function restartEdgeInferenceSession(): Promise<boolean> {
  return postServiceControl("/v1/services/session/restart");
}
