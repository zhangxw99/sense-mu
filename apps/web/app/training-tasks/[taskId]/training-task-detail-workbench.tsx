"use client";

import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Boxes,
  ListOrdered,
  LoaderCircle,
  Rocket,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AutomlMetricsPoint,
  type AutomlTrainingArtifact,
  type AutomlTrainingEvent,
  type AutomlTrainingTask,
  getAutomlTrainingTask,
  isTrainingTaskActive,
  listAutomlTrainingArtifacts,
  listAutomlTrainingTaskDeployments,
  listAutomlTrainingTaskEvents,
  listAutomlTrainingTaskMetrics,
  publishAutomlTrainingTask,
  trainingTaskStatusLabels,
} from "../../../lib/automl-training-api";
import {
  type AutomlDevice,
  type AutomlDeviceDeployment,
  createAutomlDeviceDeployment,
  deploymentStatusLabel,
  isDeploymentInProgress,
  listAutomlDevices,
} from "../../../lib/automl-device-api";
import { type AutomlId } from "../../../lib/automl-data-api";
import { useTaskDatasetCard } from "./use-task-dataset-card";
import { listAutomlConstants } from "../../../lib/automl-platform-api";

// 产物显示项的用户自选持久化键（默认勾选来自常量分组 TRAINING_ARTIFACT）
const ARTIFACT_DISPLAY_STORAGE_KEY = "automl-training-artifact-display";

const IMAGE_ARTIFACT_TYPES = new Set(["PREVIEW_IMAGE", "EVAL_IMAGE", "VISUAL_IMAGE"]);

