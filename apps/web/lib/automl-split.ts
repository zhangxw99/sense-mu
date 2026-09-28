// 自动划分的纯计算逻辑：供数据工作台「一键划分」使用，保持与 UI 解耦以便单测

export type AutoSplitRatios = {
  train: number;
  val: number;
  test: number;
};

export type AutoSplitCounts = {
  train: number;
  val: number;
  test: number;
};

// 训练/验证按比例四舍五入，余数全部落入测试集，保证三者之和恒等于样本总数
export function autoSplitCounts(total: number, ratios: AutoSplitRatios): AutoSplitCounts {
  const train = Math.max(0, Math.min(total, Math.round((total * ratios.train) / 100)));
  const val = Math.max(0, Math.min(total - train, Math.round((total * ratios.val) / 100)));
  return { train, val, test: total - train - val };
}

// Fisher-Yates 洗牌，返回 0..total-1 的随机排列；rng 可注入以便测试
export function shuffledIndexes(total: number, rng: () => number = Math.random): number[] {
  const indexes = Array.from({ length: total }, (_, index) => index);
  for (let i = total - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
}
