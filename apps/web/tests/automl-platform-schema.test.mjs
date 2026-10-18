import assert from "node:assert/strict";
import test from "node:test";

// 纯类型/函数模块，import type 已被类型剥离，无需 window shim
const schemaLib = await import("../lib/automl-platform-schema.ts");

const YOLO_SCHEMA = {
  type: "object",
  properties: {
    epochs: { type: "integer", title: "训练轮数", minimum: 1, maximum: 1000, default: 100 },
    imgsz: { type: "integer", title: "输入尺寸", enum: [320, 416, 512, 640, 800, 1024], default: 640 },
    optimizer: { type: "string", title: "优化器", enum: ["auto", "SGD", "AdamW"], default: "auto" },
    lr0: { type: "number", title: "初始学习率", minimum: 0.00001, default: 0.01, "x-advanced": true },
  },
  required: ["epochs"],
};

test("schemaToParamRows 展开属性并保留未知字段", () => {
  const rows = schemaLib.schemaToParamRows(YOLO_SCHEMA);
  assert.deepEqual(rows.map((row) => row.key), ["epochs", "imgsz", "optimizer", "lr0"]);
  const epochs = rows[0];
  assert.equal(epochs.type, "integer");
  assert.equal(epochs.title, "训练轮数");
  assert.equal(epochs.defaultValue, "100");
  assert.equal(epochs.min, "1");
  assert.equal(epochs.max, "1000");
  assert.equal(epochs.enumText, "");
  assert.equal(epochs.advanced, false);
  assert.equal(rows[1].enumText, "320,416,512,640,800,1024");
  assert.equal(rows[2].type, "string");
  assert.equal(rows[3].advanced, true);
  // 未识别字段（如自定义说明）原样保留在 extra
  const withCustom = schemaLib.schemaToParamRows({
    properties: { epochs: { type: "integer", "x-unit": "epoch" } },
  });
  assert.deepEqual(withCustom[0].extra, { "x-unit": "epoch" });
});

test("paramRowsToSchema 还原 JSON Schema 且往返不丢信息", () => {
  const rows = schemaLib.schemaToParamRows(YOLO_SCHEMA);
  const schema = schemaLib.paramRowsToSchema(rows);
  assert.deepEqual(schema, {
    type: "object",
    properties: {
      epochs: { type: "integer", title: "训练轮数", minimum: 1, maximum: 1000, default: 100 },
      imgsz: { type: "integer", title: "输入尺寸", enum: [320, 416, 512, 640, 800, 1024], default: 640 },
      optimizer: { type: "string", title: "优化器", enum: ["auto", "SGD", "AdamW"], default: "auto" },
      lr0: { type: "number", title: "初始学习率", minimum: 0.00001, default: 0.01, "x-advanced": true },
    },
  });
});

test("paramRowsToSchema 空行返回 null，无名行被丢弃", () => {
  assert.equal(schemaLib.paramRowsToSchema([]), null);
  const schema = schemaLib.paramRowsToSchema([
    schemaLib.emptyParamRow(),
    { ...schemaLib.emptyParamRow(), key: "seed", defaultValue: "0" },
  ]);
  assert.deepEqual(Object.keys(schema.properties), ["seed"]);
  assert.equal(schema.properties.seed.default, 0);
});

test("paramRowError 拦截未命名与重复参数", () => {
  assert.equal(schemaLib.paramRowError([schemaLib.emptyParamRow()]), "存在未命名的参数，请填写参数名或删除该卡片");
  const duplicated = [
    { ...schemaLib.emptyParamRow(), key: "epochs" },
    { ...schemaLib.emptyParamRow(), key: " epochs " },
  ];
  assert.match(schemaLib.paramRowError(duplicated), /参数名重复：epochs/);
  assert.equal(schemaLib.paramRowError([{ ...schemaLib.emptyParamRow(), key: "seed" }]), null);
});

