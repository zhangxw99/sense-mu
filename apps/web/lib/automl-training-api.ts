// 训练任务域 API 客户端（任务 / 指标 / 事件 / 就绪检查 / 发布）。
// 复用 automl-data-api 的 fetchAutoml：同一后端地址、同一 token 注入与超时语义。
import {
  type AutomlId,
  type AutomlPage,
  fetchAutoml,
} from "./automl-data-api.ts";
import type { AutomlDeviceDeployment } from "./automl-device-api.ts";

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export type AutomlTrainingTaskStatus =
  | "CREATED"
  | "QUEUED"
  | "SCHEDULED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | (string & {});

export type AutomlTrainingTask = {
  id: AutomlId;
  taskCode: string;
  name: string;
  statusCd: string;
  platformId: AutomlId | null;
  platformCode: string | null;
  platformName: string | null;
  baseModelId: AutomlId | null;
  baseModelCode: string | null;
  baseModelName: string | null;
  taskType: string | null;
  datasetVersionId: AutomlId | null;
  datasetId: AutomlId | null;
  // 重训血缘（「继续训练」产生的新任务回指来源，§9.1）
  sourceTrainingTaskId: AutomlId | null;
  sourceTaskName: string | null;
  // 该任务已发布的最新模型版本号（如 v2；未发布为 null）
  publishedVersion: string | null;
  deviceId: AutomlId | null;
  deviceName: string | null;
  hyperParamsJson: Record<string, unknown> | null;
  progress: number;
  currentEpoch: number;
  totalEpochs: number;
  // 时间均为 "yyyy-MM-dd HH:mm:ss" 字符串，未发生时为 null
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  deviceReportedAt: string | null;
  errorMessage: string | null;
  createTime: string;
};

export type AutomlReadinessLevel = "HARD" | "SOFT";

export type AutomlReadinessCheck = {
  key: string;
  level: AutomlReadinessLevel;
  passed: boolean;
  message: string;
};

export type AutomlReadinessSummary = {
  itemCount: AutomlId;
  annotatedItemCount: AutomlId;
  classCount: number;
  splitCounts: {
    TRAIN?: AutomlId | null;
    VAL?: AutomlId | null;
    UNASSIGNED?: AutomlId | null;
  } | null;
};

export type AutomlReadinessClassStat = {
  className: string;
  sampleCount: AutomlId;
  boxCount: AutomlId;
};

export type AutomlReadiness = {
  datasetVersionId: AutomlId;
  ready: boolean;
  checks: AutomlReadinessCheck[];
  summary: AutomlReadinessSummary | null;
  classStats: AutomlReadinessClassStat[];
};

export type AutomlMetricsPoint = {
  metricName: string;
  metricValue: number;
  epoch: number;
  step: number | null;
  splitType: string | null;
  loggedAt: string;
};

export type AutomlTrainingEvent = {
  id: AutomlId;
  eventType: string;
  statusCd: string | null;
  eventTime: string;
  message: string | null;
  payloadJson: Record<string, unknown> | null;
};

export const trainingTaskStatusLabels: Record<string, string> = {
  CREATED: "已创建",
  QUEUED: "已下发",
  SCHEDULED: "已调度",
  RUNNING: "训练中",
  SUCCEEDED: "已完成",
  // 历史数据的非标准终态，按已完成口径展示
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  CANCELED: "已取消",
};

const TRAINING_TASK_ACTIVE_STATUSES: readonly string[] = ["QUEUED", "SCHEDULED", "RUNNING"];

// 进行中（需轮询）的任务状态；终态返回 false
export function isTrainingTaskActive(statusCd: string): boolean {
  return TRAINING_TASK_ACTIVE_STATUSES.includes(statusCd);
}

