import type { Metadata } from "next";
import { ProductShell } from "../components/product-shell";
import { DevicesWorkbench } from "./devices-workbench";

export const metadata: Metadata = {
  title: "边缘设备 · SenseMu",
  description: "查看已纳管的边缘设备与在线状态，管理设备并下发模型部署任务。",
};

export default function DevicesPage() {
  return (
    <ProductShell active="devices">
      <main className="studio-main">
        <DevicesWorkbench />
      </main>
    </ProductShell>
  );
}
