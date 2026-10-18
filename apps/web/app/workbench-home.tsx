"use client";

import {
  CircleGauge,
  Cpu,
  Database,
  FolderKanban,
  HardDrive,
  LoaderCircle,
  Plus,
  RefreshCw,
  Rocket,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AutomlAlgorithmMarketListing,
  type AutomlDataset,
  listAutomlAlgorithmMarketListings,
  listAutomlDatasets,
} from "../lib/automl-data-api";
import {
  type AutomlDeviceDeployment,
  listAutomlDeployments,
  listAutomlDevices,
} from "../lib/automl-device-api";
import {
  type AutomlTrainingTask,
  isTrainingTaskActive,
  listAutomlTrainingTasks,
} from "../lib/automl-training-api";
import {
  buildWorkbenchActivity,
  countActiveTrainingTasks,
  formatWorkbenchDate,
  workbenchPresent,
  workbenchTaskStatusLabel,
  workbenchTaskTypeLabel,
} from "../lib/workbench-overview";

// 心跳 30s 一次，与运行服务页同节奏静默刷新
const REFRESH_INTERVAL_MS = 30_000;
const DATASET_LOAD_LIMIT = 50;
const TRAINING_TASK_LOAD_LIMIT = 50;
const RUNNING_DEPLOYMENT_LOAD_LIMIT = 8;
const DEVICE_LOAD_LIMIT = 1;

type ConnectionState = "checking" | "online" | "offline";

type WorkbenchData = {
  datasets: AutomlDataset[] | null;
  datasetTotal: number | null;
  trainingTasks: AutomlTrainingTask[] | null;
  trainingTotal: number | null;
  models: AutomlAlgorithmMarketListing[] | null;
  runningDeployments: AutomlDeviceDeployment[] | null;
  runningDeploymentTotal: number | null;
  deviceTotal: number | null;
  deviceOnlineTotal: number | null;
};

const emptyWorkbenchData: WorkbenchData = {
  datasets: null,
  datasetTotal: null,
  trainingTasks: null,
  trainingTotal: null,
  models: null,
  runningDeployments: null,
  runningDeploymentTotal: null,
  deviceTotal: null,
  deviceOnlineTotal: null,
};

