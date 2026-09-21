const AUTOML_API_TIMEOUT_MS = 30_000;
const AUTOML_UPLOAD_TIMEOUT_MS = 120_000;

let storedToken: string | null = null;

export function setAutomlDataApiToken(token: string | null): void {
  storedToken = token?.trim() || null;
}

export type AutomlApiEnvelope<T> = {
  code: string;
  message?: string;
  data: T;
};

export class AutomlDataApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, options: { status: number; code: string }) {
    super(message);
    this.name = "AutomlDataApiError";
    this.status = options.status;
    this.code = options.code;
  }
}

export type AutomlUploadResult = {
  fileId: number;
  fileMd5: string;
  originName: string;
  objectKey: string;
  size: number;
};

export type AutomlChunkInitResult = {
  uploaded: boolean;
  fileId: number | null;
  uploadId: string | null;
  uploadedChunks: number[];
};

export type AutomlChunkUploadResult = {
  chunkNo: number;
  uploaded: boolean;
};

export type AutomlUploadStatus = {
  status: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  uploadedChunks: number[];
  receivedBytes: number;
};

export type AutomlDataset = {
  id: number;
  datasetCode: string;
  name: string;
  taskType: string;
  mediaType: string;
  sourceType: string;
  classNames: string[] | null;
  visibilityCd: string;
  description: string | null;
  statusCd: string;
  createTime: string;
};

export type AutomlDatasetCreated = AutomlDataset & {
  initialDatasetVersionId: number;
};

export type AutomlMaterialSample = {
  id: number;
  datasetVersionId: number;
  dataFileId: number;
  sampleObjectKey: string;
  annotation: { objectKey: string } | null;
  splitType: string;
  mediaType: string;
  width: number | null;
  height: number | null;
  statusCd: string;
};

export type AutomlMaterial = {
  id: number;
  fileMd5: string;
  originName: string;
  objectKey: string;
  bucket: string;
  size: number;
  contentType: string | null;
  fileRole: string | null;
  createTime: string;
  samples: AutomlMaterialSample[];
};

export type AutomlDatasetModel = {
  modelId: number;
  modelCode: string;
  modelName: string;
  modelVersionId: number;
  modelVersion: string;
  trainingTask: {
    id: number;
    taskCode: string;
    name: string;
    statusCd: string;
    createTime: string;
  } | null;
};

export type AutomlVersionDetail = {
  datasetId: number;
  datasetName: string;
  totalImageCount: number;
  versions: {
    id: number;
    version: string;
    parentVersionId: number | null;
    statusCd: string;
    sampleCount: number;
    imageCount: number;
    releasedAt: string | null;
    createTime: string;
    classSampleStats: {
      classId: number;
      classCode: string;
      className: string;
      classIndex: number;
      sampleCount: number;
    }[];
  }[];
};

export type AutomlAnnotationTaskSummary = {
  name: string;
  method: string;
  totalItemCount: number;
  annotatedItemCount: number;
  statusCd: string;
};

export type AutomlAnnotationTask = {
  id: number;
  datasetId: number;
  datasetVersionId: number;
  name: string;
  taskType: string;
  method: string;
  statusCd: string;
  priority: string;
  labelSchemaJson: { classNames?: string[] } | null;
  totalItemCount: number;
  annotatedItemCount: number;
  reviewedItemCount: number;
  rejectedItemCount: number;
  createTime: string;
};

function automlApiBaseUrl(): string {
  if (typeof window !== "undefined" && !window.location.hostname.startsWith("localhost")) {
    throw new AutomlDataApiError("AutoML 接口尚未配置服务地址", { status: 0, code: "not_configured" });
  }
  return "/sz-api/automl";
}

