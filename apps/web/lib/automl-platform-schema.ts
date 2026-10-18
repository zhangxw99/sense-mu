// 训练平台参数 Schema（JSON Schema）与表单编辑态之间的转换工具。
// 平台维护页的可编辑参数卡片、训练创建/下发表单的动态参数渲染都基于这里，
// 保证「平台 configSchemaJson」是训练参数的唯一来源。
import type {
  AutomlPlatformConfigProperty,
  AutomlPlatformConfigSchema,
} from "./automl-platform-api.ts";

export const PARAM_TYPES = ["integer", "number", "string", "boolean"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export const PARAM_TYPE_LABELS: Record<ParamType, string> = {
  integer: "整数",
  number: "数字",
  string: "字符串",
  boolean: "布尔",
};

// JSON Schema 扩展字段：标记该参数为「高级」，表单默认折叠进高级抽屉
export const ADVANCED_FLAG = "x-advanced";

// JSON Schema 扩展字段：参数优先级（数值越小越靠前）。未显式配置时走常见参数默认序，
// 保证 lr/optimizer 等高频参数排在前面的同时，平台仍可按需自定义。
export const PRIORITY_FLAG = "x-priority";

export const DEFAULT_PARAM_PRIORITY: Record<string, number> = {
  epochs: 10,
  batch: 20,
  imgsz: 30,
  optimizer: 40,
  lr0: 50,
  patience: 60,
  seed: 70,
  device: 80,
  workers: 90,
};
const FALLBACK_PRIORITY = 100;

// 参数生效优先级：显式 x-priority > 常见参数默认表 > 兜底值
export function paramPriority(key: string, property: AutomlPlatformConfigProperty | null | undefined): number {
  const explicit = property?.[PRIORITY_FLAG];
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  return DEFAULT_PARAM_PRIORITY[key] ?? FALLBACK_PRIORITY;
}

// 按优先级稳定排序：同优先级保持声明顺序
export function sortSchemaEntries(entries: SchemaParamEntry[]): SchemaParamEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      paramPriority(left.entry.key, left.entry.property)
        - paramPriority(right.entry.key, right.entry.property)
      || left.index - right.index)
    .map(({ entry }) => entry);
}

// 参数卡片编辑态：default/min/max/enum 以文本承载，保存时按 type 还原成 JSON 值
export type PlatformParamRow = {
  key: string;
  type: ParamType;
  title: string;
  defaultValue: string;
  min: string;
  max: string;
  enumText: string;
  advanced: boolean;
  // 优先级文本：空 = 跟随默认序（展示默认表/兜底值），数字 = 显式覆盖
  priority: string;
  // 原属性里本编辑器不识别的字段，保存时原样保留
  extra: Record<string, unknown>;
};

export type SchemaParamEntry = { key: string; property: AutomlPlatformConfigProperty };

const HANDLED_FIELDS = new Set(["type", "title", "default", "minimum", "maximum", "enum", ADVANCED_FLAG, PRIORITY_FLAG]);

export function paramType(property: AutomlPlatformConfigProperty | null | undefined): ParamType {
  return PARAM_TYPES.find((type) => type === property?.type) ?? "string";
}

export function isAdvancedProperty(property: AutomlPlatformConfigProperty | null | undefined): boolean {
  return property?.[ADVANCED_FLAG] === true;
}

function textValue(value: unknown): string {
  if (value == null || typeof value === "object") return "";
  return String(value);
}

export function schemaToParamRows(schema: AutomlPlatformConfigSchema | null | undefined): PlatformParamRow[] {
  const built = Object.entries(schema?.properties ?? {}).map(([key, rawProperty], index) => {
    const property = (rawProperty ?? {}) as AutomlPlatformConfigProperty;
    const extra: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(property)) {
      if (!HANDLED_FIELDS.has(field)) extra[field] = value;
    }
    const explicitPriority = property[PRIORITY_FLAG];
    return {
      index,
      priority: paramPriority(key, property),
      row: {
        key,
        type: paramType(property),
        title: typeof property.title === "string" ? property.title : "",
        defaultValue: textValue(property.default),
        min: property.minimum == null ? "" : String(property.minimum),
        max: property.maximum == null ? "" : String(property.maximum),
        enumText: Array.isArray(property.enum) ? property.enum.map((value) => String(value)).join(",") : "",
        advanced: isAdvancedProperty(property),
        priority: typeof explicitPriority === "number" && Number.isFinite(explicitPriority) ? String(explicitPriority) : "",
        extra,
      },
    };
  });
  // 编辑器/表单展示统一按优先级排序（lr/optimizer 等常用参数在前），同优先级保持声明顺序
  return built
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map((item) => item.row);
}

export function emptyParamRow(): PlatformParamRow {
  return {
    key: "",
    type: "integer",
    title: "",
    defaultValue: "",
    min: "",
    max: "",
    enumText: "",
    advanced: false,
    priority: "",
    extra: {},
  };
}

