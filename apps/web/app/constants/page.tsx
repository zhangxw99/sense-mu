import type { Metadata } from "next";
import { ProductShell } from "../components/product-shell";
import { ConstantsWorkbench } from "./constants-workbench";

export const metadata: Metadata = {
  title: "常量管理 · SenseMu",
  description: "维护训练平台使用的常量字典：任务类型、训练框架等分组枚举。",
};

export default function ConstantsPage() {
  return (
    <ProductShell active="constants">
      <main className="studio-main">
        <ConstantsWorkbench />
      </main>
    </ProductShell>
  );
}
