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
  // 图片百分比 0-100（由像素 x1/y1/x2/y2 与图片尺寸换算）
  x: number;
  y: number;
  width: number;
  height: number;
  // 分割模型：实例掩码多边形（每条外轮廓一环，图片百分比），检测模型为 null。
  // 细长实例（裂缝）常断成多个连通块，单环会丢段导致掩码明显小于检测框
  points?: { x: number; y: number }[][] | null;
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
  // 别名寻址：传 `/{别名}/detect` 走服务别名路由；缺省走通用 /v1/detect
  detectPath = "/v1/detect",
): Promise<{ modelName: string; detections: EdgeDetection[] }> {
  const form = new FormData();
  form.append("image", image, "inference.jpg");
  form.append("threshold", String(threshold));
  const response = await fetch(`${edgeApiBaseUrl()}${detectPath}`, {
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
    detections: {
      className: string;
      confidence: number;
      bbox: { x1: number; y1: number; x2: number; y2: number };
      segmentation?: number[][] | null;
    }[];
  };
  const width = body.image?.width || 1;
  const height = body.image?.height || 1;
  const detections = (body.detections ?? []).map((detection) => {
    // 分割：每条外轮廓一个像素平铺环 → 百分比顶点
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
      // 百分比 0-100，与 DemoRealBox 渲染约定一致
      x: (Math.max(0, detection.bbox.x1 / width)) * 100,
      y: (Math.max(0, detection.bbox.y1 / height)) * 100,
      width: (Math.min(1, Math.max(0, (detection.bbox.x2 - detection.bbox.x1) / width))) * 100,
      height: (Math.min(1, Math.max(0, (detection.bbox.y2 - detection.bbox.y1) / height))) * 100,
      points: points.length > 0 ? points : null,
    };
  });
  return {
    modelName: `${body.modelId} · v${body.modelVersion}`,
    detections,
  };
}