function formatArtifactSize(size: unknown): string {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

type ArtifactDisplayItem = { code: string; name: string; checked: boolean };

// 进行中任务按 4s 节奏同时刷新详情 + 指标 + 事件
const TASK_POLL_INTERVAL_MS = 4_000;

function statusText(statusCd: string): string {
  return trainingTaskStatusLabels[statusCd] ?? statusCd;
}

function progressWidth(progress: number): string {
  const value = Number(progress);
  return `${Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))}%`;
}

function formatProgress(progress: number): string {
  const value = Number(progress);
  return `${Number.isFinite(value) ? Math.round(value) : 0}%`;
}

function describeJsonValue(value: unknown): string {
  if (value == null) return "暂无参数";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type MetricSeries = {
  key: string;
  metricName: string;
  splitType: string | null;
  points: AutomlMetricsPoint[];
};

// 按 (metricName, splitType) 分组，组内按 epoch 升序
function groupMetricSeries(metrics: AutomlMetricsPoint[]): MetricSeries[] {
  const groups = new Map<string, MetricSeries>();
  for (const point of metrics) {
    if (point.metricValue == null || !Number.isFinite(Number(point.metricValue))) continue;
    const splitType = point.splitType ?? "";
    const key = `${point.metricName}::${splitType}`;
    const existing = groups.get(key);
    if (existing) {
      existing.points.push(point);
    } else {
      groups.set(key, {
        key,
        metricName: point.metricName,
        splitType: splitType || null,
        points: [point],
      });
    }
  }
  for (const series of groups.values()) {
    series.points.sort((a, b) => Number(a.epoch) - Number(b.epoch) || Number(a.step ?? 0) - Number(b.step ?? 0));
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// 关键指标汇总卡：val 指标优先（训练结论），train 指标兜底（如 loss 类无 val）
type HeadlineSeries = {
  key: string;
  label: string;
  series: MetricSeries;
};

const HEADLINE_METRICS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /mAP50(?![-_]95)|^map50$/i, label: "mAP50" },
  { pattern: /mAP50[-_(]95|map50_?95|mAP50-95/i, label: "mAP50-95" },
  { pattern: /precision/i, label: "Precision" },
  { pattern: /recall/i, label: "Recall" },
];

function pickHeadlineSeries(seriesList: MetricSeries[]): HeadlineSeries[] {
  const headline: HeadlineSeries[] = [];
  for (const meta of HEADLINE_METRICS) {
    // 同名指标优先取 val，没有 val 取 train
    const val = seriesList.find((s) => meta.pattern.test(s.metricName) && s.splitType === "val");
    const fallback = seriesList.find((s) => meta.pattern.test(s.metricName));
    const series = val ?? fallback;
    if (series) {
      headline.push({ key: series.key, label: meta.label, series });
    }
  }
  return headline;
}

function headlinePercent(series: MetricSeries): string {
  const latest = Number(series.points[series.points.length - 1]?.metricValue ?? 0);
  if (!Number.isFinite(latest)) return "—";
  // 0-1 区间按百分比展示；>1 视为已百分比
  const display = latest > 1 ? latest : latest * 100;
  return `${display.toFixed(1)}%`;
}

// 进度卡一句话描述（照项目概览 next-card 的口吻）
function progressDescription(statusCd: string): string {
  switch (statusCd) {
    case "CREATED":
      return "任务已建档，选择设备后即可下发训练。";
    case "QUEUED":
      return "已下发至设备，等待设备领取。";
    case "SCHEDULED":
      return "设备已领取任务，正在准备训练环境。";
    case "RUNNING":
      return "训练进行中，进度与指标每 4 秒自动刷新，可以离开页面。";
    case "SUCCEEDED":
      return "训练已完成，产物保留在执行设备上。";
    case "FAILED":
      return "训练失败，失败原因见下方。";
    case "CANCELLED":
      return "任务已取消。";
    default:
      return "";
  }
}

// 简易 SVG 折线：带纵轴刻度与悬停读点（x=epoch 序号，y=指标值）
function MetricChart({ series }: { series: MetricSeries }) {
  const width = 340;
  const height = 150;
  const padLeft = 44;
  const padBottom = 20;
  const padTop = 10;
  const padRight = 10;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const values = series.points.map((point) => Number(point.metricValue));
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 纵轴上下留 8% 余量，全平的序列退化为 ±1
  const lo = min === max ? min - 1 : min;
  const hi = min === max ? max + 1 : max;
  const range = hi - lo || 1;
  const latest = values[values.length - 1];
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const xAt = (index: number) => series.points.length === 1
    ? padLeft + plotW / 2
    : padLeft + (index * plotW) / (series.points.length - 1);
  const yAt = (value: number) => padTop + plotH - ((value - lo) / range) * plotH;

  // 纵轴刻度：固定 3 条（下/中/上），不依赖数据个数
  const ticks = [lo, lo + range / 2, hi];
  const formatTick = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 1000) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1);
    if (abs >= 1) return value.toFixed(2);
    return value.toFixed(3);
  };
  const formatValue = (value: number) => (Math.abs(value) >= 1 ? value.toFixed(3) : value.toFixed(4));

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (series.points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = width / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const ratio = Math.round(((x - padLeft) / plotW) * (series.points.length - 1));
    setHoverIndex(Math.min(series.points.length - 1, Math.max(0, ratio)));
  };
  const hover = hoverIndex != null && values[hoverIndex] != null
    ? { point: series.points[hoverIndex], value: values[hoverIndex], index: hoverIndex }
    : null;

  return (
    <figure className="metric-chart">
      <figcaption>
        <strong>{series.metricName}</strong>
        <span className="metric-chart-split" data-split={series.splitType ?? "ALL"}>
          {series.splitType || "全部"}
        </span>
        <small>
          最新 {formatValue(latest)} · 最大 {formatValue(max)} · {series.points.length} 个点
        </small>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${series.metricName}（${series.splitType || "全部"}）指标曲线`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {/* 纵轴刻度线与数值 */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="metric-chart-gridline"
              x1={padLeft}
              y1={yAt(tick)}
              x2={width - padRight}
              y2={yAt(tick)}
            />
            <text className="metric-chart-tick" x={padLeft - 6} y={yAt(tick) + 3} textAnchor="end">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {series.points.length > 1 ? (
          <polyline
            className="metric-chart-line"
            points={values.map((value, index) => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ")}
          />
        ) : null}
        {/* 悬停引导线置于数据点之下 */}
        {hover ? (
          <line
            className="metric-chart-cursor"
            x1={xAt(hover.index)}
            y1={padTop}
            x2={xAt(hover.index)}
            y2={height - padBottom}
          />
        ) : null}
        {series.points.map((point, index) => (
          <circle
            className={`metric-chart-dot${hover?.index === index ? " is-hover" : ""}`}
            key={`${point.epoch}-${point.step ?? 0}-${index}`}
            cx={xAt(index)}
            cy={yAt(values[index])}
            r={hover?.index === index ? 3.6 : 2.4}
          >
            <title>{`epoch ${point.epoch} · ${formatValue(values[index])}`}</title>
          </circle>
        ))}
        {hover ? (
          <g className="metric-chart-tooltip" transform={`translate(${Math.min(xAt(hover.index) + 8, width - 108)}, ${padTop + 2})`}>
            <rect width={100} height={30} rx={5} />
            <text x={6} y={12}>epoch {hover.point.epoch ?? "—"}</text>
            <text x={6} y={24} className="metric-chart-tooltip-value">{formatValue(hover.value)}</text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}

// 汇总卡迷你趋势线：扁平铺满卡片底部，大数字直接压在线上方（参考图风格）
function HeadlineSparkline({ series }: { series: MetricSeries }) {
  const width = 160;
  const height = 46;
  const values = series.points.map((point) => Number(point.metricValue));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.abs(max) || 1;
  const xAt = (index: number) => series.points.length === 1
    ? width / 2
    : 2 + (index * (width - 4)) / (series.points.length - 1);
  // 最低点贴 svg 底边（1px 余量），波动压在上半区：视觉上趋势线从横幅底边生长
  const yAt = (value: number) => height - 1 - ((value - min) / range) * (height - 10);
  const polyline = values
    .map((value, index) => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`)
    .join(" ");

  return (
    <svg className="task-overview-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none">
      <polyline className="metric-chart-line" points={polyline} />
      {values.length === 1 ? (
        <circle className="metric-chart-dot" cx={width / 2} cy={yAt(values[0])} r={2.4} />
      ) : null}
    </svg>
  );
}

