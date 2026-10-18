// 指标质量色阶：分数 0(差，红) → 1(优，绿)，供指标卡背景染色与图例共用。
// 只用于"越高越好"的评估指标（mAP/precision/recall 等）；损失类曲线不参与卡片染色。

export const METRIC_QUALITY_MIN_HUE = 4; // 红
export const METRIC_QUALITY_MAX_HUE = 145; // 绿

// 0-1 视为比例，1-100 视为百分比，越界钳到 [0,1]
export function metricQualityScore(value: number | null | undefined): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const ratio = num > 1 ? num / 100 : num;
  return Math.min(1, Math.max(0, ratio));
}

export type MetricQualityColor = {
  score: number;
  hue: number;
  // 卡片底色：分数越低越偏红、越高越偏绿，饱和度/明度随分数收紧
  background: string;
  // 边框用同色系略深一档，避免红绿底压住全局 --border 的层次
  border: string;
  // 强调色（数值文字/趋势线）：随分数从深红过渡到深绿
  accent: string;
};

export function metricQualityColor(value: number | null | undefined): MetricQualityColor {
  const score = metricQualityScore(value);
  const hue = METRIC_QUALITY_MIN_HUE + (METRIC_QUALITY_MAX_HUE - METRIC_QUALITY_MIN_HUE) * score;
  return {
    score,
    hue,
    background: `hsl(${hue.toFixed(1)} 64% ${94 - 6 * score}%)`,
    border: `hsl(${hue.toFixed(1)} 45% ${80 - 8 * score}%)`,
    accent: `hsl(${hue.toFixed(1)} 62% ${34 - 4 * score}%)`,
  };
}

// 图例两端读数：红端=0%（差）绿端=100%（优）
export const METRIC_QUALITY_LEGEND = [
  { label: "差", score: 0 },
  { label: "优", score: 1 },
];
