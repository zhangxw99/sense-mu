import assert from "node:assert/strict";
import test from "node:test";

const lib = await import("../lib/annotation-import.ts");

// Node 无 DOMParser：为 lib 中用到的极小选择器子集提供测试 shim（size>width、object、name、bndbox 子节点）
function extractBlock(text, tag) {
  const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : null;
}
class FakeElement {
  constructor(text) { this.inner = text ?? ""; }
  get textContent() { return this.inner; }
  querySelector(selector) {
    const tag = selector.includes(">") ? selector.split(">")[1].trim() : selector;
    const block = extractBlock(this.inner, tag);
    return block == null ? null : new FakeElement(block);
  }
}
class FakeXmlDocument {
  constructor(text) { this.text = text; }
  querySelector(selector) {
    if (selector === "parsererror") return null;
    if (selector.startsWith("size > ")) {
      const sizeBlock = extractBlock(this.text, "size");
      const tag = selector.split(">")[1].trim();
      const value = sizeBlock == null ? null : extractBlock(sizeBlock, tag);
      return value == null ? null : new FakeElement(value);
    }
    const block = extractBlock(this.text, selector);
    return block == null ? null : new FakeElement(block);
  }
  querySelectorAll(selector) {
    if (selector !== "object") return [];
    return [...this.text.matchAll(/<object[^>]*>([\s\S]*?)<\/object>/g)]
      .map((match) => new FakeElement(match[1]));
  }
}
globalThis.DOMParser = class {
  parseFromString(text) { return new FakeXmlDocument(text); }
};

function makeFile(name, content, type = "text/plain") {
  return new File([content], name, { type });
}

test("parseYoloTxt 解析归一化中心点并转左上角", () => {
  const boxes = lib.parseYoloTxt("0 0.5 0.5 0.2 0.4\n\n1 0.25 0.75 0.1 0.1");
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0], { classIndex: 0, x: 0.4, y: 0.3, w: 0.2, h: 0.4 });
  assert.equal(boxes[1].classIndex, 1);
  assert.ok(Math.abs(boxes[1].x - 0.2) < 1e-9);
});

test("parseYoloTxt 对非法行抛出可读错误", () => {
  assert.throws(() => lib.parseYoloTxt("0 0.1"), /YOLO 标注行格式错误/);
  assert.throws(() => lib.parseYoloTxt("x 0.1 0.1 0.1 0.1"), /YOLO 标注行数值错误/);
});

test("parseVocXml 解析 object 并按 size 归一化像素坐标", () => {
  const xml = `<?xml version="1.0"?>
  <annotation>
    <size><width>1000</width><height>500</height></size>
    <object><name>helmet</name><bndbox><xmin>100</xmin><ymin>50</ymin><xmax>300</xmax><ymax>200</ymax></bndbox></object>
    <object><name>person</name><bndbox><xmin>400</xmin><ymin>250</ymin><xmax>500</xmax><ymax>500</ymax></bndbox></object>
  </annotation>`;
  const boxes = lib.parseVocXml(xml);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0].labelName, "helmet");
  assert.ok(Math.abs(boxes[0].x - 0.1) < 1e-9);
  assert.ok(Math.abs(boxes[0].w - 0.2) < 1e-9);
  assert.ok(Math.abs(boxes[0].h - 0.3) < 1e-9);
  assert.ok(Math.abs(boxes[1].h - 0.5) < 1e-9);
});

test("parseVocXml 缺 size 时报错", () => {
  assert.throws(() => lib.parseVocXml("<annotation><object><name>a</name></object></annotation>"), /缺少可用的/);
});

test("pairAnnotationFiles 按同名配对 txt/xml，未配对的分别列出", async () => {
  const img1 = new File(["png1"], "img1.png", { type: "image/png" });
  const img2 = new File(["png2"], "img2.png", { type: "image/png" });
  const txt1 = makeFile("img1.txt", "0 0.5 0.5 0.2 0.4");
  const xml1 = makeFile("img2.xml", `<annotation><size><width>100</width><height>100</height></size><object><name>cat</name><bndbox><xmin>10</xmin><ymin>10</ymin><xmax>50</xmax><ymax>50</ymax></bndbox></object></annotation>`);
  const orphan = makeFile("ghost.txt", "0 0.5 0.5 0.1 0.1");
  const zip = new File(["zip"], "bundle.zip", { type: "application/zip" });

  const result = await lib.pairAnnotationFiles([img1, txt1, img2, xml1, orphan, zip], (i) => `class_${i}`);

  assert.equal(result.pairs.length, 2);
  const pair1 = result.pairs.find((p) => p.image.name === "img1.png");
  const pair2 = result.pairs.find((p) => p.image.name === "img2.png");
  assert.equal(pair1.annotations.length, 1);
  assert.equal(pair1.annotations[0].labelName, "class_0", "YOLO 索引经 resolver 映射为类别名");
  assert.equal(pair1.annotations[0].annotationJson.type, "bbox");
  assert.equal(pair2.annotations[0].labelName, "cat", "VOC 标签名取自 xml");
  assert.deepEqual(result.unmatchedAnnotationFiles, ["ghost.txt"]);
  assert.deepEqual(result.zipFiles.map((f) => f.name), ["bundle.zip"]);
  assert.deepEqual(result.unpairedImages.map((f) => f.name), [], "两张图都有标注，无未配对图片");
});

test("pairAnnotationFiles 未配对图片单独返回", async () => {
  const img = new File(["png"], "solo.png", { type: "image/png" });
  const result = await lib.pairAnnotationFiles([img], (i) => `class_${i}`);
  assert.equal(result.pairs.length, 0);
  assert.deepEqual(result.unpairedImages.map((f) => f.name), ["solo.png"]);
});