export function TrainingTaskDetailWorkbench({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AutomlTrainingTask | null>(null);
  const [metrics, setMetrics] = useState<AutomlMetricsPoint[]>([]);
  const [events, setEvents] = useState<AutomlTrainingEvent[]>([]);
  const datasetCard = useTaskDatasetCard(task);
  const [artifacts, setArtifacts] = useState<AutomlTrainingArtifact[]>([]);
  const [artifactDisplay, setArtifactDisplay] = useState<ArtifactDisplayItem[]>([]);
  const [previewArtifact, setPreviewArtifact] = useState<AutomlTrainingArtifact | null>(null);
  // 部署：任务部署历史 + 部署对话框状态
  const [deployments, setDeployments] = useState<AutomlDeviceDeployment[]>([]);
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [deployDevices, setDeployDevices] = useState<AutomlDevice[] | null>(null);
  const [deployDeviceId, setDeployDeviceId] = useState("");
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef(false);

  const refreshAll = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    pollingRef.current = true;
    try {
      const [nextTask, nextMetrics, nextEvents, nextArtifacts, nextDeployments] = await Promise.all([
        getAutomlTrainingTask(taskId),
        listAutomlTrainingTaskMetrics(taskId).catch(() => []),
        listAutomlTrainingTaskEvents(taskId).catch(() => []),
        listAutomlTrainingArtifacts(taskId).catch(() => []),
        listAutomlTrainingTaskDeployments(taskId).catch(() => []),
      ]);
      setTask(nextTask);
      setMetrics(nextMetrics);
      setEvents(nextEvents);
      setArtifacts(nextArtifacts);
      setDeployments(nextDeployments);
      if (!silent) setError(null);
    } catch (reason) {
      if (!silent) {
        setError(reason instanceof Error ? reason.message : "训练任务详情加载失败");
      }
    } finally {
      pollingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refreshAll(false);
  }, [refreshAll]);

  const taskActive = task ? isTrainingTaskActive(task.statusCd) : false;

  // 灯箱：ESC 关闭
  useEffect(() => {
    if (!previewArtifact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewArtifact(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewArtifact]);

  // 终态停止轮询；依赖 task.statusCd 触发，组件卸载时清理定时器
  useEffect(() => {
    if (!taskActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (pollingRef.current) return;
      void refreshAll(true);
    }, TASK_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshAll, taskActive]);

  const seriesList = useMemo(() => groupMetricSeries(metrics), [metrics]);
  const headlineSeries = useMemo(() => pickHeadlineSeries(seriesList), [seriesList]);

  // 部署/测试验证入口状态：可部署=训练成功且有最优权重产物；测试验证=存在 ACTIVE 部署
  const latestDeployment = deployments[0] ?? null;
  const activeDeployment = deployments.find((deployment) => deployment.statusCd === "ACTIVE") ?? null;
  const hasBestWeight = artifacts.some((artifact) => artifact.artifactType === "WEIGHT_BEST");
  const deployReady = Boolean(task && task.statusCd === "SUCCEEDED" && hasBestWeight);
  const testReady = Boolean(activeDeployment);
  const deployInProgress = deployments.some((deployment) => isDeploymentInProgress(deployment.statusCd));

  // 部署对话框打开：拉在线设备列表
  const openDeployDialog = useCallback(() => {
    setDeployError(null);
    setDeployDeviceId("");
    setDeployDialogOpen(true);
    void (async () => {
      try {
        const page = await listAutomlDevices({ page: 1, limit: 50, statusCd: "ONLINE" });
        setDeployDevices(page.rows);
      } catch (reason) {
        setDeployDevices([]);
        setDeployError(reason instanceof Error ? reason.message : "设备列表加载失败");
      }
    })();
  }, []);

  // 一键部署：发布（幂等，未发布则注册模型+打包）→ 建部署任务（设备心跳领取）
  const confirmDeploy = useCallback(async () => {
    if (!deployDeviceId) {
      setDeployError("请选择一台在线设备");
      return;
    }
    setDeployBusy(true);
    setDeployError(null);
    try {
      const published = await publishAutomlTrainingTask(taskId);
      await createAutomlDeviceDeployment(deployDeviceId, published.modelVersionId);
      setDeployDialogOpen(false);
      setNotice(`已发布为模型 ${published.modelCode} · ${published.version}（${published.reused ? "复用已有版本" : "新发布"}），部署任务已下发到设备。`);
      await refreshAll(true);
    } catch (reason) {
      setDeployError(reason instanceof Error ? reason.message : "部署下发失败，请稍后重试");
    } finally {
      setDeployBusy(false);
    }
  }, [deployDeviceId, refreshAll, taskId]);
  // 轮次展示：最后一轮上报可能触发收尾 val（epoch+1 超总数），展示层钳到总轮次
  const displayEpoch = task && task.totalEpochs > 0
    ? Math.min(task.currentEpoch ?? 0, task.totalEpochs)
    : task?.currentEpoch ?? 0;

  // 产物显示项：常量 TRAINING_ARTIFACT 分组（ENABLED=默认勾选），用户勾选存 localStorage
  useEffect(() => {
    void (async () => {
      try {
        const constants = await listAutomlConstants({ constType: "TRAINING_ARTIFACT" });
        let saved: Record<string, boolean> = {};
        try {
          saved = JSON.parse(window.localStorage.getItem(ARTIFACT_DISPLAY_STORAGE_KEY) ?? "{}");
        } catch {
          saved = {};
        }
        setArtifactDisplay(constants.map((constant) => ({
          code: constant.code,
          name: constant.name,
          checked: constant.code in saved ? Boolean(saved[constant.code]) : constant.statusCd === "ENABLED",
        })));
      } catch {
        // 常量接口不可用时产物区退化为全部展示
      }
    })();
  }, []);

  const toggleArtifactDisplay = useCallback((code: string) => {
    setArtifactDisplay((current) => {
      const next = current.map((item) => item.code === code ? { ...item, checked: !item.checked } : item);
      const saved: Record<string, boolean> = {};
      for (const item of next) saved[item.code] = item.checked;
      try {
        window.localStorage.setItem(ARTIFACT_DISPLAY_STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // 存储不可用时仅本次会话生效
      }
      return next;
    });
  }, []);

  const visibleArtifactTypes = useMemo(
    () => new Set(artifactDisplay.filter((item) => item.checked).map((item) => item.code)),
    [artifactDisplay]);
  const visibleArtifacts = useMemo(
    () => artifacts.filter((artifact) => visibleArtifactTypes.has(artifact.artifactType)),
    [artifacts, visibleArtifactTypes]);
  // url 可能是 null 或空串（PROTECTED 场景无直链）：一律走鉴权流式下载端点
  const artifactDownloadHref = (artifact: AutomlTrainingArtifact) =>
    artifact.url ? artifact.url : `/sz-api/automl/training-tasks/${encodeURIComponent(String(taskId))}/artifacts/${encodeURIComponent(String(artifact.id))}/download`;

  if (loading && !task) {
    return (
      <section className="task-detail-page">
        <article className="panel workbench-loading" aria-live="polite">
          <LoaderCircle size={20} className="spinner" />
          <span>正在读取任务详情…</span>
        </article>
      </section>
    );
  }

  if (error && !task) {
    return (
      <section className="task-detail-page">
        <div className="workbench-message error-message" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void refreshAll(false)}>重试</button>
        </div>
      </section>
    );
  }

  if (!task) return null;

  return (
    <section className="task-detail-page">
      <div className="devices-header">
        <div>
          <Link className="device-back-link" href="/training-tasks">
            <ArrowLeft size={13} aria-hidden="true" />
            平台 / 训练任务
          </Link>
          <h1>{task.name || task.taskCode}</h1>
          <p className="device-header-meta">
            <span className="device-status-chip task-status-chip" data-status={task.statusCd}>
              {statusText(task.statusCd)}
            </span>
            <span className="task-header-model-chip" title={`基础模型 ${task.baseModelName || "未选"}（平台 ${task.platformName || "—"}）`}>
              <Boxes size={12} aria-hidden="true" />
              {task.baseModelName || "未选基础模型"}
            </span>
            <span>
              {task.taskCode} · 平台 {task.platformName || "—"} · 设备 {task.deviceName || "未下发"}
            </span>
          </p>
        </div>
      </div>

      {error ? (
        <div className="workbench-message error-message" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      ) : null}

      {notice ? (
        <div className="workbench-message notice-message" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>关闭</button>
        </div>
      ) : null}

      {taskActive ? (
        <p className="device-detail-hint task-polling-hint" role="status">
          <LoaderCircle size={11} className="spinner" /> 任务进行中，每 4 秒自动刷新进度、指标与事件。
        </p>
      ) : null}

      <article className="panel task-progress-card">
        <div className="task-progress-hero">
          <div className="overview-next-heading">
          <div>
            <span className="overview-live-status" data-status={task.statusCd}>
              <i aria-hidden="true" />
              {statusText(task.statusCd)}
            </span>
            {/* 任务名页头已展示；此位照 PPE 卡语义显示训练主体：算法平台 · 基础模型 */}
            <h2>
              {[task.platformName, task.baseModelName].filter(Boolean).join(" · ")
                || task.name || task.taskCode}
            </h2>
            <p>{progressDescription(task.statusCd)}</p>
          </div>
          <div className="task-hero-progress-side">
            {task.statusCd === "SUCCEEDED" ? (
              <button
                className="secondary-button compact"
                type="button"
                disabled={!deployReady || deployInProgress}
                title={!deployReady
                  ? "训练产物尚未就绪（需要最优权重），完成后可部署"
                  : deployInProgress ? "部署进行中" : "选择设备并部署训练产物"}
                onClick={openDeployDialog}
              >
                <Rocket size={13} />
                部署
              </button>
            ) : null}
            {task.statusCd === "SUCCEEDED" && datasetCard?.coverUrl ? (
              testReady ? (
                <Link
                  className="secondary-button compact"
                  href={`/training-tasks/${encodeURIComponent(String(taskId))}/test`}
                >
                  <Boxes size={13} />
                  测试验证
                </Link>
              ) : (
                <span
                  className="secondary-button compact is-disabled"
                  aria-disabled="true"
                  title="请先部署到设备，部署激活后才能测试验证"
                >
                  <Boxes size={13} />
                  测试验证
                </span>
              )
            ) : null}
            <strong className="overview-progress-value">{formatProgress(task.progress)}</strong>
          </div>
        </div>
        <span
          className="progress-track overview-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Number(task.progress) || 0)}
          aria-label={`训练进度 ${formatProgress(task.progress)}`}
        >
          <span style={{ width: progressWidth(task.progress) }} />
        </span>
        <div className="overview-next-meta">
          <span>轮次 {displayEpoch} / {task.totalEpochs || "—"}</span>
          <span>设备 {task.deviceName || "未下发"}</span>
          <span>下发 {task.queuedAt || "—"}</span>
          <span>开始 {task.startedAt || "—"}</span>
          {task.finishedAt ? <span>结束 {task.finishedAt}</span> : null}
          <span>上报 {task.deviceReportedAt || "—"}</span>
        </div>
        {latestDeployment ? (
          <p className="device-detail-hint task-deployment-line" role="status">
            部署 {deploymentStatusLabel[latestDeployment.statusCd] ?? latestDeployment.statusCd}
            {" · "}任务 {latestDeployment.deploymentCode}
            {activeDeployment?.serviceInfo?.modelCode
              ? ` · 模型 ${activeDeployment.serviceInfo.modelCode} · ${activeDeployment.serviceInfo.modelVersion ?? ""}`
              : ""}
            {deployInProgress ? " · 设备执行中，稍后自动刷新" : ""}
          </p>
        ) : null}
        {task.errorMessage ? (
          <p className="device-detail-hint is-error" role="alert">{task.errorMessage}</p>
        ) : null}
      </div>

        {headlineSeries.length || datasetCard ? (
        <div className="task-overview-strip">
          {datasetCard ? (
            <div className={`task-overview-dataset${datasetCard.coverUrl ? "" : " no-cover"}`}>
              {datasetCard.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="task-overview-cover" src={datasetCard.coverUrl} alt={`${datasetCard.name} 样本封面`} />
              ) : null}
              <div className="task-overview-dataset-meta">
                <strong>{datasetCard.name}</strong>
                <small>
                  {datasetCard.imageCount} imgs · {datasetCard.classCount} cls · {datasetCard.version}
                </small>
              </div>
            </div>
          ) : null}
          {headlineSeries.map((headline) => (
            <div className="task-overview-metric" key={headline.key}>
              <span className="task-overview-metric-label">{headline.label}</span>
              <strong className="task-overview-metric-value">{headlinePercent(headline.series)}</strong>
              <HeadlineSparkline series={headline.series} />
            </div>
          ))}
        </div>
        ) : null}
      </article>

      <article className="panel device-section">
        <h3 className="device-section-title">
          <Activity size={13} aria-hidden="true" /> 指标曲线
          <small>按指标名与数据集分组，x 轴为轮次</small>
        </h3>
        {seriesList.length ? (
          <div className="metric-chart-grid">
            {seriesList.map((series) => (
              <MetricChart key={series.key} series={series} />
            ))}
          </div>
        ) : (
          <p className="device-detail-hint">暂无指标上报：任务开始训练后，设备会按轮次写入训练指标。</p>
        )}
      </article>

      <article className="panel device-section">
        <div className="platform-section-heading">
          <h3 className="device-section-title">
            <ListOrdered size={13} aria-hidden="true" /> 训练产物
            <small>共 {visibleArtifacts.length} 项 · 训练中自动更新</small>
          </h3>
          {artifactDisplay.length ? (
            <div className="task-artifact-picker" role="group" aria-label="选择展示的产物类型">
              {artifactDisplay.map((item) => (
                <label
                  className={`platform-tasktype-chip${item.checked ? " is-checked" : ""}`}
                  key={item.code}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleArtifactDisplay(item.code)}
                  />
                  {item.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        {visibleArtifacts.length ? (
          <>
            <div className="task-artifact-image-grid">
              {visibleArtifacts
                .filter((artifact) => IMAGE_ARTIFACT_TYPES.has(artifact.artifactType))
                .map((artifact) => (
                  <figure
                    className="task-artifact-image"
                    key={String(artifact.id)}
                    onClick={() => setPreviewArtifact(artifact)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setPreviewArtifact(artifact);
                    }}
                    aria-label={`查看大图：${artifact.name}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={artifactDownloadHref(artifact)} alt={artifact.name} loading="lazy" />
                    <figcaption>
                      <strong>{artifact.name}</strong>
                      <small>{artifact.epoch ? `epoch ${artifact.epoch}` : ""}</small>
                    </figcaption>
                  </figure>
                ))}
            </div>
            <table className="task-artifact-table">
              <thead>
                <tr>
                  <th>产物</th>
                  <th>类型</th>
                  <th>大小</th>
                  <th>轮次</th>
                  <th>更新时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {visibleArtifacts
                  .filter((artifact) => !IMAGE_ARTIFACT_TYPES.has(artifact.artifactType))
                  .map((artifact) => (
                    <tr key={String(artifact.id)}>
                      <td>{artifact.name}</td>
                      <td>{artifact.artifactType}</td>
                      <td>{formatArtifactSize(artifact.fileSize)}</td>
                      <td>{artifact.epoch ?? "—"}</td>
                      <td>{artifact.updateTime ?? "—"}</td>
                      <td>
                        <a href={artifactDownloadHref(artifact)} target="_blank" rel="noreferrer">下载</a>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="device-detail-hint">
            暂无产物：训练启动后参数快照、权重刷新与轮次指标表会自动上传，评估图与日志在训练完成时上传。
          </p>
        )}
      </article>

      <article className="panel device-section">
        <h3 className="device-section-title">
          <ListOrdered size={13} aria-hidden="true" /> 事件时间线
          <small>共 {events.length} 条</small>
        </h3>
        {events.length ? (
          <ol className="task-event-timeline">
            {events.map((event) => (
              <li key={String(event.id)} data-status={event.statusCd ?? undefined}>
                <span className="task-event-time">{event.eventTime}</span>
                <span className="task-event-body">
                  <strong>{event.eventType}{event.statusCd ? ` · ${statusText(event.statusCd)}` : ""}</strong>
                  {event.message ? <span>{event.message}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="device-detail-hint">暂无事件：任务创建、下发与训练过程的关键节点都会记录在这里。</p>
        )}
      </article>

      <article className="panel device-section">
        <h3 className="device-section-title">训练参数</h3>
        <div className="device-kv-block">
          <pre>{describeJsonValue(task.hyperParamsJson)}</pre>
        </div>
      </article>

      {deployDialogOpen ? (
        <div className="workbench-dialog-backdrop" role="presentation" onClick={() => !deployBusy && setDeployDialogOpen(false)}>
          <section
            className="workbench-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-deploy-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Rocket size={18} /></span>
                <span>
                  <h2 id="task-deploy-title">部署到设备</h2>
                  <p>发布训练产物为模型版本后下发到所选设备（同一步完成，已发布则复用）。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={deployBusy} onClick={() => setDeployDialogOpen(false)}>×</button>
            </div>
            <div className="task-deploy-device-list" role="radiogroup" aria-label="选择目标设备">
              {deployDevices === null ? (
                <p className="device-detail-hint"><LoaderCircle size={12} className="spinner" /> 正在加载在线设备…</p>
              ) : deployDevices.length ? deployDevices.map((device) => (
                <label
                  key={String(device.deviceId)}
                  className={`task-deploy-device${deployDeviceId === String(device.deviceId) ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="task-deploy-device"
                    value={String(device.deviceId)}
                    checked={deployDeviceId === String(device.deviceId)}
                    onChange={() => setDeployDeviceId(String(device.deviceId))}
                  />
                  <span className="task-deploy-device-name">{device.name}</span>
                  <small>{device.deviceCode} · {device.deviceType}</small>
                </label>
              )) : (
                <p className="device-detail-hint">没有在线设备，请先在边缘设备页确认设备在线。</p>
              )}
            </div>
            {deployError ? <p className="resource-action-error" role="alert">{deployError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={deployBusy} onClick={() => setDeployDialogOpen(false)}>取消</button>
              <button className="primary-button" type="button" disabled={deployBusy || !deployDeviceId} onClick={() => void confirmDeploy()}>
                {deployBusy ? "正在发布并下发" : "发布并部署"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {previewArtifact ? (
        <div
          className="task-artifact-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`产物预览：${previewArtifact.name}`}
          onClick={() => setPreviewArtifact(null)}
        >
          <figure onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={artifactDownloadHref(previewArtifact)} alt={previewArtifact.name} />
            <figcaption>
              <strong>{previewArtifact.name}</strong>
              <small>
                {previewArtifact.artifactType}
                {previewArtifact.epoch ? ` · epoch ${previewArtifact.epoch}` : ""}
                {previewArtifact.fileSize ? ` · ${formatArtifactSize(previewArtifact.fileSize)}` : ""}
              </small>
              <a href={artifactDownloadHref(previewArtifact)} target="_blank" rel="noreferrer">下载原文件</a>
            </figcaption>
            <button
              type="button"
              className="task-artifact-lightbox-close"
              aria-label="关闭预览"
              onClick={() => setPreviewArtifact(null)}
            >
              ×
            </button>
          </figure>
        </div>
      ) : null}
    </section>
  );
}
