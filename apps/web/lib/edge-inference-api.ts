// edge 推理服务客户端：/edge-api → 推理服务（默认 http://127.0.0.1:8100，vite 代理）。
// 契约见 edge/inference-service/README.md（/v1/detect multipart image+threshold）。

const EDGE_API_TIMEOUT_MS = 120_000;

export type EdgeCurrentModel = {
  modelId: string;
  version: string;
  displayName: string | null;
  task: string;
  framework: string;
  classes: string[];
};

export type EdgeDetection = {
  label: string;
  confidence: number;
  // 归一化 0-1（由像素 x1/y1/x2/y2 与图片尺寸换算）
  x: number;
  y: number;
  width: number;
  height: number;
};

function edgeApiBaseUrl(): string {
  return "/edge-api";
}

export async function getEdgeCurrentModel(): Promise<EdgeCurrentModel> {
  const response = await fetch(`${edgeApiBaseUrl()}/v1/models/current`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`推理服务请求失败（HTTP ${response.status}）`);
  const body = (await response.json()) as {
    model: { modelId: string; version: string; displayName: string | null; task: string; framework: string; classes: string[] } | null;
    modelId?: string;
    modelVersion?: string;
  };
  const model = body.model ?? (body.modelId ? {
    modelId: body.modelId,
    version: body.modelVersion ?? "",
    displayName: null,
    task: "detection",
    framework: "onnx",
    classes: [],
  } : null);
  if (!model) throw new Error("推理服务尚未加载任何模型");
  return {
    modelId: model.modelId,
    version: model.version,
    displayName: model.displayName,
    task: model.task,
    framework: model.framework,
    classes: model.classes ?? [],
  };
}

export async function detectWithEdgeModel(
  image: Blob,
  threshold: number,
): Promise<{ modelName: string; detections: EdgeDetection[] }> {
  const form = new FormData();
  form.append("image", image, "inference.jpg");
  form.append("threshold", String(threshold));
  const response = await fetch(`${edgeApiBaseUrl()}/v1/detect`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(EDGE_API_TIMEOUT_MS),
  });
  if (!response.ok) {
    let detail = `推理服务请求失败（HTTP ${response.status}）`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // 非 JSON 错误体
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as {
    modelId: string;
    modelVersion: string;
    image: { width: number; height: number };
    detections: { className: string; confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }[];
  };
  const width = body.image?.width || 1;
  const height = body.image?.height || 1;
  const detections = (body.detections ?? []).map((detection) => ({
    label: detection.className,
    confidence: detection.confidence,
    x: Math.max(0, detection.bbox.x1 / width),
    y: Math.max(0, detection.bbox.y1 / height),
    width: Math.min(1, Math.max(0, (detection.bbox.x2 - detection.bbox.x1) / width)),
    height: Math.min(1, Math.max(0, (detection.bbox.y2 - detection.bbox.y1) / height)),
  }));
  return {
    modelName: `${body.modelId} · v${body.modelVersion}`,
    detections,
  };
}
