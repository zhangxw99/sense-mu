import type { Metadata } from "next";
import { ProductShell } from "../../../components/product-shell";
import { TrainingTaskTestWorkbench } from "./training-task-test-workbench";

export const metadata: Metadata = {
  title: "训练任务测试验证 · SenseMu",
  description: "上传图片对训练产出的模型做效果演示。",
};

export default async function TrainingTaskTestPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return (
    <ProductShell active="training-tasks">
      <main className="studio-main">
        <TrainingTaskTestWorkbench taskId={taskId} />
      </main>
    </ProductShell>
  );
}
