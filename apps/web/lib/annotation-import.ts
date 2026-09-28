// 标注文件导入：YOLO txt / Pascal VOC xml 解析与「同名配对」逻辑，纯函数便于单测。
// 配对约定：标注文件与图片文件同名（不含扩展名，忽略大小写），img1.jpg ↔ img1.txt / img1.xml。

export type ParsedBbox = {
  labelName: string;
  annotationJson: Record<string, unknown>;
};

export type PairedImport = {
  image: File;
  annotations: ParsedBbox[];
  width: number | null;
  height: number | null;
};

export type PairResult = {
  pairs: PairedImport[];
  unpairedImages: File[];
  unmatchedAnnotationFiles: string[];
  zipFiles: File[];
};

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const ANNOTATION_EXTENSIONS = /\.(txt|xml)$/i;
const ZIP_EXTENSIONS = /\.zip$/i;

export function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);
}

export function isAnnotationFile(file: File): boolean {
  return ANNOTATION_EXTENSIONS.test(file.name);
}

export function isZipFile(file: File): boolean {
  return ZIP_EXTENSIONS.test(file.name) || file.type === "application/zip";
}

// YOLO txt：每行 `classIndex cx cy w h`，坐标已归一化
export function parseYoloTxt(text: string): { classIndex: number; x: number; y: number; w: number; h: number }[] {
  const boxes: { classIndex: number; x: number; y: number; w: number; h: number }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) throw new Error(`YOLO 标注行格式错误：${line.slice(0, 60)}`);
    const classIndex = Number.parseInt(parts[0], 10);
    const [cx, cy, w, h] = parts.slice(1, 5).map(Number);
    if (!Number.isInteger(classIndex) || classIndex < 0
      || [cx, cy, w, h].some((v) => !Number.isFinite(v))) {
      throw new Error(`YOLO 标注行数值错误：${line.slice(0, 60)}`);
    }
    boxes.push({ classIndex, x: cx - w / 2, y: cy - h / 2, w, h });
  }
  return boxes;
}

// Pascal VOC xml：/object/name + bndbox 像素坐标，按 <size> 归一化
export function parseVocXml(text: string): { labelName: string; x: number; y: number; w: number; h: number }[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML 解析失败：文件不是合法的 VOC xml");
  const widthText = doc.querySelector("size > width")?.textContent?.trim();
  const heightText = doc.querySelector("size > height")?.textContent?.trim();
  const width = Number(widthText);
  const height = Number(heightText);
  if (!width || !height) throw new Error("VOC xml 缺少可用的 <size><width>/<height>，无法归一化坐标");
  const boxes: { labelName: string; x: number; y: number; w: number; h: number }[] = [];
  for (const objectNode of Array.from(doc.querySelectorAll("object"))) {
    const labelName = objectNode.querySelector("name")?.textContent?.trim() ?? "";
    const boxNode = objectNode.querySelector("bndbox");
    if (!labelName || !boxNode) continue;
    const xmin = Number(boxNode.querySelector("xmin")?.textContent);
    const ymin = Number(boxNode.querySelector("ymin")?.textContent);
    const xmax = Number(boxNode.querySelector("xmax")?.textContent);
    const ymax = Number(boxNode.querySelector("ymax")?.textContent);
    if ([xmin, ymin, xmax, ymax].some((v) => !Number.isFinite(v))) continue;
    boxes.push({
      labelName,
      x: Math.max(0, xmin / width),
      y: Math.max(0, ymin / height),
      w: Math.min(1, Math.max(0, (xmax - xmin) / width)),
      h: Math.min(1, Math.max(0, (ymax - ymin) / height)),
    });
  }
  return boxes;
}

async function imageDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

async function readText(file: File): Promise<string> {
  return file.text();
}

// 把「图片 + 标注文件」混合文件列表按同名配对成导入条目。
// yoloIndexToName：YOLO classIndex → 类别名（已有类别按索引映射；缺失索引回退为 class_{i}，
// 由后端自动创建，可在类别页改名）。
export async function pairAnnotationFiles(
  files: File[],
  yoloIndexToName: (classIndex: number) => string,
): Promise<PairResult> {
  const images = files.filter(isImageFile);
  const annotationFiles = files.filter(isAnnotationFile);
  const zipFiles = files.filter(isZipFile);

  const imagesByBase = new Map<string, File>();
  for (const image of images) imagesByBase.set(fileBaseName(image.name), image);

  const pairs = new Map<string, PairedImport>();
  const unmatchedAnnotationFiles: string[] = [];
  for (const annotationFile of annotationFiles) {
    const base = fileBaseName(annotationFile.name);
    const image = imagesByBase.get(base);
    if (!image) {
      unmatchedAnnotationFiles.push(annotationFile.name);
      continue;
    }
    let pair = pairs.get(base);
    if (!pair) {
      const size = await imageDimensions(image);
      pair = { image, annotations: [], ...size };
      pairs.set(base, pair);
    }
    const text = await readText(annotationFile);
    if (annotationFile.name.toLowerCase().endsWith(".xml")) {
      for (const box of parseVocXml(text)) {
        pair.annotations.push({
          labelName: box.labelName,
          annotationJson: { type: "bbox", x: box.x, y: box.y, w: box.w, h: box.h },
        });
      }
    } else {
      for (const box of parseYoloTxt(text)) {
        pair.annotations.push({
          labelName: yoloIndexToName(box.classIndex),
          annotationJson: { type: "bbox", x: box.x, y: box.y, w: box.w, h: box.h },
        });
      }
    }
  }
  // 配对的图片保序输出；未配对图片作为纯图片条目交给调用方（只建样本不带标注）
  const pairedImages = new Set(Array.from(pairs.values()).map((pair) => pair.image));
  const orderedPairs: PairedImport[] = [];
  for (const image of images) {
    const pair = pairs.get(fileBaseName(image.name));
    if (pair) orderedPairs.push(pair);
  }
  return {
    pairs: orderedPairs,
    unpairedImages: images.filter((image) => !pairedImages.has(image)),
    unmatchedAnnotationFiles,
    zipFiles,
  };
}
