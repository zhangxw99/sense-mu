import type { Metadata } from "next";
import { ProductShell } from "../../components/product-shell";
import { ServiceDetailWorkbench } from "./service-detail-workbench";

export const metadata: Metadata = {
  title: "运行服务详情 · SenseMu",
  description: "查看设备上正在运行的推理服务：实时推理与服务设置。",
};

export default async function ServiceDetailPage({ params }: { params: Promise<{ deploymentId: string }> }) {
  const { deploymentId } = await params;
  return (
    <ProductShell active="studio">
      <ServiceDetailWorkbench deploymentId={deploymentId} />
    </ProductShell>
  );
}
