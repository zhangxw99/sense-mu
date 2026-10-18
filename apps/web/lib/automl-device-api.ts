// 设备域 API 客户端（automl-api.md §6.3~§6.8）。
// 复用 automl-data-api 的 fetchAutoml：同一后端地址、同一 token 注入与超时语义。
import {
  type AutomlId,
  type AutomlPage,
  fetchAutoml,
} from "./automl-data-api.ts";

export type AutomlDeviceStatus = "ONLINE" | "OFFLINE" | "DISABLED";

export type AutomlDeviceCapability = {
  os?: string;
  architecture?: string;
  accelerator?: string;
  gpuName?: string;
  cudaVersion?: string;
  tensorrtVersion?: string;
  supportedFormats?: string[];
  runtime?: string;
  supportsDetect?: boolean;
  supportedTrainingTypes?: string[];
} & Record<string, unknown>;

/**
 * 设备训练能力：true=支持训练 / false=端侧明确不支持（supportedTrainingTypes 为空，
 * 训练未启用或缺少依赖）/ null=旧版端侧未上报（能力未知，后端按放行兜底）。
 */
export function deviceTrainingCapability(device: AutomlDevice): boolean | null {
  const types = device.capabilityJson?.supportedTrainingTypes;
  return Array.isArray(types) ? types.length > 0 : null;
}

/** 下发训练的设备候选：排除端侧明确不支持训练的设备（能力未知保留，由后端最终校验）。 */
export function trainingCapableDevices(devices: AutomlDevice[]): AutomlDevice[] {
  return devices.filter((device) => deviceTrainingCapability(device) !== false);
}

export type AutomlDeviceGpuResource = {
  name?: string | null;
  memTotalMb?: number | null;
  memUsedMb?: number | null;
  memFreeMb?: number | null;
  utilPercent?: number | null;
};

export type AutomlDeviceResourceSnapshot = {
  memTotalMb?: number | null;
  memAvailableMb?: number | null;
  memUsedMb?: number | null;
  memPercent?: number | null;
  diskFreeMb?: number | null;
  loadAvg1?: number | null;
  gpu?: AutomlDeviceGpuResource | null;
} & Record<string, unknown>;

export type AutomlDeviceServiceInfo = {
  name: string;
  status: string;
  version?: string | null;
  pid?: number | null;
  port?: number | null;
  uptimeSec?: number | null;
  // 多实例区分：resident=常驻实例；session-*=临时推理会话实例
  instanceId?: string | null;
  ephemeral?: boolean;
  // inference-service 专属：心跳附带实际加载的模型与运行时（运行服务表第二行展示）
  model?: { modelId?: string | null; modelVersion?: string | null; runtime?: string | null } | null;
} & Record<string, unknown>;

export type AutomlDeviceRuntimeState = {
  status?: string;
  inference?: {
    ready?: boolean;
    modelLoaded?: boolean;
    activeModelId?: string | null;
    activeModelVersion?: string | null;
    executionProvider?: string | null;
    serviceVersion?: string | null;
    runtime?: string | null;
    apiAlias?: string | null;
    aliasAvailable?: boolean | null;
  } | null;
  resources?: AutomlDeviceResourceSnapshot | null;
  services?: AutomlDeviceServiceInfo[] | null;
} & Record<string, unknown>;

export type AutomlDevice = {
  deviceId: AutomlId;
  deviceCode: string;
  name: string;
  deviceType: string;
  runtime: string;
  endpoint: string | null;
  accessMode: string;
  statusCd: AutomlDeviceStatus;
  lastOnlineAt: string | null;
  agentVersion: string | null;
  currentModel: string | null;
  capabilityJson: AutomlDeviceCapability | null;
  lastStateJson: AutomlDeviceRuntimeState | null;
  createTime: string | null;
};

export type AutomlDeploymentStatus =
  | "CREATED"
  | "ISSUED"
  | "DOWNLOADING"
  | "VALIDATING"
  | "HEALTH_CHECKING"
  | "ACTIVE"
  | "FAILED"
  | "ROLLED_BACK"
  | "CANCELLED";

export type AutomlDeploymentServiceInfo = {
  serviceName?: string;
  port?: number;
  baseUrl?: string;
  runtime?: string;
  modelCode?: string;
  modelVersion?: string;
  classes?: string[];
} & Record<string, unknown>;

export type AutomlDeviceDeployment = {
  deploymentId: AutomlId;
  deploymentCode: string;
  deviceId: AutomlId;
  modelVersionId: AutomlId;
  statusCd: AutomlDeploymentStatus;
  issuedAt: string | null;
  activatedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  serviceInfo?: AutomlDeploymentServiceInfo | null;
  deviceName?: string | null;
  deviceStatusCd?: AutomlDeviceStatus | null;
  modelName?: string | null;
  modelVersion?: string | null;
  /** 服务别名：接口地址路径段（POST /{apiAlias}/detect）；空=未设置，回退 /v1/detect */
  apiAlias?: string | null;
};

