import type { Metadata } from "next";
import { ProductShell } from "../components/product-shell";
import { TrainingPlatformsWorkbench } from "./training-platforms-workbench";

export const metadata: Metadata = {
  title: "训练平台 · SenseMu",
  description: "维护训练平台与基础模型：平台信息、训练参数 Schema 与基础模型清单。",
};

export default function TrainingPlatformsPage() {
  return (
    <ProductShell active="training-platforms">
      <main className="studio-main">
        <TrainingPlatformsWorkbench />
      </main>
    </ProductShell>
  );
}
