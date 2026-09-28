import assert from "node:assert/strict";
import test from "node:test";

// annotation-geometry.ts 为零依赖纯函数，可直接以 Node 原生类型剥离导入
const { containFramePercentages } = await import("../lib/annotation-geometry.ts");

test("图片相对画布更高时上下贴边、左右居中", () => {
  // 画布 2:1，图片 1:1 → 图片高度撑满、宽度为一半
  const frame = containFramePercentages(1000, 500, 800, 800);
  assert.deepEqual(frame, { left: 25, top: 0, width: 50, height: 100 });
});

test("图片相对画布更宽时左右贴边、上下居中", () => {
  // 画布 1:2，图片 1:1 → 图片宽度撑满、高度为一半
  const frame = containFramePercentages(500, 1000, 800, 800);
  assert.deepEqual(frame, { left: 0, top: 25, width: 100, height: 50 });
});

test("等比缩放画布时百分比不变（框随图片自动跟随）", () => {
  const a = containFramePercentages(1000, 600, 1500, 1000);
  const b = containFramePercentages(2000, 1200, 1500, 1000);
  assert.deepEqual(a, b);
});

test("画布与图片比例相同时完全铺满", () => {
  const frame = containFramePercentages(1200, 800, 1200, 800);
  assert.deepEqual(frame, { left: 0, top: 0, width: 100, height: 100 });
});

test("非法尺寸返回 null", () => {
  assert.equal(containFramePercentages(0, 500, 800, 800), null);
  assert.equal(containFramePercentages(1000, 500, 0, 800), null);
  assert.equal(containFramePercentages(Number.NaN, 500, 800, 800), null);
});
