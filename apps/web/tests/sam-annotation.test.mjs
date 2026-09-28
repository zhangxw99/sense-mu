import assert from "node:assert/strict";
import test from "node:test";

// sam-annotation.ts 为零依赖纯函数，可直接以 Node 原生类型剥离导入
const { samDetectionsToBoxDrafts } = await import("../lib/sam-annotation.ts");

test("bbox 像素坐标按 image_size（高, 宽）归一化为图片百分比", () => {
  const { drafts, skipped } = samDetectionsToBoxDrafts(
    [{ class: "crack", conf: 0.87, bbox: [120.5, 300, 860.2, 980.7] }],
    [1080, 1920],
    ["crack"],
  );
  assert.equal(skipped, 0);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].label, "crack");
  assert.equal(drafts[0].colorIndex, 0);
  assert.equal(drafts[0].confidence, 0.87);
  assert.ok(Math.abs(drafts[0].x - (120.5 / 1920) * 100) < 1e-9);
  assert.ok(Math.abs(drafts[0].y - (300 / 1080) * 100) < 1e-9);
  assert.ok(Math.abs(drafts[0].width - ((860.2 - 120.5) / 1920) * 100) < 1e-9);
  assert.ok(Math.abs(drafts[0].height - ((980.7 - 300) / 1080) * 100) < 1e-9);
});

test("类别匹配不区分大小写与首尾空白，colorIndex 取数据集类别序号", () => {
  const { drafts, skipped } = samDetectionsToBoxDrafts(
    [
      { class: " CRACK ", conf: 0.5, bbox: [0, 0, 10, 10] },
      { class: "pothole", conf: 0.6, bbox: [20, 20, 30, 30] },
    ],
    [1000, 1000],
    ["Crack", "Pothole", "Spalling"],
  );
  assert.equal(skipped, 0);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].label, "Crack");
  assert.equal(drafts[0].colorIndex, 0);
  assert.equal(drafts[1].label, "Pothole");
  assert.equal(drafts[1].colorIndex, 1);
});

test("无法匹配数据集类别的检出计入 skipped", () => {
  const { drafts, skipped } = samDetectionsToBoxDrafts(
    [
      { class: "elephant", conf: 0.9, bbox: [0, 0, 10, 10] },
      { class: "crack", conf: 0.9, bbox: [0, 0, 10, 10] },
    ],
    [1000, 1000],
    ["crack"],
  );
  assert.equal(skipped, 1);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].label, "crack");
});

test("越界 bbox 被裁剪到 0-100 且宽高不越界", () => {
  const { drafts } = samDetectionsToBoxDrafts(
    [{ class: "crack", conf: 0.5, bbox: [-50, -50, 5000, 5000] }],
    [1000, 1000],
    ["crack"],
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].x, 0);
  assert.equal(drafts[0].y, 0);
  assert.equal(drafts[0].width, 100);
  assert.equal(drafts[0].height, 100);
});

test("零面积与坐标倒置的检出按无效忽略", () => {
  const { drafts, skipped } = samDetectionsToBoxDrafts(
    [
      { class: "crack", conf: 0.5, bbox: [10, 10, 10, 10] },
      { class: "crack", conf: 0.5, bbox: [30, 30, 20, 20] },
    ],
    [1000, 1000],
    ["crack"],
  );
  assert.equal(drafts.length, 0);
  assert.equal(skipped, 2);
});

test("空检出与非法 image_size 不抛错", () => {
  assert.deepEqual(samDetectionsToBoxDrafts([], [1080, 1920], ["crack"]), { drafts: [], skipped: 0 });
  const invalid = samDetectionsToBoxDrafts([{ class: "crack", conf: 0.5, bbox: [0, 0, 10, 10] }], [0, 0], ["crack"]);
  assert.deepEqual(invalid, { drafts: [], skipped: 1 });
});
