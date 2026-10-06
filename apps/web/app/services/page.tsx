import type { Metadata } from "next";
import { ProductShell } from "../components/product-shell";
import { ServicesWorkbench } from "./services-workbench";

export const metadata: Metadata = {
  title: "运行服务 · SenseMu",
  description: "查看各边缘设备上正在运行的推理服务与全部部署记录。",
};

export default function ServicesPage() {
  return (
    <ProductShell active="studio">
      <ServicesWorkbench />
    </ProductShell>
  );
}
