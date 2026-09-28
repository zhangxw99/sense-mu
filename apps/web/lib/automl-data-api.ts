const AUTOML_API_TIMEOUT_MS = 30_000;
const AUTOML_UPLOAD_TIMEOUT_MS = 120_000;
const AUTOML_MD5_SLICE_SIZE = 2 * 1024 * 1024;
const AUTOML_CHUNK_RATE_LIMIT_DELAY_MS = 1_200;

let storedToken: string | null = null;

export const AUTOML_TOKEN_CHANGED_EVENT = "sensemu:automl-token-changed";

export const AUTOML_DATASETS_CHANGED_EVENT = "sensemu:automl-datasets-changed";

// 数据集增删后由页面调用，通知侧栏等处的数据集列表刷新
export function notifyAutomlDatasetsChanged(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(AUTOML_DATASETS_CHANGED_EVENT));
  }
}

export function setAutomlDataApiToken(token: string | null): void {
  storedToken = token?.trim() || null;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(AUTOML_TOKEN_CHANGED_EVENT));
  }
}

export type AutomlApiEnvelope<T> = {
  code: string;
  message?: string;
  data: T;
};

export type AutomlId = number | string;

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
  fileId: AutomlId;
  fileMd5: string;
  originName: string;
  objectKey: string;
  size: AutomlId;
};

export type AutomlChunkInitResult = {
  uploaded: boolean;
  fileId: AutomlId | null;
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
  id: AutomlId;
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
  latestVersionId?: AutomlId | null;
  sampleCount?: number;
  imageCount?: number;
  annotatedSampleCount?: number;
};

export type AutomlDatasetCreated = AutomlDataset & {
  initialDatasetVersionId: AutomlId;
};

export type AutomlDatasetItem = {
  itemId: AutomlId;
  dataFileId: AutomlId | null;
  originName: string | null;
  sampleObjectKey: string;
  annotationObjectKey: string | null;
  splitType: string;
  mediaType: string;
  width: number | null;
  height: number | null;
  sizeBytes: AutomlId | null;
  statusCd: string;
  annotatedItemCount: number | string;
};

export type AutomlDatasetClass = {
  id: AutomlId;
  datasetId: AutomlId;
  classCode: string;
  className: string;
  classIndex: number;
  color: string | null;
  parentId: AutomlId | null;
  sortNo: number;
  attributesJson: Record<string, unknown> | null;
  statusCd: string;
  remark: string | null;
};

export type AutomlSplitCount = {
  splitType: string;
  itemCount: AutomlId;
};

export type AutomlMaterialSample = {
  id: AutomlId;
  datasetVersionId: AutomlId;
  dataFileId: AutomlId;
  sampleObjectKey: string;
  annotation: { objectKey: string } | null;
  splitType: string;
  mediaType: string;
  width: number | null;
  height: number | null;
  statusCd: string;
};

export type AutomlMaterial = {
  id: AutomlId;
  fileMd5: string;
  originName: string;
  objectKey: string;
  bucket: string;
  size: AutomlId;
  contentType: string | null;
  fileRole: string | null;
  createTime: string;
  samples: AutomlMaterialSample[];
};

export type AutomlDatasetModel = {
  modelId: AutomlId;
  modelCode: string;
  modelName: string;
  modelVersionId: AutomlId;
  modelVersion: string;
  trainingTask: {
    id: AutomlId;
    taskCode: string;
    name: string;
    statusCd: string;
    createTime: string;
  } | null;
};

export type AutomlVersionDetail = {
  datasetId: AutomlId;
  datasetName: string;
  totalImageCount: AutomlId;
  versions: {
    id: AutomlId;
    version: string;
    parentVersionId: number | null;
    statusCd: string;
    marketStatusCd?: string;
    sampleCount: number;
    imageCount: number;
    releasedAt: string | null;
    createTime: string;
    classSampleStats: {
      classId: AutomlId;
      classCode: string;
      className: string;
      classIndex: number;
      sampleCount: number;
    }[];
  }[];
};

export type AutomlAnnotationTaskSummary = {
  id: AutomlId;
  name: string;
  method: string;
  totalItemCount: number;
  annotatedItemCount: number | string;
  statusCd: string;
};

