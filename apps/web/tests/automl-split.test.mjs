import assert from "node:assert/strict";
import test from "node:test";

// 纯函数模块，Node 原生类型剥离可直接导入
const { autoSplitCounts, shuffledIndexes } = await import("../lib/automl-split.ts");

test("autoSplitCounts 按 70/20/10 精确分配整除样本数", () => {
  assert.deepEqual(autoSplitCounts(100, { train: 70, val: 20, test: 10 }), {
    train: 70,
    val: 20,
    test: 10,
  });
});

test("autoSplitCounts 余数全部落入测试集，总数守恒", () => {
  // round(10*0.7)=7, round(10*0.2)=2, 剩余 1 → test
  assert.deepEqual(autoSplitCounts(10, { train: 70, val: 20, test: 10 }), {
    train: 7,
    val: 2,
    test: 1,
  });
});

test("autoSplitCounts 极小样本不为负、总数守恒", () => {
  const counts = autoSplitCounts(2, { train: 70, val: 20, test: 10 });
  assert.deepEqual(counts, { train: 1, val: 0, test: 1 });
  assert.equal(counts.train + counts.val + counts.test, 2);
});

test("autoSplitCounts 空数据集返回全零", () => {
  assert.deepEqual(autoSplitCounts(0, { train: 70, val: 20, test: 10 }), {
    train: 0,
    val: 0,
    test: 0,
  });
});

test("autoSplitCounts 允许测试集为 0 的两分比例", () => {
  const counts = autoSplitCounts(50, { train: 80, val: 20, test: 0 });
  assert.deepEqual(counts, { train: 40, val: 10, test: 0 });
});

test("shuffledIndexes 返回 0..n-1 的一个排列", () => {
  const permutation = shuffledIndexes(100, () => 0.42);
  assert.equal(permutation.length, 100);
  assert.deepEqual(
    [...permutation].sort((a, b) => a - b),
    Array.from({ length: 100 }, (_, i) => i),
  );
});

test("shuffledIndexes 空数据集返回空数组", () => {
  assert.deepEqual(shuffledIndexes(0), []);
});

test("shuffledIndexes 不同随机源给出不同排列", () => {
  const a = shuffledIndexes(50);
  const b = shuffledIndexes(50);
  assert.notDeepEqual(a, b);
});
