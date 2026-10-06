// 训练平台主数据域 API 客户端（常量 / 训练平台 / 基础模型）。
// 复用 automl-data-api 的 fetchAutoml：同一后端地址、同一 token 注入与超时语义。
import {
  type AutomlId,
  fetchAutoml,
} from "./automl-data-api.ts";

// automl-data-api 未导出 jsonInit，这里按同样语义本地定义
function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export type AutomlConstant = {
  id: AutomlId;
  constType: string;
  code: string;
  name: string;
  sortOrder: number;
  statusCd: string;
  remark: string | null;
  createTime: string;
  updateTime: string;
};

export type AutomlPlatformConfigProperty = {
  type?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  [key: string]: unknown;
};

export type AutomlPlatformConfigSchema = {
  type?: string;
  properties?: Record<string, AutomlPlatformConfigProperty>;
  required?: string[];
  [key: string]: unknown;
};

export type AutomlPlatform = {
  id: AutomlId;
  platformCode: string;
  name: string;
  framework: string | null;
  operatorKey: string | null;
  taskTypes: string[];
  configSchemaJson: AutomlPlatformConfigSchema | null;
  sortOrder: number;
  statusCd: string;
  description: string | null;
  baseModelCount: number;
  createTime: string;
  updateTime: string;
};

export type AutomlPlatformOption = {
  platformId: AutomlId;
  platformCode: string;
  name: string;
  framework: string | null;
  operatorKey: string | null;
  taskTypes: string[];
  configSchemaJson: AutomlPlatformConfigSchema | null;
  baseModels: AutomlBaseModel[];
};

export type AutomlBaseModel = {
  id: AutomlId;
  platformId: AutomlId;
  modelCode: string;
  name: string;
  taskType: string | null;
  weightsObjectKey: string | null;
  // 权重与规模字段后端为 Long，序列化后可能是 string，展示时用 Number() 归一
  weightsFileSize: AutomlId | null;
  weightsChecksum: string | null;
  paramCount: AutomlId | null;
  modelSizeBytes: AutomlId | null;
  flops: AutomlId | null;
  inputSize: string | null;
  defaultConfigJson: Record<string, unknown> | null;
  sortOrder: number;
  statusCd: string;
  remark: string | null;
  createTime: string;
  updateTime: string;
};

export type AutomlPlatformInput = {
  name: string;
  framework?: string;
  operatorKey?: string;
  taskTypes?: string[];
  configSchemaJson?: Record<string, unknown> | null;
  sortOrder?: number;
  statusCd?: string;
  description?: string;
};

export type AutomlBaseModelInput = {
  name: string;
  taskType?: string;
  weightsObjectKey?: string;
  weightsFileSize?: number;
  weightsChecksum?: string;
  paramCount?: number;
  modelSizeBytes?: number;
  flops?: number;
  inputSize?: string;
  defaultConfigJson?: Record<string, unknown> | null;
  sortOrder?: number;
  statusCd?: string;
  remark?: string;
};

export const AUTOML_CONSTANT_TYPES = ["TASK_TYPE", "FRAMEWORK"] as const;

export const constantTypeLabels: Record<string, string> = {
  TASK_TYPE: "任务类型",
  FRAMEWORK: "训练框架",
};

export const statusCdLabels: Record<string, string> = {
  ENABLED: "启用",
  DISABLED: "停用",
};

