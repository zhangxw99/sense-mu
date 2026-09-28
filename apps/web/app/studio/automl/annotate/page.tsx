import type { Metadata } from "next";
import { ProductShell } from "../../../components/product-shell";
import { AutomlAnnotationEditor } from "./automl-annotation-editor";

export const metadata: Metadata = {
  title: "AutoML 样本标注 · SenseMu",
  description: "在真实样本图片上绘制矩形框标注并保存到 sz-boot AutoML 数据集。",
};

export default function AutomlAnnotatePage() {
  return (
    <ProductShell active="studio">
      <AutomlAnnotationEditor />
    </ProductShell>
  );
}