export type AutomlAnnotationTask = {
  id: AutomlId;
  datasetId: AutomlId;
  datasetVersionId: AutomlId;
  name: string;
  taskType: string;
  method: string;
  statusCd: string;
  priority: string;
  labelSchemaJson: { classNames?: string[] } | null;
  totalItemCount: number;
  annotatedItemCount: number | string;
  reviewedItemCount: number;
  rejectedItemCount: number;
  createTime: string;
};

export type AutomlAnnotation = {
  id: AutomlId;
  datasetId: AutomlId;
  datasetVersionId: AutomlId;
  datasetItemId: AutomlId;
  annotationTaskId: AutomlId;
  labelName: string;
  annotationJson: Record<string, unknown>;
  confidence: number | null;
  sourceCd: string;
  statusCd: string;
};

export type AutomlAlgorithmSearchItem = {
  id: AutomlId;
  model_name: string;
  model_type: string | null;
  model_scene: string | null;
  model_description: string | null;
};

export type AutomlAlgorithmSearchResult = {
  current: number;
  limit: number;
  totalPage: number;
  total: AutomlId;
  rows: AutomlAlgorithmSearchItem[];
};

export type AutomlAlgorithmDetail = {
  model_info: Record<string, unknown> | null;
  model_metric: Record<string, unknown> | null;
  eval_info: Record<string, unknown> | null;
  input_schema: Record<string, unknown> | null;
  result_schema: Record<string, unknown> | null;
  usage_scene: { suggest?: string; unsuggest?: string } | null;
};

export type AutomlPage<T> = {
  current: number;
  limit: number;
  totalPage: number;
  total: AutomlId;
  rows: T[];
};

export type AutomlFileUrl = {
  objectKey: string;
  url: string;
  expiresAt: string;
};

export async function searchAutomlAlgorithms(
  params: { page?: number; limit?: number; name?: string; scene?: string } = {},
): Promise<AutomlAlgorithmSearchResult> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 10),
  });
  if (params.name) query.set("name", params.name);
  if (params.scene) query.set("scene", params.scene);
  return fetchAutoml<AutomlAlgorithmSearchResult>(`/algorithms/search?${query.toString()}`);
}

export async function getAutomlAlgorithmDetail(id: AutomlId): Promise<AutomlAlgorithmDetail> {
  return fetchAutoml<AutomlAlgorithmDetail>(`/algorithms/${encodeURIComponent(String(id))}`);
}

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
    // 后端业务错误（如 C1008 校验失败）以 HTTP 4xx/5xx + JSON envelope 返回，
    // 优先透出 envelope 里的后端 message，而不是通用的「请求失败 (状态码)」
    const errorPayload = await response.json().catch(() => null) as AutomlApiEnvelope<unknown> | null;
    if (errorPayload?.message) {
      throw new AutomlDataApiError(errorPayload.message, {
        status: response.status,
        code: errorPayload.code ?? "request_failed",
      });
    }
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

export async function getAutomlFileUrls(objectKeys: string[], ttlSeconds = 3600): Promise<AutomlFileUrl[]> {
  return fetchAutoml<AutomlFileUrl[]>("/files/batch-urls", jsonInit("POST", { objectKeys, ttlSeconds }));
}

export async function computeFileMd5(file: File): Promise<string> {
  const { default: SparkMD5 } = await import("spark-md5");
  const spark = new SparkMD5.ArrayBuffer();
  for (let offset = 0; offset < file.size; offset += AUTOML_MD5_SLICE_SIZE) {
    const slice = file.slice(offset, Math.min(offset + AUTOML_MD5_SLICE_SIZE, file.size));
    spark.append(await slice.arrayBuffer());
  }
  const digest = spark.end();
  if (!digest || digest.length !== 32) {
    throw new AutomlDataApiError("文件 MD5 计算失败，请重试", { status: 0, code: "md5_failed" });
  }
  return digest;
}

export type AutomlChunkedUploadProgress = {
  totalChunks: number;
  uploadedChunks: number;
};