export async function createAutomlTrainingTask(input: {
  name?: string;
  datasetVersionId: AutomlId;
  baseModelId: AutomlId;
  hyperParamsJson?: Record<string, unknown> | null;
  trainingConfigJson?: Record<string, unknown> | null;
  // 「继续训练」血缘：来源任务ID，建立训练版本链（§9.1）
  sourceTrainingTaskId?: AutomlId | null;
}): Promise<AutomlTrainingTask> {
  return fetchAutoml<AutomlTrainingTask>("/training-tasks", jsonInit("POST", input));
}

export async function listAutomlTrainingTasks(
  params: {
    page?: number;
    limit?: number;
    keyword?: string;
    statusCd?: string;
    deviceId?: AutomlId;
    datasetVersionId?: AutomlId;
  } = {},
): Promise<AutomlPage<AutomlTrainingTask>> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 10),
  });
  for (const key of ["keyword", "statusCd"] as const) {
    const value = params[key]?.trim();
    if (value) query.set(key, value);
  }
  for (const key of ["deviceId", "datasetVersionId"] as const) {
    const value = params[key];
    if (value != null && String(value).trim()) query.set(key, String(value));
  }
  return fetchAutoml<AutomlPage<AutomlTrainingTask>>(`/training-tasks?${query.toString()}`);
}

export async function getAutomlTaskReadiness(datasetVersionId: AutomlId): Promise<AutomlReadiness> {
  return fetchAutoml<AutomlReadiness>(
    `/training-tasks/readiness?datasetVersionId=${encodeURIComponent(String(datasetVersionId))}`,
  );
}

export async function getAutomlTrainingTask(taskId: AutomlId): Promise<AutomlTrainingTask> {
  return fetchAutoml<AutomlTrainingTask>(`/training-tasks/${encodeURIComponent(String(taskId))}`);
}

export async function dispatchAutomlTrainingTask(
  taskId: AutomlId,
  deviceId: AutomlId,
): Promise<AutomlTrainingTask> {
  return fetchAutoml<AutomlTrainingTask>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/dispatch`,
    jsonInit("PUT", { deviceId }),
  );
}

export async function cancelAutomlTrainingTask(taskId: AutomlId): Promise<void> {
  await fetchAutoml<null>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/cancel`,
    { method: "PUT" },
  );
}

export async function listAutomlTrainingTaskMetrics(
  taskId: AutomlId,
  params: { metricName?: string; splitType?: string } = {},
): Promise<AutomlMetricsPoint[]> {
  const query = new URLSearchParams();
  for (const key of ["metricName", "splitType"] as const) {
    const value = params[key]?.trim();
    if (value) query.set(key, value);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return fetchAutoml<AutomlMetricsPoint[]>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/metrics${suffix}`,
  );
}

export async function listAutomlTrainingTaskEvents(taskId: AutomlId): Promise<AutomlTrainingEvent[]> {
  return fetchAutoml<AutomlTrainingEvent[]>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/events`,
  );
}

export type AutomlTrainingArtifact = {
  id: AutomlId;
  trainingTaskId: AutomlId;
  artifactType: string;
  name: string;
  url: string | null;
  fileSize: AutomlId | null;
  epoch: number | null;
  updateTime: string | null;
};