async function fetchAutoml<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = AUTOML_API_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (storedToken) headers.set("Authorization", storedToken);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${automlApiBaseUrl()}${path}`, { ...init, headers, signal: controller.signal });
  } catch {
    throw new AutomlDataApiError("无法连接 AutoML 服务，请确认服务地址与网络连接", {
      status: 0,
      code: "service_unavailable",
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new AutomlDataApiError(`AutoML 接口请求失败 (${response.status})`, {
      status: response.status,
      code: "request_failed",
    });
  }
  const payload = (await response.json().catch(() => null)) as AutomlApiEnvelope<T> | null;
  if (!payload || payload.code !== "0000") {
    throw new AutomlDataApiError(payload?.message ?? "AutoML 接口返回失败", {
      status: response.status,
      code: payload?.code ?? "request_failed",
    });
  }
  return payload.data;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function uploadAutomlFile(file: File, sceneCode?: string): Promise<AutomlUploadResult> {
  const form = new FormData();
  form.append("file", file);
  const query = sceneCode ? `?sceneCode=${encodeURIComponent(sceneCode)}` : "";
  return fetchAutoml<AutomlUploadResult>(`/files/upload${query}`, { method: "POST", body: form }, AUTOML_UPLOAD_TIMEOUT_MS);
}

export async function uploadAutomlFiles(files: File[], sceneCode?: string): Promise<AutomlUploadResult[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const query = sceneCode ? `?sceneCode=${encodeURIComponent(sceneCode)}` : "";
  return fetchAutoml<AutomlUploadResult[]>(`/files/batch-upload${query}`, { method: "POST", body: form }, AUTOML_UPLOAD_TIMEOUT_MS);
}

export async function initAutomlChunkedUpload(input: {
  fileName: string;
  fileSize: number;
  fileMd5: string;
  chunkSize: number;
  sceneCode?: string;
}): Promise<AutomlChunkInitResult> {
  return fetchAutoml<AutomlChunkInitResult>("/files/init", jsonInit("POST", input));
}

export async function uploadAutomlChunk(uploadId: string, chunkNo: number, chunk: Blob): Promise<AutomlChunkUploadResult> {
  const form = new FormData();
  form.append("chunkNo", String(chunkNo));
  form.append("chunk", chunk);
  return fetchAutoml<AutomlChunkUploadResult>(
    `/files/${encodeURIComponent(uploadId)}/chunks`,
    { method: "POST", body: form },
    AUTOML_UPLOAD_TIMEOUT_MS,
  );
}

export async function completeAutomlChunkedUpload(uploadId: string): Promise<AutomlUploadResult> {
  return fetchAutoml<AutomlUploadResult>(
    `/files/${encodeURIComponent(uploadId)}/complete`,
    { method: "POST" },
    AUTOML_UPLOAD_TIMEOUT_MS,
  );
}

export async function getAutomlUploadStatus(uploadId: string): Promise<AutomlUploadStatus> {
  return fetchAutoml<AutomlUploadStatus>(`/files/${encodeURIComponent(uploadId)}`);
}

export async function createAutomlDatasetFromFiles(input: {
  dataFileIds: number[];
  name: string;
  description?: string;
  taskType: string;
}): Promise<AutomlDatasetCreated> {
  return fetchAutoml<AutomlDatasetCreated>("/datasets/from-files", jsonInit("POST", input));
}

export async function listAutomlDatasetMaterials(datasetId: number | string): Promise<AutomlMaterial[]> {
  return fetchAutoml<AutomlMaterial[]>(`/datasets/${encodeURIComponent(String(datasetId))}/materials`);
}

export async function listAutomlDatasetModels(datasetId: number | string): Promise<AutomlDatasetModel[]> {
  return fetchAutoml<AutomlDatasetModel[]>(`/datasets/${encodeURIComponent(String(datasetId))}/models`);
}

export async function getAutomlDatasetVersionDetails(datasetId: number | string): Promise<AutomlVersionDetail> {
  return fetchAutoml<AutomlVersionDetail>(`/datasets/${encodeURIComponent(String(datasetId))}/version-details`);
}

export async function listAutomlAnnotationTasks(
  datasetId: number | string,
  datasetVersionId: number,
): Promise<AutomlAnnotationTaskSummary[]> {
  return fetchAutoml<AutomlAnnotationTaskSummary[]>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${datasetVersionId}/annotation-tasks`,
  );
}

export async function createAutomlStandardAnnotationTask(input: {
  datasetId: number | string;
  datasetVersionId: number;
  name: string;
  method?: "MANUAL" | "MODEL_ASSISTED";
}): Promise<AutomlAnnotationTask> {
  const { datasetId, datasetVersionId, ...body } = input;
  return fetchAutoml<AutomlAnnotationTask>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${datasetVersionId}/annotation-tasks/standard`,
    jsonInit("POST", body),
  );
}