export async function uploadAutomlFileChunked(
  file: File,
  options: {
    chunkSize?: number;
    sceneCode?: string;
    onProgress?: (progress: AutomlChunkedUploadProgress) => void;
  } = {},
): Promise<{ result: AutomlUploadResult; deduplicated: boolean }> {
  if (file.size <= 0) {
    throw new AutomlDataApiError("不能上传空文件", { status: 0, code: "invalid_file" });
  }
  const chunkSize = options.chunkSize ?? 5 * 1024 * 1024;
  if (chunkSize < 5 * 1024 * 1024 || chunkSize > 20 * 1024 * 1024) {
    throw new AutomlDataApiError("分片大小必须在 5MB 到 20MB 之间", { status: 0, code: "invalid_chunk_size" });
  }
  const fileMd5 = await computeFileMd5(file);
  const init = await initAutomlChunkedUpload({
    fileName: file.name,
    fileSize: file.size,
    fileMd5,
    chunkSize,
    sceneCode: options.sceneCode,
  });
  if (init.uploaded && init.fileId != null) {
    return {
      result: {
        fileId: init.fileId,
        fileMd5,
        originName: file.name,
        objectKey: "",
        size: file.size,
      },
      deduplicated: true,
    };
  }
  if (!init.uploadId) {
    throw new AutomlDataApiError("分片上传初始化失败：服务端未返回会话 ID", {
      status: 0,
      code: "init_failed",
    });
  }
  const totalChunks = Math.ceil(file.size / chunkSize);
  let uploadedCount = init.uploadedChunks.length;
  options.onProgress?.({ totalChunks, uploadedChunks: uploadedCount });
  for (let chunkNo = 1; chunkNo <= totalChunks; chunkNo += 1) {
    if (init.uploadedChunks.includes(chunkNo)) continue;
    const start = (chunkNo - 1) * chunkSize;
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    await new Promise((resolve) => setTimeout(resolve, AUTOML_CHUNK_RATE_LIMIT_DELAY_MS));
    await uploadAutomlChunk(init.uploadId, chunkNo, chunk);
    uploadedCount += 1;
    options.onProgress?.({ totalChunks, uploadedChunks: uploadedCount });
  }
  const result = await completeAutomlChunkedUpload(init.uploadId);
  return { result, deduplicated: false };
}

export async function createAutomlDatasetFromFiles(input: {
  dataFileIds: AutomlId[];
  name: string;
  description?: string;
  taskType: string;
  classNames?: string[];
}): Promise<AutomlDatasetCreated> {
  return fetchAutoml<AutomlDatasetCreated>("/datasets/from-files", jsonInit("POST", input));
}

export async function createAutomlEmptyDataset(input: {
  name: string;
  description?: string;
  taskType: string;
  classNames?: string[];
}): Promise<AutomlDatasetCreated> {
  return fetchAutoml<AutomlDatasetCreated>("/datasets", jsonInit("POST", input));
}

export async function listAutomlDatasets(
  params: {
    page?: number;
    limit?: number;
    name?: string;
    taskType?: string;
    statusCd?: string;
  } = {},
): Promise<AutomlPage<AutomlDataset>> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 10),
  });
  for (const key of ["name", "taskType", "statusCd"] as const) {
    const value = params[key]?.trim();
    if (value) query.set(key, value);
  }
  return fetchAutoml<AutomlPage<AutomlDataset>>(`/datasets?${query.toString()}`);
}

export async function listAutomlDatasetItems(
  datasetId: number | string,
  datasetVersionId: AutomlId,
  params: {
    page?: number;
    limit?: number;
    splitType?: string;
    statusCd?: string;
    annotated?: boolean;
    labelName?: string;
  } = {},
): Promise<AutomlPage<AutomlDatasetItem>> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 10),
  });
  if (params.splitType?.trim()) query.set("splitType", params.splitType.trim());
  if (params.statusCd?.trim()) query.set("statusCd", params.statusCd.trim());
  if (params.annotated != null) query.set("annotated", String(params.annotated));
  if (params.labelName?.trim()) query.set("labelName", params.labelName.trim());
  return fetchAutoml<AutomlPage<AutomlDatasetItem>>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(datasetVersionId))}/items?${query.toString()}`,
  );
}

export async function updateAutomlDatasetItemSplits(
  datasetId: number | string,
  datasetVersionId: AutomlId,
  items: { itemId: AutomlId; splitType: "train" | "val" | "test" }[],
): Promise<AutomlSplitCount[]> {
  return fetchAutoml<AutomlSplitCount[]>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(datasetVersionId))}/items/splits`,
    jsonInit("PUT", { items }),
  );
}

