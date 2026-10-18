import type { AutomlPlatformConfigSchema } from "./automl-platform-api.ts";
import { paramPriority } from "./automl-platform-schema.ts";

// 训练参数展示条目：键 + 中文标题（来自平台 configSchemaJson.title）+ 格式化值
export type TrainingParamEntry = {
  key: string;
  title: string;
  value: string;
  // schema 标注的默认值，与当前值不同时提示（如“默认 100”）
  defaultValue: string | null;
  description: string | null;
};

function formatParamValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDefault(value: unknown): string | null {
  if (value == null || value === "") return null;
  return formatParamValue(value);
}

export function buildTrainingParamEntries(
  params: Record<string, unknown> | null | undefined,
  schema: AutomlPlatformConfigSchema | null | undefined,
): TrainingParamEntry[] {
  if (!params || typeof params !== "object") return [];
  const properties = schema?.properties ?? {};
  // schema 参数按优先级排序（lr/optimizer 等常用在前），schema 外的键按字母序追加在后
  const knownKeys = Object.keys(properties)
    .filter((key) => key in params)
    .map((key, index) => ({ key, priority: paramPriority(key, properties[key]), index }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map((item) => item.key);
  const extraKeys = Object.keys(params)
    .filter((key) => !(key in properties))
    .sort();
  return [...knownKeys, ...extraKeys].map((key) => {
    const property = properties[key];
    const title = typeof property?.title === "string" && property.title.trim() ? property.title.trim() : null;
    return {
      key,
      title: title ?? key,
      value: formatParamValue(params[key]),
      defaultValue: formatDefault(property?.default),
      description: typeof property?.description === "string" && property.description.trim() ? property.description.trim() : null,
    };
  });
}
