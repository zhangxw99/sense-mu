import type { AutomlDeviceDeployment } from "./automl-device-api.ts";
import { trainingTaskStatusLabels } from "./automl-training-api.ts";
import type { AutomlTrainingTask } from "./automl-training-api.ts";
import type { AutomlDataset } from "./automl-data-api.ts";

// 数据集任务类型与训练任务类型的取值一致，均来自 automl_task_type 字典
export const workbenchTaskTypeLabels: Record<string, string> = {
  OBJECT_DETECTION: "目标检测",
  INSTANCE_SEGMENTATION: "实例分割",
};

export function workbenchTaskTypeLabel(taskType: string | null | undefined): string {
  const trimmed = taskType?.trim();
  if (!trimmed) return "—";
  return workbenchTaskTypeLabels[trimmed] ?? trimmed;
}

// 历史数据常出现空字符串字段，统一按缺失处理并给兜底文案
export function workbenchPresent(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

// 训练状态 → 活动表/任务行的语气色：进行中蓝、成功绿、失败红、其余灰
export type WorkbenchTone = "run" | "ok" | "bad" | "idle";

export function workbenchTaskTone(statusCd: string): WorkbenchTone {
  if (statusCd === "RUNNING") return "run";
  if (statusCd === "SUCCEEDED") return "ok";
  if (statusCd === "FAILED") return "bad";
  return "idle";
}

export function workbenchTaskStatusLabel(statusCd: string): string {
  return trainingTaskStatusLabels[statusCd] ?? statusCd;
}

const ACTIVE_TRAINING_STATUSES = new Set(["QUEUED", "SCHEDULED", "RUNNING"]);

export function countActiveTrainingTasks(tasks: AutomlTrainingTask[]): number {
  return tasks.filter((task) => ACTIVE_TRAINING_STATUSES.has(task.statusCd)).length;
}

// 后端时间为 "yyyy-MM-dd HH:mm:ss"，转成 ISO 形式才能被 Date.parse 稳定解析
export function parseWorkbenchTime(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

export function formatWorkbenchDate(value: string | null | undefined): string {
  const parsed = parseWorkbenchTime(value);
  if (Number.isNaN(parsed)) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(parsed));
}

// 训练任务最近一次动静：终态时间 > 上报 > 开跑 > 入队 > 建档
function trainingTaskLatestTime(task: AutomlTrainingTask): string {
  return task.finishedAt ?? task.deviceReportedAt ?? task.startedAt ?? task.queuedAt ?? task.createTime;
}

export type WorkbenchActivityItem = {
  key: string;
  typeLabel: string;
  name: string;
  detail: string;
  status: string;
  tone: WorkbenchTone;
  updatedAt: string;
  href: string;
};

export type WorkbenchActivitySource = {
  datasets: AutomlDataset[] | null;
  trainingTasks: AutomlTrainingTask[] | null;
  runningDeployments: AutomlDeviceDeployment[] | null;
};

// 最近活动 = 数据集创建 + 训练任务动静 + 运行中服务激活，按时间倒序取前 limit 条
export function buildWorkbenchActivity(
  source: WorkbenchActivitySource,
  limit = 8,
): WorkbenchActivityItem[] {
  const items: WorkbenchActivityItem[] = [];

  for (const dataset of source.datasets ?? []) {
    const sampleCount = dataset.sampleCount;
    items.push({
      key: `dataset-${dataset.id}`,
      typeLabel: "数据集",
      name: dataset.name,
      detail: [
        workbenchTaskTypeLabel(dataset.taskType),
        sampleCount != null ? `${sampleCount} 样本` : null,
      ].filter(Boolean).join(" · "),
      status: dataset.statusCd === "DISABLED" ? "已停用" : "已启用",
      tone: "idle",
      updatedAt: dataset.createTime,
      href: `/studio/data?dataset=${encodeURIComponent(String(dataset.id))}`,
    });
  }

  for (const task of source.trainingTasks ?? []) {
    items.push({
      key: `training-${task.id}`,
      typeLabel: "训练任务",
      name: workbenchPresent(task.name, task.taskCode),
      detail: [
        workbenchPresent(task.baseModelName, "—"),
        workbenchPresent(task.deviceName, "未分配设备"),
      ].join(" · "),
      status: workbenchTaskStatusLabel(task.statusCd),
      tone: workbenchTaskTone(task.statusCd),
      updatedAt: trainingTaskLatestTime(task),
      href: `/training-tasks/${encodeURIComponent(String(task.id))}`,
    });
  }

  for (const deployment of source.runningDeployments ?? []) {
    items.push({
      key: `deployment-${deployment.deploymentId}`,
      typeLabel: "在线服务",
      name: workbenchPresent(deployment.modelName, deployment.deploymentCode),
      detail: deployment.deviceName ?? "—",
      status: "运行中",
      tone: "ok",
      updatedAt: deployment.activatedAt ?? deployment.issuedAt ?? "",
      href: `/services/${encodeURIComponent(String(deployment.deploymentId))}`,
    });
  }

  return items
    .filter((item) => item.updatedAt)
    .sort((left, right) => {
      const leftTime = parseWorkbenchTime(left.updatedAt);
      const rightTime = parseWorkbenchTime(right.updatedAt);
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, limit);
}