export type AutomlVersionSnapshot = {
  id: AutomlId;
  datasetId: AutomlId;
  version: string;
  parentVersionId: AutomlId | null;
  statusCd: string;
  itemCount: number;
  annotationCount: number;
  sizeBytes: AutomlId | null;
};

export async function createAutomlDatasetVersionSnapshot(
  datasetId: number | string,
  sourceVersionId?: AutomlId,
): Promise<AutomlVersionSnapshot> {
  const body = sourceVersionId != null ? { sourceVersionId } : {};
  return fetchAutoml<AutomlVersionSnapshot>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions`,
    jsonInit("POST", body),
  );
}

export async function releaseAutomlDatasetVersion(
  datasetId: number | string,
  datasetVersionId: AutomlId,
): Promise<void> {
  return fetchAutoml<void>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(datasetVersionId))}/release`,
    { method: "PUT" },
  );
}

export async function deleteAutomlDataset(datasetId: number | string): Promise<void> {
  return fetchAutoml<void>(`/datasets/${encodeURIComponent(String(datasetId))}`, { method: "DELETE" });
}

export type AutomlImportItemPayload = {
  dataFileId: AutomlId;
  width?: number | null;
  height?: number | null;
  annotations: { labelName: string; annotationJson: Record<string, unknown> }[];
};

// 结构化导入：图片已上传，标注由前端从 YOLO txt / VOC xml 解析后随请求提交；
// 缺失类别后端自动创建，标注不归属标注任务
export async function importAutomlItems(
  datasetId: number | string,
  items: AutomlImportItemPayload[],
): Promise<AutomlVersionSnapshot> {
  return fetchAutoml<AutomlVersionSnapshot>(
    `/datasets/${encodeURIComponent(String(datasetId))}/import-items`,
    jsonInit("POST", { items }),
  );
}

export async function appendAutomlDatasetFiles(
  datasetId: number | string,
  dataFileIds: AutomlId[],
): Promise<AutomlVersionSnapshot> {
  return fetchAutoml<AutomlVersionSnapshot>(
    `/datasets/${encodeURIComponent(String(datasetId))}/files`,
    jsonInit("POST", { dataFileIds }),
  );
}

export async function listAutomlDatasetMaterials(datasetId: number | string): Promise<AutomlMaterial[]> {
  return fetchAutoml<AutomlMaterial[]>(`/datasets/${encodeURIComponent(String(datasetId))}/materials`);
}

export async function listAutomlDatasetModels(datasetId: number | string): Promise<AutomlDatasetModel[]> {
  return fetchAutoml<AutomlDatasetModel[]>(`/datasets/${encodeURIComponent(String(datasetId))}/models`);
}

export async function listAutomlDatasetClasses(datasetId: number | string): Promise<AutomlDatasetClass[]> {
  return fetchAutoml<AutomlDatasetClass[]>(`/datasets/${encodeURIComponent(String(datasetId))}/classes`);
}

export async function createAutomlDatasetClass(
  datasetId: number | string,
  input: {
    classCode: string;
    className: string;
    color?: string;
    sortNo?: number;
    statusCd?: "ENABLED" | "DISABLED";
    remark?: string;
  },
): Promise<void> {
  // CreateDTO 的 datasetId 为 @NotNull 且 @Valid 先于 Controller 回填执行，body 必须显式携带
  return fetchAutoml<void>(`/datasets/${encodeURIComponent(String(datasetId))}/classes`, jsonInit("POST", { ...input, datasetId }));
}