export const deviceStatusLabel: Record<AutomlDeviceStatus, string> = {
  ONLINE: "在线",
  OFFLINE: "离线",
  DISABLED: "已禁用",
};

export const deploymentStatusLabel: Record<AutomlDeploymentStatus, string> = {
  CREATED: "已创建",
  ISSUED: "已下发",
  DOWNLOADING: "下载中",
  VALIDATING: "校验中",
  HEALTH_CHECKING: "健康检查中",
  ACTIVE: "已激活",
  FAILED: "失败",
  ROLLED_BACK: "已回滚",
  CANCELLED: "已取消",
};

const DEPLOYMENT_ACTIVE_STATUSES: AutomlDeploymentStatus[] = [
  "CREATED",
  "ISSUED",
  "DOWNLOADING",
  "VALIDATING",
  "HEALTH_CHECKING",
];

export function isDeploymentInProgress(status: AutomlDeploymentStatus): boolean {
  return DEPLOYMENT_ACTIVE_STATUSES.includes(status);
}

/**
 * 部署记录的「运行中」判定：ACTIVE 历史不会被置换，运行中 = 后端 statusCd=ACTIVE
 * 列表（每设备最新一次激活）∩ 本记录。任务详情页等原始部署历史不能只看 statusCd，
 * 否则设备切换模型后旧记录仍会被误标为运行中。
 */
export function resolveRunningDeployment(
  deployments: AutomlDeviceDeployment[],
  runningRows: AutomlDeviceDeployment[] | null,
): AutomlDeviceDeployment | null {
  if (!runningRows) return null;
  const runningById = new Map(runningRows.map((row) => [String(row.deploymentId), row]));
  for (const deployment of deployments) {
    if (deployment.statusCd !== "ACTIVE") continue;
    // 命中时返回运行中列表的富化行（带 deviceName/apiAlias），任务历史行没有这些字段
    const running = runningById.get(String(deployment.deploymentId));
    if (running) return running;
  }
  return null;
}

export async function listAutomlDevices(
  params: {
    page?: number;
    limit?: number;
    keyword?: string;
    statusCd?: string;
    accessMode?: string;
    deviceType?: string;
  } = {},
): Promise<AutomlPage<AutomlDevice>> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 10),
  });
  for (const key of ["keyword", "statusCd", "accessMode", "deviceType"] as const) {
    const value = params[key]?.trim();
    if (value) query.set(key, value);
  }
  return fetchAutoml<AutomlPage<AutomlDevice>>(`/devices?${query.toString()}`);
}

export async function getAutomlDevice(deviceId: AutomlId): Promise<AutomlDevice> {
  return fetchAutoml<AutomlDevice>(`/devices/${encodeURIComponent(String(deviceId))}`);
}

export async function setAutomlDeviceStatus(
  deviceId: AutomlId,
  statusCd: "ENABLED" | "DISABLED",
): Promise<void> {
  await fetchAutoml<null>(
    `/devices/${encodeURIComponent(String(deviceId))}/statusCd`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusCd }),
    },
  );
}

export async function deleteAutomlDevice(deviceId: AutomlId): Promise<void> {
  await fetchAutoml<null>(`/devices/${encodeURIComponent(String(deviceId))}`, { method: "DELETE" });
}

export async function createAutomlDeviceDeployment(
  deviceId: AutomlId,
  modelVersionId: AutomlId,
  apiAlias?: string | null,
): Promise<AutomlDeviceDeployment> {
  return fetchAutoml<AutomlDeviceDeployment>(
    `/devices/${encodeURIComponent(String(deviceId))}/deployments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelVersionId, ...(apiAlias?.trim() ? { apiAlias: apiAlias.trim() } : {}) }),
    },
  );
}

export async function getAutomlDeviceDeployment(deploymentId: AutomlId): Promise<AutomlDeviceDeployment> {
  return fetchAutoml<AutomlDeviceDeployment>(
    `/devices/deployments/${encodeURIComponent(String(deploymentId))}`,
  );
}

export async function listAutomlDeviceDeployments(deviceId: AutomlId): Promise<AutomlDeviceDeployment[]> {
  return fetchAutoml<AutomlDeviceDeployment[]>(
    `/devices/${encodeURIComponent(String(deviceId))}/deployments`,
  );
}

// 跨设备部署分页列表（§6.11.2）：部署总览页「运行中」（statusCd=ACTIVE，
// 后端按每设备最新一次激活去重）与「部署记录」共用。
export async function listAutomlDeployments(
  params: {
    page?: number;
    limit?: number;
    deviceId?: AutomlId;
    statusCd?: string;
  } = {},
): Promise<AutomlPage<AutomlDeviceDeployment>> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 10),
  });
  if (params.deviceId != null) query.set("deviceId", String(params.deviceId));
  if (params.statusCd?.trim()) query.set("statusCd", params.statusCd.trim());
  return fetchAutoml<AutomlPage<AutomlDeviceDeployment>>(
    `/devices/deployments?${query.toString()}`,
  );
}
