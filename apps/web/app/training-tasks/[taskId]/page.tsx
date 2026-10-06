import type { Metadata } from "next";
import { ProductShell } from "../../components/product-shell";
import { TrainingTaskDetailWorkbench } from "./training-task-detail-workbench";

export const metadata: Metadata = {
  title: "训练任务详情 · SenseMu",
  description: "查看训练任务进度、指标曲线与事件时间线。",
};

export default async function TrainingTaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return (
    <ProductShell active="training-tasks">
      <main className="studio-main">
        <TrainingTaskDetailWorkbench taskId={taskId} />
      </main>
    </ProductShell>
  );
}