export async function updateAutomlDatasetClass(
  datasetId: number | string,
  classId: AutomlId,
  input: {
    datasetId: AutomlId;
    classCode: string;
    classIndex: number;
    className: string;
    color?: string;
    sortNo?: number;
    statusCd?: "ENABLED" | "DISABLED";
    remark?: string;
  },
): Promise<void> {
  return fetchAutoml<void>(
    `/datasets/${encodeURIComponent(String(datasetId))}/classes/${encodeURIComponent(String(classId))}`,
    jsonInit("PUT", { ...input, id: classId }),
  );
}

export async function deleteAutomlDatasetClass(datasetId: number | string, classId: AutomlId): Promise<void> {
  return fetchAutoml<void>(
    `/datasets/${encodeURIComponent(String(datasetId))}/classes/${encodeURIComponent(String(classId))}`,
    { method: "DELETE" },
  );
}

export async function getAutomlDatasetVersionDetails(datasetId: number | string): Promise<AutomlVersionDetail> {
  return fetchAutoml<AutomlVersionDetail>(`/datasets/${encodeURIComponent(String(datasetId))}/version-details`);
}

export type AutomlMarketListing = {
  versionId: AutomlId;
  datasetId: AutomlId;
  datasetName: string;
  description: string | null;
  taskType: string;
  version: string;
  marketStatusCd: string;
  sampleCount: number;
  annotationCount: number;
  annotatedSampleCount: number;
  classNames: string[] | null;
  releasedAt: string | null;
  createTime: string;
  coverObjectKey?: string;
  coverBoxes?: { labelName: string; x: number; y: number; w: number; h: number }[];
};

export async function listAutomlMarketListings(): Promise<AutomlMarketListing[]> {
  return fetchAutoml<AutomlMarketListing[]>("/market/listings");
}

export async function publishAutomlVersionToMarket(datasetId: number | string, versionId: AutomlId): Promise<void> {
  await fetchAutoml<null>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(versionId))}/market/publish`,
    { method: "POST" },
  );
}

export async function unpublishAutomlVersionFromMarket(datasetId: number | string, versionId: AutomlId): Promise<void> {
  await fetchAutoml<null>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(versionId))}/market/unpublish`,
    { method: "POST" },
  );
}

export async function listAutomlAnnotationTasks(
  datasetId: number | string,
  datasetVersionId: AutomlId,
): Promise<AutomlAnnotationTaskSummary[]> {
  return fetchAutoml<AutomlAnnotationTaskSummary[]>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(datasetVersionId))}/annotation-tasks`,
  );
}

export async function createAutomlStandardAnnotationTask(input: {
  datasetId: number | string;
  datasetVersionId: AutomlId;
  name: string;
  method?: "MANUAL" | "MODEL_ASSISTED";
}): Promise<AutomlAnnotationTask> {
  const { datasetId, datasetVersionId, ...body } = input;
  return fetchAutoml<AutomlAnnotationTask>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${datasetVersionId}/annotation-tasks/standard`,
    jsonInit("POST", body),
  );
}

export async function listAutomlAnnotations(
  datasetId: number | string,
  datasetVersionId: AutomlId,
  itemId: AutomlId,
  annotationTaskId?: AutomlId,
): Promise<AutomlAnnotation[]> {
  const query = annotationTaskId ? `?annotationTaskId=${encodeURIComponent(String(annotationTaskId))}` : "";
  return fetchAutoml<AutomlAnnotation[]>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(datasetVersionId))}/items/${encodeURIComponent(String(itemId))}/annotations${query}`,
  );
}

export async function saveAutomlAnnotations(
  datasetId: number | string,
  datasetVersionId: AutomlId,
  itemId: AutomlId,
  input: {
    annotationTaskId: AutomlId;
    annotations: {
      labelName: string;
      annotationJson: Record<string, unknown>;
      confidence?: number;
      sourceCd?: "MANUAL" | "MODEL" | "MODEL_ASSISTED" | "IMPORT";
    }[];
  },
): Promise<AutomlAnnotation[]> {
  return fetchAutoml<AutomlAnnotation[]>(
    `/datasets/${encodeURIComponent(String(datasetId))}/versions/${encodeURIComponent(String(datasetVersionId))}/items/${encodeURIComponent(String(itemId))}/annotations`,
    jsonInit("PUT", input),
  );
}