// 新建平台时的参数预设：与 yolo26 种子口径一致（常用 4 项 + 高级 2 项），可继续增删改
export function defaultParamRows(): PlatformParamRow[] {
  return schemaToParamRows({
    type: "object",
    properties: {
      epochs: { type: "integer", title: "训练轮数", minimum: 1, maximum: 1000, default: 100 },
      batch: { type: "integer", title: "批大小", minimum: 1, maximum: 128, default: 16 },
      imgsz: { type: "integer", title: "输入尺寸", enum: [320, 416, 512, 640, 800, 1024], default: 640 },
      optimizer: { type: "string", title: "优化器", enum: ["auto", "SGD", "Adam", "AdamW"], default: "auto" },
      lr0: { type: "number", title: "初始学习率", minimum: 0.00001, maximum: 1, default: 0.01, [ADVANCED_FLAG]: true },
      patience: { type: "integer", title: "早停耐心值", minimum: 0, default: 50, [ADVANCED_FLAG]: true },
    },
  });
}

function typedScalar(type: ParamType, text: string): number | string | boolean | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (type === "integer" || type === "number") {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (type === "boolean") {
    if (["true", "1"].includes(trimmed)) return true;
    if (["false", "0"].includes(trimmed)) return false;
    return undefined;
  }
  return trimmed;
}

function numericValue(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rowToProperty(row: PlatformParamRow): AutomlPlatformConfigProperty {
  const property: AutomlPlatformConfigProperty = { type: row.type };
  const title = row.title.trim();
  if (title) property.title = title;
  const defaultValue = typedScalar(row.type, row.defaultValue);
  if (defaultValue !== undefined) property.default = defaultValue;
  const minimum = numericValue(row.min);
  if (minimum !== undefined) property.minimum = minimum;
  const maximum = numericValue(row.max);
  if (maximum !== undefined) property.maximum = maximum;
  if (row.type !== "boolean") {
    // 先滤掉空段再转数值：Number("") 是 0，不能当合法枚举值
    const enumValues = row.enumText
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "")
      .map((item) => (row.type === "integer" || row.type === "number" ? Number(item) : item))
      .filter((value) => (typeof value === "number" ? Number.isFinite(value) : true));
    if (enumValues.length) property.enum = enumValues;
  }
  if (row.advanced) property[ADVANCED_FLAG] = true;
  const priority = numericValue(row.priority);
  if (priority !== undefined) property[PRIORITY_FLAG] = priority;
  return { ...property, ...row.extra };
}

// 行为空的参数不输出；全部行为空时返回 null（保存请求省略 configSchemaJson）
export function paramRowsToSchema(rows: PlatformParamRow[]): AutomlPlatformConfigSchema | null {
  const properties: Record<string, AutomlPlatformConfigProperty> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) properties[key] = rowToProperty(row);
  }
  return Object.keys(properties).length ? { type: "object", properties } : null;
}

export function paramRowError(rows: PlatformParamRow[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return "存在未命名的参数，请填写参数名或删除该卡片";
    if (seen.has(key)) return `参数名重复：${key}`;
    seen.add(key);
  }
  return null;
}

// 表单渲染分组：常用参数平铺，高级参数（x-advanced）折叠；组内按优先级排序（常用在前）
export function splitSchemaParams(schema: AutomlPlatformConfigSchema | null | undefined): {
  common: SchemaParamEntry[];
  advanced: SchemaParamEntry[];
} {
  const common: SchemaParamEntry[] = [];
  const advanced: SchemaParamEntry[] = [];
  const indices = new WeakMap<SchemaParamEntry, number>();
  Object.entries(schema?.properties ?? {}).forEach(([key, rawProperty], index) => {
    const property = (rawProperty ?? {}) as AutomlPlatformConfigProperty;
    const entry: SchemaParamEntry = { key, property };
    indices.set(entry, index);
    (isAdvancedProperty(property) ? advanced : common).push(entry);
  });
  const byPriority = (left: SchemaParamEntry, right: SchemaParamEntry) =>
    paramPriority(left.key, left.property) - paramPriority(right.key, right.property)
    || (indices.get(left) ?? 0) - (indices.get(right) ?? 0);
  return {
    common: common.sort(byPriority),
    advanced: advanced.sort(byPriority),
  };
}

// 表单文本 → 类型化参数值；空文本返回 undefined 表示跟随默认（提交时省略，由服务端合并默认值）
export function coerceParamValue(
  property: AutomlPlatformConfigProperty,
  text: string,
): number | string | boolean | undefined {
  if (Array.isArray(property.enum) && property.enum.length) {
    const matched = property.enum.find((candidate) => String(candidate) === text.trim());
    return matched == null ? undefined : (matched as number | string | boolean);
  }
  return typedScalar(paramType(property), text);
}