export async function listAutomlTrainingArtifacts(taskId: AutomlId): Promise<AutomlTrainingArtifact[]> {
  return fetchAutoml<AutomlTrainingArtifact[]>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/artifacts`);
}

export const AUTOML_TRAINING_TASKS_CHANGED_EVENT = "sensemu:automl-training-tasks-changed";

function notifyTrainingTasksChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTOML_TRAINING_TASKS_CHANGED_EVENT));
  }
}

export async function deleteAutomlTrainingTask(taskId: AutomlId): Promise<void> {
  await fetchAutoml<null>(`/training-tasks/${encodeURIComponent(String(taskId))}`, { method: "DELETE" });
  notifyTrainingTasksChanged();
}

export type AutomlTrainingPublishResult = {
  modelId: AutomlId;
  modelCode: string;
  modelName: string | null;
  modelVersionId: AutomlId;
  version: string;
  runtime: string;
  checksum: string | null;
  packageSize: AutomlId | null;
  reused: boolean;
  marketStatusCd: "LISTED" | "UNLISTED" | null;
};

/** 发布训练成果为模型资产（同步幂等；部署前自动调用，重复调用返回已有版本）。
 *  只注册资产，不改变算法市场上架状态；上架走 publishAutomlTrainingToMarket。
 *  modelId 可选（§9.10 家族版本化发布）：重训成果挂到家族模型下发新版本 v{n+1}。 */
export async function publishAutomlTrainingTask(
  taskId: AutomlId,
  modelId?: AutomlId | null,
): Promise<AutomlTrainingPublishResult> {
  return fetchAutoml<AutomlTrainingPublishResult>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/publish`,
    jsonInit("POST", { modelId: modelId ?? null }),
  );
}

export type AutomlTrainingPublication = {
  published: boolean;
  modelId: AutomlId | null;
  modelCode: string | null;
  modelName: string | null;
  modelVersionId: AutomlId | null;
  version: string | null;
  marketStatusCd: "LISTED" | "UNLISTED" | null;
};

/** 任务的发布/上架状态：详情页「发布到算法市场 / 从算法市场下架」按钮依据。 */
export async function getAutomlTrainingPublication(taskId: AutomlId): Promise<AutomlTrainingPublication> {
  return fetchAutoml<AutomlTrainingPublication>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/publication`,
  );
}

/** 发布到算法市场（上架）：幂等复用发布后把模型 market_status_cd 置 LISTED。
 *  modelId 语义同 publishAutomlTrainingTask（家族版本化发布）。 */
export async function publishAutomlTrainingToMarket(
  taskId: AutomlId,
  modelId?: AutomlId | null,
): Promise<AutomlTrainingPublishResult> {
  return fetchAutoml<AutomlTrainingPublishResult>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/market/publish`,
    jsonInit("POST", { modelId: modelId ?? null }),
  );
}

/** 从算法市场下架（market_status_cd 置 UNLISTED）；已部署设备不受影响。 */
export async function unpublishAutomlTrainingFromMarket(taskId: AutomlId): Promise<AutomlTrainingPublication> {
  return fetchAutoml<AutomlTrainingPublication>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/market/unpublish`,
    { method: "POST" },
  );
}

// ---- 训练版本家族（§9.13）：模型 = 多个训练版本 ----

export type AutomlTrainingVersionItem = {
  modelVersionId: AutomlId;
  version: string;
  trainingTaskId: AutomlId;
  taskName: string | null;
  taskStatusCd: string | null;
  datasetVersionId: AutomlId | null;
  datasetVersionNumber: string | null;
  metricsJson: Record<string, number> | null;
  packageReady: boolean;
  registeredAt: string | null;
  activeDeviceNames: string[] | null;
};

export type AutomlTrainingVersionFamily = {
  modelId: AutomlId | null;
  modelCode: string | null;
  modelName: string | null;
  marketStatusCd: "LISTED" | "UNLISTED" | null;
  versions: AutomlTrainingVersionItem[];
};

/** 任务所属模型版本家族：自身发布版本 → 沿 sourceTrainingTaskId 回溯最近已发布祖先。 */
export async function listAutomlTrainingTaskVersions(taskId: AutomlId): Promise<AutomlTrainingVersionFamily> {
  return fetchAutoml<AutomlTrainingVersionFamily>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/versions`,
  );
}

/** 任务的部署历史（经模型版本关联，issued_at 降序）；测试验证入口置灰依据。 */
export async function listAutomlTrainingTaskDeployments(taskId: AutomlId): Promise<AutomlDeviceDeployment[]> {
  return fetchAutoml<AutomlDeviceDeployment[]>(
    `/training-tasks/${encodeURIComponent(String(taskId))}/deployments`,
  );
}