test("splitSchemaParams 按高级标记分组且保持声明顺序", () => {
  const { common, advanced } = schemaLib.splitSchemaParams(YOLO_SCHEMA);
  assert.deepEqual(common.map((entry) => entry.key), ["epochs", "imgsz", "optimizer"]);
  assert.deepEqual(advanced.map((entry) => entry.key), ["lr0"]);
  assert.equal(schemaLib.splitSchemaParams(null).common.length, 0);
});

test("coerceParamValue 按类型与 enum 还原值，空文本表示跟随默认", () => {
  const properties = YOLO_SCHEMA.properties;
  assert.equal(schemaLib.coerceParamValue(properties.epochs, "50"), 50);
  assert.equal(schemaLib.coerceParamValue(properties.epochs, ""), undefined);
  assert.equal(schemaLib.coerceParamValue(properties.lr0, "0.001"), 0.001);
  assert.equal(schemaLib.coerceParamValue(properties.optimizer, "SGD"), "SGD");
  assert.equal(schemaLib.coerceParamValue(properties.optimizer, "unknown"), undefined);
  // 布尔参数
  assert.equal(schemaLib.coerceParamValue({ type: "boolean" }, "true"), true);
  assert.equal(schemaLib.coerceParamValue({ type: "boolean" }, "false"), false);
  assert.equal(schemaLib.coerceParamValue({ type: "boolean" }, ""), undefined);
});

test("paramPriority 显式 x-priority > 默认表 > 兜底 100", () => {
  assert.equal(schemaLib.paramPriority("epochs", { type: "integer" }), 10);
  assert.equal(schemaLib.paramPriority("random_key", { type: "string" }), 100);
  assert.equal(schemaLib.paramPriority("random_key", { type: "string", "x-priority": 5 }), 5);
  assert.equal(schemaLib.paramPriority("epochs", { type: "integer", "x-priority": 50 }), 50);
  // 非法显式值回退默认表
  assert.equal(schemaLib.paramPriority("epochs", { type: "integer", "x-priority": "high" }), 10);
});

test("sortSchemaEntries 按优先级稳定排序，同优先级保持声明顺序", () => {
  const schema = {
    properties: {
      box_loss: { type: "number", "x-priority": 90 },
      lr0: { type: "number", "x-advanced": true },
      custom: { type: "string" },
      epochs: { type: "integer" },
      dfl_loss: { type: "number" },
    },
  };
  const entries = Object.entries(schema.properties).map(([key, property]) => ({ key, property }));
  assert.deepEqual(
    schemaLib.sortSchemaEntries(entries).map((entry) => entry.key),
    ["epochs", "lr0", "box_loss", "custom", "dfl_loss"],
  );
});

test("schemaToParamRows 按优先级排序且行内回显显式优先级", () => {
  const schema = {
    properties: {
      cls_loss: { type: "number" },
      lr0: { type: "number", "x-advanced": true, "x-priority": 15 },
      epochs: { type: "integer" },
    },
  };
  const rows = schemaLib.schemaToParamRows(schema);
  assert.deepEqual(rows.map((row) => row.key), ["epochs", "lr0", "cls_loss"]);
  assert.equal(rows[0].priority, "");
  assert.equal(rows[1].priority, "15");
});

test("paramRowsToSchema 持久化显式优先级，留空不写入", () => {
  const rows = [
    { ...schemaLib.emptyParamRow(), key: "lr0", type: "number", priority: "5" },
    { ...schemaLib.emptyParamRow(), key: "seed", type: "integer" },
  ];
  const schema = schemaLib.paramRowsToSchema(rows);
  assert.equal(schema.properties.lr0["x-priority"], 5);
  assert.equal("x-priority" in schema.properties.seed, false);
});

test("defaultParamRows 与 yolo26 种子口径一致（常用 4 项 + 高级 2 项）", () => {
  const rows = schemaLib.defaultParamRows();
  const common = rows.filter((row) => !row.advanced).map((row) => row.key);
  const advanced = rows.filter((row) => row.advanced).map((row) => row.key);
  assert.deepEqual(common, ["epochs", "batch", "imgsz", "optimizer"]);
  assert.deepEqual(advanced, ["lr0", "patience"]);
});