export function WorkbenchHome() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<WorkbenchData>(emptyWorkbenchData);
  const loadSeqRef = useRef(0);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const requestId = ++loadSeqRef.current;
    const isCurrent = () => requestId === loadSeqRef.current;
    if (!options.silent) {
      setConnection("checking");
      setLoadError(null);
    }
    const [datasets, trainingTasks, models, runningDeployments, devices, onlineDevices] =
      await Promise.allSettled([
        listAutomlDatasets({ page: 1, limit: DATASET_LOAD_LIMIT }),
        listAutomlTrainingTasks({ page: 1, limit: TRAINING_TASK_LOAD_LIMIT }),
        listAutomlAlgorithmMarketListings(),
        listAutomlDeployments({ page: 1, limit: RUNNING_DEPLOYMENT_LOAD_LIMIT, statusCd: "ACTIVE" }),
        listAutomlDevices({ page: 1, limit: DEVICE_LOAD_LIMIT }),
        listAutomlDevices({ page: 1, limit: DEVICE_LOAD_LIMIT, statusCd: "ONLINE" }),
      ]);
    if (!isCurrent()) return;

    const next: WorkbenchData = { ...emptyWorkbenchData };
    if (datasets.status === "fulfilled") {
      next.datasets = datasets.value.rows;
      next.datasetTotal = Number(datasets.value.total) || 0;
    }
    if (trainingTasks.status === "fulfilled") {
      next.trainingTasks = trainingTasks.value.rows;
      next.trainingTotal = Number(trainingTasks.value.total) || 0;
    }
    if (models.status === "fulfilled") next.models = models.value;
    if (runningDeployments.status === "fulfilled") {
      next.runningDeployments = runningDeployments.value.rows;
      next.runningDeploymentTotal = Number(runningDeployments.value.total) || 0;
    }
    if (devices.status === "fulfilled") next.deviceTotal = Number(devices.value.total) || 0;
    if (onlineDevices.status === "fulfilled") {
      next.deviceOnlineTotal = Number(onlineDevices.value.total) || 0;
    }

    const results = [datasets, trainingTasks, models, runningDeployments, devices, onlineDevices];
    if (results.every((result) => result.status === "rejected")) {
      const reason = results.find((result) => result.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      setData(emptyWorkbenchData);
      setConnection("offline");
      setLoadError(
        reason && reason.reason instanceof Error
          ? reason.reason.message
          : "工作台数据加载失败，请确认 AutoML 服务可用后重试",
      );
      return;
    }
    setData(next);
    setConnection("online");
    setLoadError(next.datasets == null || next.trainingTasks == null ? "部分数据加载失败，展示可能不完整" : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (connection !== "online") return;
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connection, load]);

  const datasetTotal = data.datasetTotal ?? 0;
  const trainingTotal = data.trainingTotal ?? 0;
  const activeTrainingCount = countActiveTrainingTasks(data.trainingTasks ?? []);
  const modelCount = data.models?.length ?? 0;
  const runningDeploymentTotal = data.runningDeploymentTotal ?? 0;
  const deviceTotal = data.deviceTotal ?? 0;
  const deviceOnlineTotal = data.deviceOnlineTotal ?? 0;

  const metrics = [
    { label: "数据集", value: datasetTotal, icon: Database, href: "/studio/data" },
    { label: "训练任务", value: trainingTotal, icon: FolderKanban, href: "/training-tasks" },
    { label: "训练中", value: data.trainingTasks ? activeTrainingCount : null, icon: CircleGauge, href: "/training-tasks" },
    { label: "可用模型", value: data.models ? modelCount : null, icon: Cpu, href: "/marketplace" },
    { label: "在线服务", value: runningDeploymentTotal, icon: Rocket, href: "/services" },
    {
      label: "边缘设备",
      value: deviceTotal,
      hint: data.deviceOnlineTotal != null ? `${deviceOnlineTotal} 在线` : undefined,
      icon: HardDrive,
      href: "/devices",
    },
  ];

  const activity = buildWorkbenchActivity({
    datasets: data.datasets,
    trainingTasks: data.trainingTasks,
    runningDeployments: data.runningDeployments,
  });

  return (
    <>
      <header className="workbench-home-header">
        <div>
          <h1>工作台</h1>
          <p>数据、训练与部署的最新进展。</p>
        </div>
        <div className="workbench-home-actions">
          <Link className="secondary-button" aria-label="新建数据集" href="/studio/data?createDataset=1">
            <Database size={14} />新建数据集
          </Link>
          <Link className="primary-button" aria-label="新建训练" href="/training-tasks?create=1">
            <Plus size={14} />新建训练
          </Link>
        </div>
      </header>

      {connection === "offline" ? (
        <div className="inline-notice is-error" role="status">
          {loadError ?? "无法连接 AutoML 服务，请确认服务地址与网络连接。"}
          <button className="text-button compact" type="button" onClick={() => void load()}>
            <RefreshCw size={12} />重试
          </button>
        </div>
      ) : null}
      {connection === "online" && loadError ? (
        <p className="inline-notice is-error" role="status">{loadError}</p>
      ) : null}

      <section className="workbench-metrics" aria-label="概览">
        {metrics.map(({ label, value, hint, icon: Icon, href }) => (
          <Link className="workbench-metric" href={href} key={label} aria-label={`${label} ${value ?? "—"}`}>
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
            <strong>
              {value ?? "—"}
              {hint ? <small> {hint}</small> : null}
            </strong>
          </Link>
        ))}
      </section>

      <section className="workbench-section">
        <div className="workbench-section-heading">
          <div><h2>数据集</h2></div>
          <Link href="/studio/data">查看全部</Link>
        </div>
        {connection === "checking" ? (
          <div className="workbench-empty"><LoaderCircle size={16} className="spinner" /><span>正在读取数据集…</span></div>
        ) : data.datasets?.length ? (
          <div className="workbench-resource-grid">
            {data.datasets.slice(0, 6).map((dataset) => (
              <Link
                className="workbench-resource-card"
                href={`/studio/data?dataset=${encodeURIComponent(String(dataset.id))}`}
                key={String(dataset.id)}
              >
                <span className="workbench-resource-card-icon"><Database size={18} /></span>
                <div>
                  <strong>{dataset.name}</strong>
                  <small>{workbenchTaskTypeLabel(dataset.taskType)}</small>
                </div>
                <p>
                  <span>{dataset.sampleCount != null ? `${dataset.sampleCount} 样本` : "样本待统计"}</span>
                  <span>{dataset.classNames?.length ? `${dataset.classNames.length} 类别` : "—"}</span>
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="workbench-empty">
            <Database size={20} /><span>还没有数据集，从「新建数据集」开始</span>
          </div>
        )}
      </section>

      <section className="workbench-section">
        <div className="workbench-section-heading">
          <div><h2>训练任务</h2></div>
          <span>{connection === "checking" ? "…" : `${trainingTotal} 个`}</span>
        </div>
        {connection === "checking" ? (
          <div className="workbench-empty"><LoaderCircle size={16} className="spinner" /><span>正在读取训练任务…</span></div>
        ) : data.trainingTasks?.length ? (
          <div className="workbench-list">
            {data.trainingTasks.slice(0, 5).map((task) => (
              <article className="workbench-row" key={String(task.id)}>
                <span className="workbench-row-icon"><FolderKanban size={18} /></span>
                <div className="workbench-row-copy">
                  <div className="workbench-row-title">
                    <strong>{task.name || task.taskCode}</strong>
                    <span className="device-status-chip task-status-chip" data-status={task.statusCd}>
                      {workbenchTaskStatusLabel(task.statusCd)}
                    </span>
                  </div>
                  <small>
                    {[
                      workbenchTaskTypeLabel(task.taskType),
                      workbenchPresent(task.baseModelName, "—"),
                      workbenchPresent(task.deviceName, "未分配设备"),
                      isTrainingTaskActive(task.statusCd)
                        ? `进度 ${Number(task.progress) || 0}%`
                        : null,
                    ].filter(Boolean).join(" · ")}
                    {` · ${formatWorkbenchDate(task.createTime)}`}
                  </small>
                </div>
                <div className="workbench-row-actions">
                  <Link className="secondary-button compact" href={`/training-tasks/${encodeURIComponent(String(task.id))}`}>
                    详情
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="workbench-empty"><FolderKanban size={20} /><span>还没有训练任务</span></div>
        )}
      </section>

      <section className="workbench-section">
        <div className="workbench-section-heading"><div><h2>最近活动</h2></div></div>
        {connection === "checking" ? (
          <div className="workbench-empty"><LoaderCircle size={16} className="spinner" /><span>正在读取最近活动…</span></div>
        ) : activity.length ? (
          <div className="workbench-activity-table">
            <div className="workbench-activity-row is-heading"><span>名称</span><span>类型</span><span>内容</span><span>状态</span><span>更新</span></div>
            {activity.map((item) => (
              <Link className="workbench-activity-row" href={item.href} key={item.key}>
                <strong>{item.name}</strong>
                <span>{item.typeLabel}</span>
                <span>{item.detail}</span>
                <span className="deploy-chip" data-tone={item.tone}>{item.status}</span>
                <time dateTime={item.updatedAt.replace(" ", "T")}>{formatWorkbenchDate(item.updatedAt)}</time>
              </Link>
            ))}
          </div>
        ) : (
          <div className="workbench-empty"><Rocket size={20} /><span>还没有活动记录</span></div>
        )}
      </section>
    </>
  );
}
