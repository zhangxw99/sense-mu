import type { Metadata } from "next";
import { ProductShell } from "../components/product-shell";
import { TrainingTasksWorkbench } from "./training-tasks-workbench";

export const metadata: Metadata = {
  title: "训练任务 · SenseMu",
  description: "创建训练任务、下发到边缘设备并跟踪训练进度。",
};

export default function TrainingTasksPage() {
  return (
    <ProductShell active="training-tasks">
      <main className="studio-main">
        <TrainingTasksWorkbench />
      </main>
    </ProductShell>
  );
}
