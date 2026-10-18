import assert from "node:assert/strict";
import test from "node:test";

const quality = await import("../lib/metric-quality.ts");
const params = await import("../lib/training-params.ts");

test("metricQualityScore 兼容 0-1 与百分比并钳位", () => {
  assert.equal(quality.metricQualityScore(0.087), 0.087);
  assert.equal(quality.metricQualityScore(87), 0.87);
  assert.equal(quality.metricQualityScore(120), 1);
  assert.equal(quality.metricQualityScore(-5), 0);
  assert.equal(quality.metricQualityScore(null), 0);
  assert.equal(quality.metricQualityScore(Number.NaN), 0);
});

test("metricQualityColor 红绿端点与单调过渡", () => {
  const bad = quality.metricQualityColor(0);
  const good = quality.metricQualityColor(1);
  const mid = quality.metricQualityColor(0.5);
  assert.match(bad.background, /^hsl\(4(\.0)? 64% 94%\)$/);
  assert.match(good.background, /^hsl\(145(\.0)? 64% 88%\)$/);
  // 中间分数的色相介于红绿之间
  const hueOf = (s) => Number(s.background.match(/hsl\((\d+(?:\.\d+)?)/)[1]);
  assert.ok(hueOf(bad) < hueOf(mid) && hueOf(mid) < hueOf(good));
  // 中间分数背景明度介于两端之间（低分更浅）
  assert.ok(bad.background.includes("94%") && good.background.includes("88%"));
});

test("metricQualityColor 低分偏红、高分偏绿（实测读数）", () => {
  // mAP50 8.7% 的实测场景：应明显偏红（hue < 20）
  const low = quality.metricQualityColor(0.087);
  assert.ok(Number(low.background.match(/hsl\((\d+)/)[1]) < 20);
  // 87% 应明显偏绿（hue > 120）
  const high = quality.metricQualityColor(0.87);
  assert.ok(Number(high.background.match(/hsl\((\d+)/)[1]) > 120);
});

test("buildTrainingParamEntries 用 schema 标题排序并保留未知键", () => {
  const schema = {
    type: "object",
    properties: {
      epochs: { type: "integer", title: "训练轮数", default: 100 },
      imgsz: { type: "integer", title: "输入尺寸", default: 640 },
      batch: { type: "integer", title: "批大小" },
    },
  };
  const entries = params.buildTrainingParamEntries(
    { custom_flag: true, batch: 16, epochs: 50, imgsz: 640 },
    schema,
  );
  // 默认优先级序：epochs(10) batch(20) imgsz(30)，schema 外键垫底
  assert.deepEqual(entries.map((entry) => entry.key), ["epochs", "batch", "imgsz", "custom_flag"]);
  assert.equal(entries[0].title, "训练轮数");
  assert.equal(entries[0].value, "50");
  assert.equal(entries[0].defaultValue, "100");
  assert.equal(entries[2].defaultValue, "640");
  assert.equal(entries[1].defaultValue, null);
  assert.equal(entries[3].title, "custom_flag");
  assert.equal(entries[3].value, "是");
});

test("buildTrainingParamEntries 显式 x-priority 覆盖默认序", () => {
  const schema = {
    properties: {
      lr0: { type: "number", title: "初始学习率", "x-priority": 5 },
      epochs: { type: "integer", title: "训练轮数" },
      optimizer: { type: "string", title: "优化器" },
    },
  };
  const entries = params.buildTrainingParamEntries({ epochs: 30, optimizer: "auto", lr0: 0.01 }, schema);
  assert.deepEqual(entries.map((entry) => entry.key), ["lr0", "epochs", "optimizer"]);
});

test("buildTrainingParamEntries 兜底：无 schema/空参数", () => {
  const entries = params.buildTrainingParamEntries({ lr0: 0.01 }, null);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "lr0");
  assert.equal(entries[0].value, "0.01");
  assert.deepEqual(params.buildTrainingParamEntries(null, null), []);
  // 非整数数字保留小数，布尔转是/否
  const bool = params.buildTrainingParamEntries({ amp: false, x: 1.5 }, null);
  assert.equal(bool[0].value, "否");
  assert.equal(bool[1].value, "1.5");
});