export async function listAutomlConstants(
  params: { constType?: string; statusCd?: string } = {},
): Promise<AutomlConstant[]> {
  const query = new URLSearchParams();
  for (const key of ["constType", "statusCd"] as const) {
    const value = params[key]?.trim();
    if (value) query.set(key, value);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return fetchAutoml<AutomlConstant[]>(`/constants${suffix}`);
}

export async function createAutomlConstant(input: {
  constType: string;
  code: string;
  name: string;
  sortOrder?: number;
  statusCd?: string;
  remark?: string;
}): Promise<AutomlConstant> {
  return fetchAutoml<AutomlConstant>("/constants", jsonInit("POST", input));
}

// code/constType 创建后不可改，更新体只带可变字段
export async function updateAutomlConstant(
  id: AutomlId,
  input: { name: string; sortOrder?: number; statusCd?: string; remark?: string },
): Promise<AutomlConstant> {
  return fetchAutoml<AutomlConstant>(
    `/constants/${encodeURIComponent(String(id))}`,
    jsonInit("PUT", input),
  );
}

export async function deleteAutomlConstant(id: AutomlId): Promise<void> {
  await fetchAutoml<null>(`/constants/${encodeURIComponent(String(id))}`, { method: "DELETE" });
}

export async function listAutomlPlatforms(
  params: { keyword?: string; statusCd?: string } = {},
): Promise<AutomlPlatform[]> {
  const query = new URLSearchParams();
  for (const key of ["keyword", "statusCd"] as const) {
    const value = params[key]?.trim();
    if (value) query.set(key, value);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return fetchAutoml<AutomlPlatform[]>(`/training-platforms${suffix}`);
}

export async function listAutomlPlatformOptions(taskType?: string): Promise<AutomlPlatformOption[]> {
  const trimmed = taskType?.trim();
  const suffix = trimmed ? `?taskType=${encodeURIComponent(trimmed)}` : "";
  return fetchAutoml<AutomlPlatformOption[]>(`/training-platforms/options${suffix}`);
}

export async function getAutomlPlatform(id: AutomlId): Promise<AutomlPlatform> {
  return fetchAutoml<AutomlPlatform>(`/training-platforms/${encodeURIComponent(String(id))}`);
}

export async function createAutomlPlatform(
  input: AutomlPlatformInput & { platformCode: string },
): Promise<AutomlPlatform> {
  return fetchAutoml<AutomlPlatform>("/training-platforms", jsonInit("POST", input));
}

export async function updateAutomlPlatform(
  id: AutomlId,
  input: AutomlPlatformInput,
): Promise<AutomlPlatform> {
  return fetchAutoml<AutomlPlatform>(
    `/training-platforms/${encodeURIComponent(String(id))}`,
    jsonInit("PUT", input),
  );
}

export async function setAutomlPlatformStatus(id: AutomlId, statusCd: string): Promise<void> {
  await fetchAutoml<null>(
    `/training-platforms/${encodeURIComponent(String(id))}/status`,
    jsonInit("PUT", { statusCd }),
  );
}

export async function deleteAutomlPlatform(id: AutomlId): Promise<void> {
  await fetchAutoml<null>(`/training-platforms/${encodeURIComponent(String(id))}`, { method: "DELETE" });
}

export async function listAutomlPlatformBaseModels(
  platformId: AutomlId,
  taskType?: string,
): Promise<AutomlBaseModel[]> {
  const trimmed = taskType?.trim();
  const suffix = trimmed ? `?taskType=${encodeURIComponent(trimmed)}` : "";
  return fetchAutoml<AutomlBaseModel[]>(
    `/training-platforms/${encodeURIComponent(String(platformId))}/base-models${suffix}`,
  );
}

export async function createAutomlPlatformBaseModel(
  platformId: AutomlId,
  input: AutomlBaseModelInput & { modelCode: string },
): Promise<AutomlBaseModel> {
  return fetchAutoml<AutomlBaseModel>(
    `/training-platforms/${encodeURIComponent(String(platformId))}/base-models`,
    jsonInit("POST", input),
  );
}

export async function updateAutomlBaseModel(
  baseModelId: AutomlId,
  input: AutomlBaseModelInput,
): Promise<AutomlBaseModel> {
  return fetchAutoml<AutomlBaseModel>(
    `/training-platforms/base-models/${encodeURIComponent(String(baseModelId))}`,
    jsonInit("PUT", input),
  );
}

export async function setAutomlBaseModelStatus(baseModelId: AutomlId, statusCd: string): Promise<void> {
  await fetchAutoml<null>(
    `/training-platforms/base-models/${encodeURIComponent(String(baseModelId))}/status`,
    jsonInit("PUT", { statusCd }),
  );
}

export async function deleteAutomlBaseModel(baseModelId: AutomlId): Promise<void> {
  await fetchAutoml<null>(
    `/training-platforms/base-models/${encodeURIComponent(String(baseModelId))}`,
    { method: "DELETE" },
  );
}
