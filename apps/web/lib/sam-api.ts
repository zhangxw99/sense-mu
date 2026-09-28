// SAM3 分割服务客户端：经 vite 代理 /sam-api → SAM 服务（默认 http://127.0.0.1:8800，
// 可用 SENSEMU_SAM_API_TARGET 覆盖）。接口契约见工作区根目录 SAMAPI.md。
import type { SamDetection } from "./sam-annotation";

const SAM_API_TIMEOUT_MS = 120_000; // SAMAPI.md：单次推理与图片大小、类别数相关，建议超时 ≥ 60s

export class SamApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SamApiError";
    this.status = status;
  }
}

export type SamPredictResult = {
  imageSize: [number, number]; // [高, 宽]，原图像素
  detections: SamDetection[];
};

async function parseSamError(response: Response): Promise<SamApiError> {
  let detail = `SAM 服务请求失败（HTTP ${response.status}）`;
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body?.detail === "string" && body.detail.trim()) detail = body.detail;
  } catch {
    // 非 JSON 错误体，保留默认描述
  }
  return new SamApiError(detail, response.status);
}

export async function predictSamDetections(input: {
  imageDataUrl: string;
  classes: string[];
  conf?: number;
}): Promise<SamPredictResult> {
  const response = await fetch("/sam-api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: input.imageDataUrl,
      classes: input.classes,
      ...(input.conf != null ? { conf: input.conf } : {}),
    }),
    signal: AbortSignal.timeout(SAM_API_TIMEOUT_MS),
  });
  if (!response.ok) throw await parseSamError(response);
  const body = (await response.json()) as {
    image_size?: unknown;
    detections?: unknown;
  };
  const imageSize = Array.isArray(body.image_size) ? body.image_size : [];
  const rawDetections = Array.isArray(body.detections) ? body.detections : [];
  return {
    imageSize: [Number(imageSize[0] ?? 0), Number(imageSize[1] ?? 0)],
    detections: rawDetections.map((entry) => {
      const record = entry as { class?: unknown; conf?: unknown; bbox?: unknown };
      return {
        class: String(record.class ?? ""),
        conf: Number(record.conf ?? 0),
        bbox: Array.isArray(record.bbox) ? record.bbox.map((value) => Number(value)) : [],
      };
    }),
  };
}

// 预签名图片 URL → dataURL（SAM 服务只收 base64）。MinIO 默认允许跨域读取；
// 若对象存储关闭 CORS，这里会抛 TypeError，由调用方转成可读错误提示。
export async function fetchImageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new SamApiError(`样本图片读取失败（HTTP ${response.status}）`, response.status);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new SamApiError("样本图片 base64 编码失败", 0));
    reader.readAsDataURL(blob);
  });
}
