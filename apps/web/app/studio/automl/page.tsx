import type { Metadata } from "next";
import { ProductShell } from "../../components/product-shell";
import { AutomlWorkbench } from "./automl-workbench";

export const metadata: Metadata = {
  title: "AutoML 数据联调 · SenseMu",
  description: "对接 sz-boot AutoML 数据与标注接口的联调工作台。",
};

export default function AutomlDataPage() {
  return (
    <ProductShell active="studio">
      <main className="studio-main data-page">
        <AutomlWorkbench />
      </main>
    </ProductShell>
  );
}
