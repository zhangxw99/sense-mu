// SAM 检出结果 → 标注框草稿的纯转换逻辑，不依赖 DOM/window，可被 node --test 直接加载。
// 坐标约定与标注编辑器一致：草稿内 x/y/width/height 为图片百分比 0-100。

export type SamDetection = {
  class: string;
  conf: number;
  bbox: number[]; // [x1, y1, x2, y2]，原图像素坐标，左上/右下
};

export type SamBoxDraft = {
  label: string;
  colorIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 将 SAM /predict 返回的检出列表归一化为标注框草稿。
 * - imageSize 为 [高, 宽]（与 SAMAPI.md 的 image_size 一致）；
 * - 检出类别按「去空白 + 忽略大小写」匹配数据集类别，匹配不到的计入 skipped；
 * - 零面积/坐标倒置的检出视为无效，同样计入 skipped。
 */
export function samDetectionsToBoxDrafts(
  detections: readonly SamDetection[],
  imageSize: readonly [number, number],
  labelNames: readonly string[],
): { drafts: SamBoxDraft[]; skipped: number } {
  const [imageHeight, imageWidth] = imageSize;
  const drafts: SamBoxDraft[] = [];
  let skipped = 0;
  if (!Number.isFinite(imageHeight) || !Number.isFinite(imageWidth) || imageHeight <= 0 || imageWidth <= 0) {
    return { drafts, skipped: detections.length };
  }
  const matchedLabels = labelNames.map((name) => name.trim().toLowerCase());
  for (const detection of detections) {
    const bbox = Array.isArray(detection?.bbox) ? detection.bbox : [];
    if (bbox.length < 4 || bbox.slice(0, 4).some((value) => !Number.isFinite(value))) {
      skipped += 1;
      continue;
    }
    const normalizedClass = String(detection.class ?? "").trim().toLowerCase();
    const labelIndex = matchedLabels.indexOf(normalizedClass);
    if (labelIndex < 0) {
      skipped += 1;
      continue;
    }
    const x1 = clamp(bbox[0], 0, imageWidth);
    const y1 = clamp(bbox[1], 0, imageHeight);
    const x2 = clamp(bbox[2], 0, imageWidth);
    const y2 = clamp(bbox[3], 0, imageHeight);
    const width = x2 - x1;
    const height = y2 - y1;
    if (width <= 0 || height <= 0) {
      skipped += 1;
      continue;
    }
    drafts.push({
      label: labelNames[labelIndex],
      colorIndex: labelIndex,
      x: (x1 / imageWidth) * 100,
      y: (y1 / imageHeight) * 100,
      width: (width / imageWidth) * 100,
      height: (height / imageHeight) * 100,
      confidence: detection.conf,
    });
  }
  return { drafts, skipped };
}
