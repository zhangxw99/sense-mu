"use client";

import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Boxes,
  Clock,
  GitBranch,
  GitCompare,
  ListOrdered,
  LoaderCircle,
  Rocket,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AutomlMetricsPoint,
  type AutomlTrainingArtifact,
  type AutomlTrainingEvent,
  type AutomlTrainingPublication,
  type AutomlTrainingTask,
  type AutomlTrainingVersionFamily,
  AUTOML_TRAINING_TASKS_CHANGED_EVENT,
  createAutomlTrainingTask,
  dispatchAutomlTrainingTask,
  getAutomlTrainingPublication,
  getAutomlTrainingTask,
  isTrainingTaskActive,
  listAutomlTrainingArtifacts,
  listAutomlTrainingTaskDeployments,
  listAutomlTrainingTaskEvents,
  listAutomlTrainingTaskMetrics,
  listAutomlTrainingTaskVersions,
  publishAutomlTrainingTask,
  publishAutomlTrainingToMarket,
  trainingTaskStatusLabels,
  unpublishAutomlTrainingFromMarket,
} from "../../../lib/automl-training-api";
import { type AutomlVersionDetail, getAutomlDatasetVersionDetails } from "../../../lib/automl-data-api";
import {
  type AutomlDevice,
  type AutomlDeviceDeployment,
  createAutomlDeviceDeployment,
  isDeploymentInProgress,
  listAutomlDeployments,
  listAutomlDevices,
  resolveRunningDeployment,
  trainingCapableDevices,
} from "../../../lib/automl-device-api";
import { useTaskDatasetCard } from "./use-task-dataset-card";
import {
  getAutomlPlatform,
  listAutomlConstants,
  type AutomlPlatformConfigSchema,
} from "../../../lib/automl-platform-api";
import { metricQualityColor } from "../../../lib/metric-quality";
import { buildTrainingParamEntries } from "../../../lib/training-params";
import { coerceParamValue, splitSchemaParams, type SchemaParamEntry } from "../../../lib/automl-platform-schema";

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

function pickHeadlineSeries(seriesList: MetricSeries[], preferMaskMetrics = false): HeadlineSeries[] {
  const headline: HeadlineSeries[] = [];
  for (const meta of HEADLINE_METRICS) {
    // 分割训练会同时上报 Box(B)/Mask(M) 两套同形指标：按任务类型择一展示，避免 mask 指标被 box 顶掉
    const suffixPattern = preferMaskMetrics ? /\(M\)|\[M\]/i : /\(B\)|\[B\]/i;
    const candidates = seriesList.filter((s) => meta.pattern.test(s.metricName));
    const preferred = candidates.filter((s) => suffixPattern.test(s.metricName));
    const plain = candidates.filter((s) => !/\([BM]\)|\[[BM]\]/i.test(s.metricName));
    const pool = preferred.length ? preferred : plain.length ? plain : candidates;
    // 同名指标优先取 val，没有 val 取 train
    const val = pool.find((s) => s.splitType === "val");
    const series = val ?? pool[0];
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

// 卡片染色的原始读数（0-1 或百分比，metricQualityColor 内部归一）
function headlineLatest(series: MetricSeries): number {
  return Number(series.points[series.points.length - 1]?.metricValue ?? Number.NaN);
}

// 版本行 mAP50 原始读数：分割任务优先 Mask(M)，检测取 Box(B)；无指标返回 null
function versionRawMap50(metricsJson: Record<string, number> | null | undefined, taskType: string | null): number | null {
  if (!metricsJson) return null;
  const preferMask = taskType === "INSTANCE_SEGMENTATION" || taskType === "SEGMENTATION";
  const keys = preferMask
    ? ["metrics/mAP50(M)", "metrics/mAP50(B)", "mAP50"]
    : ["metrics/mAP50(B)", "metrics/mAP50(M)", "mAP50"];
  for (const key of keys) {
    const value = metricsJson[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function formatVersionMetric(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value > 1 ? value : value * 100).toFixed(1)}%`;
}

// ---- 重训对比（「继续训练」的任务 vs 其来源任务）----

type ParamChange = { key: string; from: string; to: string; kind: "changed" | "added" | "removed" };

function formatParamValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function diffHyperParams(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): ParamChange[] {
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]);
  const changes: ParamChange[] = [];
  for (const key of keys) {
    const before = previous?.[key];
    const after = next?.[key];
    if (before === undefined && after !== undefined) {
      changes.push({ key, from: "—", to: formatParamValue(after), kind: "added" });
    } else if (before !== undefined && after === undefined) {
      changes.push({ key, from: formatParamValue(before), to: "—", kind: "removed" });
    } else if (formatParamValue(before) !== formatParamValue(after)) {
      changes.push({ key, from: formatParamValue(before), to: formatParamValue(after), kind: "changed" });
    }
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key));
}

// 重训参数字段显示值：用户编辑过用编辑值，否则回显来源任务的超参（标量）；复杂值不进编辑器
function retrainParamDisplayValue(
  key: string,
  hyperParams: Record<string, unknown> | null | undefined,
  edits: Record<string, string>,
): string {
  if (edits[key] !== undefined) return edits[key];
  const original = hyperParams?.[key];
  if (original == null || typeof original === "object") return "";
  return String(original);
}

// 重训提交的超参：编辑过的键按 schema 类型还原（清空=跟随平台默认），未编辑的键透传来源值
function buildRetrainHyperParams(
  hyperParams: Record<string, unknown> | null | undefined,
  schema: AutomlPlatformConfigSchema | null | undefined,
  edits: Record<string, string>,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {};
  const properties = schema?.properties ?? {};
  for (const [key, property] of Object.entries(properties)) {
    if (edits[key] !== undefined) {
      const coerced = coerceParamValue(property, edits[key]);
      if (coerced !== undefined) merged[key] = coerced;
      continue;
    }
    const original = hyperParams?.[key];
    if (original !== undefined) merged[key] = original;
  }
  for (const [key, value] of Object.entries(hyperParams ?? {})) {
    if (!(key in properties)) merged[key] = value;
  }
  return Object.keys(merged).length ? merged : null;
}

// 曲线分类：loss 结尾=训练损失，mAP/precision/recall 等=评估指标，其余兜底
function chartCategory(metricName: string): "metric" | "loss" | "other" {
  if (/loss/i.test(metricName)) return "loss";
  if (/mAP|precision|recall|f1|metrics\//i.test(metricName)) return "metric";
  return "other";
}

type ChartGroup = {
  key: "metric" | "loss" | "other";
  title: string;
  hint: string;
  seriesList: MetricSeries[];
};

// 指标曲线分组展示：评估指标在前（关键指标序），训练损失其后（字典序），其他兜底
function groupChartSeries(seriesList: MetricSeries[]): ChartGroup[] {
  const buckets: Record<"metric" | "loss" | "other", MetricSeries[]> = {
    metric: [],
    loss: [],
    other: [],
  };
  for (const series of seriesList) {
    buckets[chartCategory(series.metricName)].push(series);
  }
  const headlineOrder = (series: MetricSeries) => {
    const index = HEADLINE_METRICS.findIndex((meta) => meta.pattern.test(series.metricName));
    return index === -1 ? HEADLINE_METRICS.length : index;
  };
  const bySplit = (a: MetricSeries, b: MetricSeries) => (a.splitType ?? "").localeCompare(b.splitType ?? "");
  buckets.metric.sort((a, b) => headlineOrder(a) - headlineOrder(b) || a.metricName.localeCompare(b.metricName) || bySplit(a, b));
  buckets.loss.sort((a, b) => a.metricName.localeCompare(b.metricName) || bySplit(a, b));
  buckets.other.sort((a, b) => a.metricName.localeCompare(b.metricName) || bySplit(a, b));
  const groups: ChartGroup[] = [];
  if (buckets.metric.length) {
    groups.push({ key: "metric", title: "评估指标", hint: "越高越好 · 卡片底色即训练效果", seriesList: buckets.metric });
  }
  if (buckets.loss.length) {
    groups.push({ key: "loss", title: "训练损失", hint: "越低越好", seriesList: buckets.loss });
  }
  if (buckets.other.length) {
    groups.push({ key: "other", title: "其他指标", hint: "", seriesList: buckets.other });
  }
  return groups;
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
function HeadlineSparkline({ series, accent }: { series: MetricSeries; accent: string }) {
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
      <polyline className="metric-chart-line" points={polyline} style={{ stroke: accent }} />
      {values.length === 1 ? (
        <circle className="metric-chart-dot" cx={width / 2} cy={yAt(values[0])} r={2.4} style={{ fill: accent }} />
      ) : null}
    </svg>
  );
}

export function TrainingTaskDetailWorkbench({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<AutomlTrainingTask | null>(null);
  const [metrics, setMetrics] = useState<AutomlMetricsPoint[]>([]);
  const [events, setEvents] = useState<AutomlTrainingEvent[]>([]);
  const datasetCard = useTaskDatasetCard(task);
  const [artifacts, setArtifacts] = useState<AutomlTrainingArtifact[]>([]);
  const [artifactDisplay, setArtifactDisplay] = useState<ArtifactDisplayItem[]>([]);
  const [previewArtifact, setPreviewArtifact] = useState<AutomlTrainingArtifact | null>(null);
  // 部署：任务部署历史 + 部署对话框状态
  const [deployments, setDeployments] = useState<AutomlDeviceDeployment[]>([]);
  // 每设备最新激活的部署（后端 ACTIVE 列表）：判定「已部署并运行中」用
  const [runningRows, setRunningRows] = useState<AutomlDeviceDeployment[] | null>(null);
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [deployDevices, setDeployDevices] = useState<AutomlDevice[] | null>(null);
  const [deployDeviceId, setDeployDeviceId] = useState("");
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  // 接口地址别名（POST /{别名}/detect，/detect 固定）：部署时设置，后台校验唯一
  const [deployAlias, setDeployAlias] = useState("");
  // 算法市场发布/上架状态：「发布到算法市场 / 从算法市场下架」按钮依据
  const [publication, setPublication] = useState<AutomlTrainingPublication | null>(null);
  // 模型版本家族（§9.13）：任务自身发布版本或血缘上游所属模型的全部版本
  const [family, setFamily] = useState<AutomlTrainingVersionFamily | null>(null);
  // 重训对比：来源任务详情 + 其指标序列（task.sourceTrainingTaskId 存在时加载）
  const [compareSource, setCompareSource] = useState<{ task: AutomlTrainingTask; series: MetricSeries[] } | null>(null);
  const [compareVersionDetail, setCompareVersionDetail] = useState<AutomlVersionDetail | null>(null);
  // 继续训练对话框（数据版本升级重训）
  const [retrainOpen, setRetrainOpen] = useState(false);
  const [retrainVersions, setRetrainVersions] = useState<AutomlVersionDetail["versions"] | null>(null);
  const [retrainVersionId, setRetrainVersionId] = useState("");
  const [retrainName, setRetrainName] = useState("");
  const [retrainDispatch, setRetrainDispatch] = useState(false);
  const [retrainDevices, setRetrainDevices] = useState<AutomlDevice[] | null>(null);
  const [retrainDeviceId, setRetrainDeviceId] = useState("");
  // 训练参数编辑值（仅记录用户改动；未编辑的键回显并透传来源任务值）
  const [retrainEdits, setRetrainEdits] = useState<Record<string, string>>({});
  const [retrainBusy, setRetrainBusy] = useState(false);
  const [retrainError, setRetrainError] = useState<string | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef(false);

  const refreshAll = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    pollingRef.current = true;
    try {
      const [nextTask, nextMetrics, nextEvents, nextArtifacts, nextDeployments, nextRunning, nextPublication, nextFamily] = await Promise.all([
        getAutomlTrainingTask(taskId),
        listAutomlTrainingTaskMetrics(taskId).catch(() => []),
        listAutomlTrainingTaskEvents(taskId).catch(() => []),
        listAutomlTrainingArtifacts(taskId).catch(() => []),
        listAutomlTrainingTaskDeployments(taskId).catch(() => []),
        // 运行中口径来源：后端 ACTIVE 列表已按「每设备最新一次激活」去重
        listAutomlDeployments({ page: 1, limit: 200, statusCd: "ACTIVE" }).catch(() => null),
        getAutomlTrainingPublication(taskId).catch(() => null),
        listAutomlTrainingTaskVersions(taskId).catch(() => null),
      ]);
      setTask(nextTask);
      setMetrics(nextMetrics);
      setEvents(nextEvents);
      setArtifacts(nextArtifacts);
      setDeployments(nextDeployments);
      setRunningRows(nextRunning?.rows ?? null);
      setPublication(nextPublication);
      setFamily(nextFamily);
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
  // 分割任务的关键指标优先取 Mask(M) 系列，其余任务取 Box(B)
  const headlineSeries = useMemo(
    () => pickHeadlineSeries(seriesList, task?.taskType === "INSTANCE_SEGMENTATION" || task?.taskType === "SEGMENTATION"),
    [seriesList, task?.taskType],
  );

  // 重训对比数据：来源任务详情/指标 + 两版数据集统计（同数据集时一次请求覆盖）
  const sourceTaskId = task?.sourceTrainingTaskId ?? null;
  useEffect(() => {
    if (!sourceTaskId) {
      setCompareSource(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [source, points] = await Promise.all([
          getAutomlTrainingTask(sourceTaskId),
          listAutomlTrainingTaskMetrics(sourceTaskId).catch(() => []),
        ]);
        if (cancelled) return;
        setCompareSource({ task: source, series: groupMetricSeries(points) });
      } catch {
        if (!cancelled) setCompareSource(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceTaskId]);

  // 版本统计（数据集对比块）：重训场景两个版本通常同属一个数据集
  useEffect(() => {
    const datasetId = task?.datasetId;
    if (!sourceTaskId || !datasetId) {
      setCompareVersionDetail(null);
      return;
    }
    let cancelled = false;
    getAutomlDatasetVersionDetails(datasetId)
      .then((detail) => {
        if (!cancelled) setCompareVersionDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setCompareVersionDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceTaskId, task?.datasetId]);
  // 指标曲线分区：评估指标 / 训练损失 / 其他
  const chartGroups = useMemo(() => groupChartSeries(seriesList), [seriesList]);

  // ---- 重训对比派生：上一轮 headline / 参数 diff / 数据集版本变化 ----
  const sourceHeadline = useMemo(
    () =>
      compareSource
        ? pickHeadlineSeries(compareSource.series, task?.taskType === "INSTANCE_SEGMENTATION" || task?.taskType === "SEGMENTATION")
        : [],
    [compareSource, task?.taskType],
  );
  const paramChanges = useMemo(
    () => (compareSource ? diffHyperParams(compareSource.task.hyperParamsJson, task?.hyperParamsJson) : []),
    [compareSource, task?.hyperParamsJson],
  );
  const versionCompare = useMemo(() => {
    if (!compareSource || !compareVersionDetail) return null;
    const sameDataset = String(compareSource.task.datasetId ?? "") === String(task?.datasetId ?? "");
    const toVersion = compareVersionDetail.versions.find((entry) => String(entry.id) === String(task?.datasetVersionId)) ?? null;
    const fromVersion = sameDataset
      ? compareVersionDetail.versions.find((entry) => String(entry.id) === String(compareSource.task.datasetVersionId)) ?? null
      : null;
    const fromCount = fromVersion?.sampleCount ?? null;
    const toCount = toVersion?.sampleCount ?? null;
    const classChanges: { className: string; from: number; to: number }[] = [];
    if (sameDataset && fromVersion && toVersion) {
      const fromByClass = new Map(fromVersion.classSampleStats.map((stat) => [stat.className, Number(stat.sampleCount) || 0]));
      const toByClass = new Map(toVersion.classSampleStats.map((stat) => [stat.className, Number(stat.sampleCount) || 0]));
      for (const [className, to] of toByClass) {
        const from = fromByClass.get(className) ?? 0;
        if (from !== to) classChanges.push({ className, from, to });
      }
      for (const [className, from] of fromByClass) {
        if (!toByClass.has(className)) classChanges.push({ className, from, to: 0 });
      }
      classChanges.sort((a, b) => b.to - b.from - (a.to - a.from));
    }
    return {
      sameDataset,
      fromLabel: fromVersion ? `v${fromVersion.version.replace(/^v/i, "")}` : compareSource.task.datasetVersionId ? `版本 #${compareSource.task.datasetVersionId}` : "—",
      toLabel: toVersion ? `v${toVersion.version.replace(/^v/i, "")}` : task?.datasetVersionId ? `版本 #${task.datasetVersionId}` : "—",
      fromCount,
      toCount,
      classChanges,
    };
  }, [compareSource, compareVersionDetail, task]);

  // 平台参数 schema：把 hyperParamsJson 的键翻译成中文标题（拉不到就退回键名）
  const platformId = task?.platformId ?? null;
  const [platformSchema, setPlatformSchema] = useState<AutomlPlatformConfigSchema | null>(null);
  useEffect(() => {
    if (platformId == null) {
      setPlatformSchema(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const platform = await getAutomlPlatform(platformId);
        if (!cancelled) setPlatformSchema(platform.configSchemaJson ?? null);
      } catch {
        if (!cancelled) setPlatformSchema(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platformId]);
  const paramEntries = useMemo(
    () => buildTrainingParamEntries(task?.hyperParamsJson ?? null, platformSchema),
    [task?.hyperParamsJson, platformSchema],
  );

  // 部署/测试验证入口状态：可部署=训练成功且有最优权重产物
  // 已部署（运行中）= ACTIVE 记录 ∩ 每设备最新激活——设备切到别的模型后旧记录不算数；
  // 测试验证只要有部署记录即可（测试页按部署起临时会话加载模型，不依赖常驻激活）
  const activeDeployment = resolveRunningDeployment(deployments, runningRows);
  const hasDeployHistory = deployments.some((deployment) => deployment.statusCd === "ACTIVE");
  const hasBestWeight = artifacts.some((artifact) => artifact.artifactType === "WEIGHT_BEST");
  const deployReady = Boolean(task && task.statusCd === "SUCCEEDED" && hasBestWeight);
  const testReady = hasDeployHistory;
  const deployInProgress = deployments.some((deployment) => isDeploymentInProgress(deployment.statusCd));

  // 算法市场：published=已注册模型资产；LISTED=市场上架中。下架只影响市场可见性，已部署设备不受影响。
  const published = publication?.published === true;
  const marketListed = published && publication?.marketStatusCd === "LISTED";
  const hasOnnxPackage = artifacts.some((artifact) => artifact.artifactType === "MODEL_ONNX");
  const marketPublishReady = Boolean(task && task.statusCd === "SUCCEEDED" && hasBestWeight && hasOnnxPackage);

  // 发布到算法市场：未注册过则注册模型+打包后上架；已注册（含下架后）幂等复用并重新上架。
  // 家族已有模型（自身或血缘上游发布过）时携带 modelId → 发布为家族新版本 v{n+1}（§9.10）
  const confirmMarketPublish = useCallback(async () => {
    setMarketBusy(true);
    setNotice(null);
    try {
      const result = await publishAutomlTrainingToMarket(taskId, family?.modelId ?? null);
      setNotice(`已发布到算法市场：${result.modelCode} · ${result.version}${result.reused ? "（复用已有版本）" : "（新版本）"}。`);
      await refreshAll(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布到算法市场失败，请稍后重试");
    } finally {
      setMarketBusy(false);
    }
  }, [family, refreshAll, taskId]);

  const confirmMarketUnpublish = useCallback(async () => {
    setMarketBusy(true);
    setNotice(null);
    try {
      await unpublishAutomlTrainingFromMarket(taskId);
      setNotice("已从算法市场下架；已部署设备不受影响。");
      await refreshAll(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "下架失败，请稍后重试");
    } finally {
      setMarketBusy(false);
    }
  }, [refreshAll, taskId]);

  // 部署对话框打开：拉在线设备列表
  const openDeployDialog = useCallback(() => {
    setDeployError(null);
    setDeployDeviceId("");
    // 预填：沿用当前别名（运行中优先，否则取最近一次部署的别名），否则按基础模型 + 任务尾号生成建议值（可改，后台最终校验唯一）
    setDeployAlias(activeDeployment?.apiAlias?.trim()
      || deployments.find((deployment) => deployment.apiAlias?.trim())?.apiAlias?.trim()
      || `${(task?.baseModelName || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "model"}-${String(taskId).slice(-3)}`);
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
  }, [activeDeployment, deployments, task, taskId]);

  // 一键部署：注册模型资产（幂等，家族已有模型则挂新版本）→ 建部署任务（设备心跳领取）
  const confirmDeploy = useCallback(async () => {
    if (!deployDeviceId) {
      setDeployError("请选择一台在线设备");
      return;
    }
    setDeployBusy(true);
    setDeployError(null);
    try {
      const asset = await publishAutomlTrainingTask(taskId, family?.modelId ?? null);
      await createAutomlDeviceDeployment(deployDeviceId, asset.modelVersionId, deployAlias);
      setDeployDialogOpen(false);
      setNotice(`已注册为模型 ${asset.modelCode} · ${asset.version}（${asset.reused ? "复用已有版本" : "新版本"}），部署任务已下发到设备。`);
      await refreshAll(true);
    } catch (reason) {
      setDeployError(reason instanceof Error ? reason.message : "部署下发失败，请稍后重试");
    } finally {
      setDeployBusy(false);
    }
  }, [deployAlias, deployDeviceId, family, refreshAll, taskId]);

  // ---- 继续训练（数据版本升级重训）：克隆超参/基础模型，血缘指向当前任务（§9.1），
  //      训练完成后经「发布」挂到同一模型家族发新版本（§9.13）----
  const openRetrainDialog = useCallback(() => {
    if (!task) return;
    setRetrainError(null);
    setRetrainVersions(null);
    setRetrainDispatch(false);
    setRetrainDeviceId("");
    setRetrainEdits({});
    setRetrainName(`${task.name} · 重训`);
    setRetrainOpen(true);
    void (async () => {
      try {
        if (task.datasetId == null) {
          setRetrainVersions([]);
          setRetrainError("当前任务未关联数据集，无法选择新版本");
          return;
        }
        const detail = await getAutomlDatasetVersionDetails(String(task.datasetId));
        const sorted = [...detail.versions].sort((left, right) => Number(right.id) - Number(left.id));
        setRetrainVersions(sorted);
        // 默认选最新的 READY 且非当前版本；没有则最新版本
        const preferred = sorted.find((version) => version.statusCd === "READY" && String(version.id) !== String(task.datasetVersionId))
          ?? sorted[0];
        setRetrainVersionId(preferred ? String(preferred.id) : "");
      } catch (reason) {
        setRetrainVersions([]);
        setRetrainError(reason instanceof Error ? reason.message : "数据集版本列表加载失败");
      }
    })();
    void (async () => {
      try {
        const page = await listAutomlDevices({ page: 1, limit: 50, statusCd: "ONLINE" });
        // 重训下发只列支持训练的设备（端侧明确不支持的排除，能力未知保留）
        setRetrainDevices(trainingCapableDevices(page.rows));
      } catch {
        setRetrainDevices([]);
      }
    })();
  }, [task]);

  const confirmRetrain = useCallback(async () => {
    if (!task) return;
    if (!retrainVersionId) {
      setRetrainError("请选择数据集版本");
      return;
    }
    if (retrainDispatch && !retrainDeviceId) {
      setRetrainError("请选择下发设备，或取消「立即下发」");
      return;
    }
    setRetrainBusy(true);
    setRetrainError(null);
    try {
      const created = await createAutomlTrainingTask({
        name: retrainName.trim() ? retrainName.trim() : undefined,
        datasetVersionId: retrainVersionId,
        baseModelId: task.baseModelId ?? 0,
        hyperParamsJson: buildRetrainHyperParams(task.hyperParamsJson, platformSchema, retrainEdits),
        sourceTrainingTaskId: task.id,
      });
      if (retrainDispatch) {
        await dispatchAutomlTrainingTask(created.id, retrainDeviceId);
      }
      window.dispatchEvent(new Event(AUTOML_TRAINING_TASKS_CHANGED_EVENT));
      setRetrainOpen(false);
      router.push(`/training-tasks/${encodeURIComponent(String(created.id))}`);
    } catch (reason) {
      setRetrainError(reason instanceof Error ? reason.message : "创建重训任务失败，请稍后重试");
    } finally {
      setRetrainBusy(false);
    }
  }, [platformSchema, retrainDeviceId, retrainDispatch, retrainEdits, retrainName, retrainVersionId, router, task]);
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
                className={`secondary-button compact${activeDeployment ? " is-deployed" : ""}`}
                type="button"
                disabled={!deployReady || deployInProgress}
                title={!deployReady
                  ? "训练产物尚未就绪（需要最优权重），完成后可部署"
                  : deployInProgress
                    ? "部署进行中"
                    : activeDeployment
                      ? `已部署到 ${activeDeployment.deviceName || "设备"} 并运行中 · 点击可重新部署或更换设备`
                      : hasDeployHistory
                        ? "设备已切换到其他模型 · 点击可重新部署"
                        : "选择设备并部署训练产物"}
                onClick={openDeployDialog}
              >
                {activeDeployment ? <BadgeCheck size={13} /> : <Rocket size={13} />}
                {activeDeployment ? "已部署" : "部署"}
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
            {task.statusCd === "SUCCEEDED" || task.statusCd === "FAILED" ? (
              <button
                className="secondary-button compact"
                type="button"
                title="用该数据集的新版本克隆本任务配置重训，发布后成为同一模型的新版本"
                onClick={openRetrainDialog}
              >
                <RotateCcw size={13} />
                继续训练
              </button>
            ) : null}
            {task.statusCd === "SUCCEEDED" && marketListed ? (
              <button
                className="secondary-button compact"
                type="button"
                disabled={marketBusy}
                title="从算法市场下架；已部署设备不受影响"
                onClick={() => void confirmMarketUnpublish()}
              >
                从算法市场下架
              </button>
            ) : null}
            {task.statusCd === "SUCCEEDED" && !marketListed ? (
              <button
                className="secondary-button compact"
                type="button"
                disabled={marketBusy || !marketPublishReady}
                title={!marketPublishReady
                  ? "训练产物尚未就绪（需要最优权重 + ONNX 模型），完成后可发布"
                  : published
                    ? "模型已注册但未上架，点击重新发布到算法市场"
                    : "发布训练成果到算法市场，供市场浏览与部署"}
                onClick={() => void confirmMarketPublish()}
              >
                <UploadCloud size={13} />
                {published ? "重新发布到算法市场" : "发布到算法市场"}
              </button>
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
        {task.errorMessage ? (
          <p className="device-detail-hint is-error" role="alert">{task.errorMessage}</p>
        ) : null}
      </div>

        {headlineSeries.length ? (
          <div className="metric-quality-legend">
            <small>卡片底色 = 训练效果</small>
            <span className="metric-quality-scale" role="img" aria-label="质量色阶：红=差，绿=优">
              <span className="metric-quality-cap is-bad">差</span>
              <i data-quality-bar />
              <span className="metric-quality-cap is-good">优</span>
            </span>
          </div>
        ) : null}
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
          {headlineSeries.map((headline) => {
            const quality = metricQualityColor(headlineLatest(headline.series));
            return (
              <div
                className="task-overview-metric"
                key={headline.key}
                style={{
                  background: quality.background,
                  boxShadow: `inset 0 2px 0 hsl(${quality.hue.toFixed(1)} 45% 62%)`,
                }}
              >
                <span className="task-overview-metric-label">{headline.label}</span>
                <strong className="task-overview-metric-value" style={{ color: quality.accent }}>
                  {headlinePercent(headline.series)}
                </strong>
                <HeadlineSparkline series={headline.series} accent={quality.accent} />
              </div>
            );
          })}
        </div>
        ) : null}
      </article>

      <article className="panel device-section">
        <div className="platform-section-heading">
          <h3 className="device-section-title">
            <GitBranch size={13} aria-hidden="true" /> 模型版本
            <small>{family?.modelId
              ? `${family.modelName || family.modelCode} · ${family.versions.length} 个版本`
              : "发布后生成版本"}</small>
          </h3>
          <div className="task-version-heading-side">
            {family?.modelId ? (
              <span className="deploy-chip" data-tone={family.marketStatusCd === "LISTED" ? "ok" : "idle"}>
                {family.marketStatusCd === "LISTED" ? "市场上架中" : "市场未上架"}
              </span>
            ) : null}
          </div>
        </div>
        {family?.versions.length ? (
          <div className="task-version-table-wrap">
            <table className="task-version-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>训练任务</th>
                  <th>数据版本</th>
                  <th>mAP50</th>
                  <th>部署包</th>
                  <th>运行设备</th>
                  <th>发布时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {family.versions.map((item) => {
                  const current = String(item.trainingTaskId) === String(taskId);
                  const map50 = versionRawMap50(item.metricsJson, task?.taskType ?? null);
                  const quality = metricQualityColor(map50);
                  return (
                    <tr key={String(item.modelVersionId)} className={current ? "is-current" : undefined}>
                      <td>
                        <span className="task-version-name">
                          <strong>{item.version}</strong>
                          {current ? <span className="task-version-current">当前任务</span> : null}
                        </span>
                      </td>
                      <td>
                        <Link href={`/training-tasks/${encodeURIComponent(String(item.trainingTaskId))}`}
                          title={item.taskName || undefined}>
                          {item.taskName || item.trainingTaskId}
                        </Link>
                      </td>
                      <td>{item.datasetVersionNumber || "—"}</td>
                      <td>
                        <strong style={map50 != null ? { color: quality.accent } : undefined}
                          title={`质量分 ${Math.round(quality.score * 100)}（红=差 绿=优）`}>
                          {formatVersionMetric(map50)}
                        </strong>
                      </td>
                      <td>{item.packageReady ? "就绪" : "打包中"}</td>
                      <td>{item.activeDeviceNames?.length ? item.activeDeviceNames.join("、") : "—"}</td>
                      <td>{item.registeredAt ?? "—"}</td>
                      <td>
                        <Link className="text-button compact"
                          href={`/training-tasks/${encodeURIComponent(String(item.trainingTaskId))}`}>
                          查看任务
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="device-detail-hint">
            还没有版本：训练成功并发布后生成 v1；数据版本升级后用「继续训练」重训，发布即为同一模型的新版本。
          </p>
        )}
        {task?.sourceTaskName ? (
          <p className="device-detail-hint">本任务由「{task.sourceTaskName}」继续训练而来，发布后将进入同一模型家族。</p>
        ) : null}
      </article>

      {sourceTaskId ? (
        <article className="panel device-section retrain-compare">
          <h3 className="device-section-title">
            <GitCompare size={13} aria-hidden="true" /> 对比上一轮
            <small>{compareSource?.task.name ? `来源：${compareSource.task.name}` : `来源任务 #${sourceTaskId}`}</small>
          </h3>

          <div className="retrain-compare-section">
            <strong>关键指标（val 终值）</strong>
            <div className="retrain-compare-metrics">
              {HEADLINE_METRICS.map((meta) => {
                const current = headlineSeries.find((item) => item.label === meta.label) ?? null;
                const previous = sourceHeadline.find((item) => item.label === meta.label) ?? null;
                const currentValue = current ? headlineLatest(current.series) : null;
                const previousValue = previous ? headlineLatest(previous.series) : null;
                const delta = currentValue != null && previousValue != null ? currentValue - previousValue : null;
                const tone = delta == null ? "" : delta > 0.0005 ? " is-up" : delta < -0.0005 ? " is-down" : "";
                return (
                  <div className="retrain-compare-metric" key={meta.label}>
                    <span className="retrain-compare-label">{meta.label}</span>
                    <span className="retrain-compare-values">
                      <strong>{formatVersionMetric(currentValue)}</strong>
                      <small>上一轮 {formatVersionMetric(previousValue)}</small>
                    </span>
                    <span className={`retrain-compare-delta${tone}`}>
                      {delta == null
                        ? "—"
                        : `${delta > 0 ? "+" : ""}${(Math.abs(delta) > 1 ? delta : delta * 100).toFixed(1)}pp`}
                    </span>
                  </div>
                );
              })}
            </div>
            {!compareSource ? <p className="device-detail-hint">来源任务数据加载中…</p> : null}
            {compareSource && !sourceHeadline.length ? (
              <p className="device-detail-hint">上一轮任务没有指标数据（可能未完成训练或早于指标上报功能）。</p>
            ) : null}
          </div>

          <div className="retrain-compare-section">
            <strong>训练参数</strong>
            {paramChanges.length ? (
              <div className="retrain-compare-params">
                {paramChanges.map((change) => (
                  <div className="retrain-compare-param" key={change.key}>
                    <code title={change.key}>{change.key}</code>
                    <span className="retrain-compare-from">{change.from}</span>
                    <span className="retrain-compare-arrow">→</span>
                    <span className="retrain-compare-to">{change.to}</span>
                    <small>{change.kind === "added" ? "新增" : change.kind === "removed" ? "移除" : "修改"}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="device-detail-hint">
                {compareSource ? "超参与上一轮完全一致。" : "来源任务数据加载中…"}
              </p>
            )}
          </div>

          <div className="retrain-compare-section">
            <strong>数据集</strong>
            {versionCompare ? (
              <div className="retrain-compare-dataset">
                <div className="retrain-compare-param">
                  <span className="retrain-compare-label">版本</span>
                  <span className="retrain-compare-from">{versionCompare.fromLabel}</span>
                  <span className="retrain-compare-arrow">→</span>
                  <span className="retrain-compare-to">{versionCompare.toLabel}</span>
                  {!versionCompare.sameDataset ? <small>已更换数据集</small> : null}
                </div>
                <div className="retrain-compare-param">
                  <span className="retrain-compare-label">样本数</span>
                  <span className="retrain-compare-from">{versionCompare.fromCount ?? "—"}</span>
                  <span className="retrain-compare-arrow">→</span>
                  <span className="retrain-compare-to">{versionCompare.toCount ?? "—"}</span>
                  {versionCompare.fromCount != null && versionCompare.toCount != null ? (
                    <small>
                      {versionCompare.toCount - versionCompare.fromCount >= 0 ? "+" : ""}
                      {versionCompare.toCount - versionCompare.fromCount}
                    </small>
                  ) : null}
                </div>
                {versionCompare.classChanges.length ? (
                  <div className="retrain-compare-param retrain-compare-classes">
                    <span className="retrain-compare-label">类别变化</span>
                    <span className="retrain-compare-class-list">
                      {versionCompare.classChanges.map((change) => (
                        <span key={change.className}>
                          {change.className} {change.from} → {change.to}
                        </span>
                      ))}
                    </span>
                  </div>
                ) : versionCompare.sameDataset ? (
                  <div className="retrain-compare-param">
                    <span className="retrain-compare-label">类别变化</span>
                    <span>各类样本数一致</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="device-detail-hint">{compareSource ? "数据集统计加载中…" : "来源任务数据加载中…"}</p>
            )}
          </div>
        </article>
      ) : null}

      <article className="panel device-section">
        <h3 className="device-section-title">
          <Activity size={13} aria-hidden="true" /> 指标曲线
          <small>评估指标与训练损失分区展示，x 轴为轮次</small>
        </h3>
        {chartGroups.length ? (
          chartGroups.map((group) => (
            <section className="metric-chart-group" key={group.key}>
              <h4>
                {group.title}
                {group.hint ? <small>{group.hint}</small> : null}
              </h4>
              <div className="metric-chart-grid">
                {group.seriesList.map((series) => (
                  <MetricChart key={series.key} series={series} />
                ))}
              </div>
            </section>
          ))
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
        <h3 className="device-section-title">
          <ListOrdered size={13} aria-hidden="true" /> 训练参数
          <small>建档时的超参与运行配置{platformSchema ? " · 参数名已按平台定义翻译" : ""}</small>
        </h3>
        {paramEntries.length ? (
          <div className="task-params-grid" aria-label="训练超参">
            {paramEntries.map((entry) => (
              <div
                className="task-param"
                key={entry.key}
                title={entry.description ?? undefined}
              >
                <span className="task-param-label">
                  {entry.title}
                  {entry.title !== entry.key ? <small>{entry.key}</small> : null}
                </span>
                <strong className="task-param-value">{entry.value}</strong>
                {entry.defaultValue && entry.defaultValue !== entry.value ? (
                  <small className="task-param-default">默认 {entry.defaultValue}</small>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="device-detail-hint">暂无训练参数：任务建档时会保存一份超参快照。</p>
        )}
        {task.hyperParamsJson && Object.keys(task.hyperParamsJson).length ? (
          <details className="task-params-raw">
            <summary>原始 JSON</summary>
            <pre>{describeJsonValue(task.hyperParamsJson)}</pre>
          </details>
        ) : null}
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
                  <p>注册训练产物为模型版本后下发到所选设备（同一步完成，已注册则复用）；上架算法市场请用「发布到算法市场」。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={deployBusy} onClick={() => setDeployDialogOpen(false)}>×</button>
            </div>
            {activeDeployment ? (
              <p className="task-deploy-active-hint" role="status">
                <BadgeCheck size={14} aria-hidden="true" />
                <span>
                  该模型已部署到「{activeDeployment.deviceName || "设备"}」并处于运行中
                  {activeDeployment.activatedAt ? `（激活于 ${activeDeployment.activatedAt}）` : ""}
                  ，可直接使用、无需重复部署；如需更换设备或多机部署，可继续选择目标设备。
                </span>
              </p>
            ) : hasDeployHistory ? (
              <p className="task-deploy-active-hint" role="status">
                <Clock size={14} aria-hidden="true" />
                <span>
                  该模型此前部署过，但目标设备已切换到其他模型运行；如需恢复，可重新部署到在线设备。
                </span>
              </p>
            ) : null}
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
            {deployDeviceId ? (
              <div className="task-deploy-alias-field">
                <span className="task-deploy-alias-label">接口地址（POST）</span>
                <div className="task-deploy-alias-input">
                  <span className="task-deploy-alias-static">POST&nbsp;/</span>
                  <input
                    value={deployAlias}
                    onChange={(event) => setDeployAlias(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="服务别名"
                    aria-label="接口别名"
                    maxLength={63}
                  />
                  <span className="task-deploy-alias-static">/detect</span>
                </div>
                <small>
                  /detect 为固定后缀；别名将写入模型并在设备推理服务上生效，与服务器 IP:端口解耦。
                  {deployAlias && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(deployAlias)
                    ? " 当前格式非法（小写字母/数字/连字符，字母或数字开头结尾）。"
                    : " 后台会校验别名唯一，重复时提交会报错。"}
                </small>
              </div>
            ) : null}
            {deployError ? <p className="resource-action-error" role="alert">{deployError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={deployBusy} onClick={() => setDeployDialogOpen(false)}>取消</button>
              <button
                className="primary-button"
                type="button"
                disabled={deployBusy || !deployDeviceId || (deployAlias !== "" && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(deployAlias))}
                onClick={() => void confirmDeploy()}
              >
                {deployBusy ? "正在发布并下发" : "发布并部署"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {retrainOpen ? (
        <div className="workbench-dialog-backdrop" role="presentation" onClick={() => !retrainBusy && setRetrainOpen(false)}>
          <section
            className="workbench-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-retrain-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><RotateCcw size={18} /></span>
                <span>
                  <h2 id="task-retrain-title">继续训练</h2>
                  <p>选择该数据集的新版本，克隆当前任务的超参与基础模型；训练完成发布后成为同一模型的新版本。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={retrainBusy} onClick={() => setRetrainOpen(false)}>×</button>
            </div>
            <div className="task-retrain-field">
              <span className="task-retrain-label">数据集版本</span>
              {retrainVersions === null ? (
                <p className="device-detail-hint"><LoaderCircle size={12} className="spinner" /> 正在加载数据集版本…</p>
              ) : retrainVersions.length ? (
                <select
                  className="task-retrain-select"
                  value={retrainVersionId}
                  onChange={(event) => setRetrainVersionId(event.target.value)}
                  aria-label="选择数据集版本"
                >
                  {retrainVersions.map((version) => (
                    <option value={String(version.id)} key={String(version.id)}>
                      {version.version} · {version.sampleCount ?? 0} 样本
                      {version.statusCd !== "READY" ? ` · ${version.statusCd}` : ""}
                      {String(version.id) === String(task?.datasetVersionId) ? " · 当前任务所用" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="device-detail-hint">该数据集还没有可用版本。</p>
              )}
              <small>版本列表来自数据集快照历史；建议先在数据页生成新版本快照再来重训。</small>
            </div>
            <div className="task-retrain-field">
              <span className="task-retrain-label">任务名称</span>
              <input
                value={retrainName}
                onChange={(event) => setRetrainName(event.target.value)}
                maxLength={128}
                aria-label="重训任务名称"
              />
            </div>
            {(() => {
              const groups = splitSchemaParams(platformSchema);
              if (!groups.common.length && !groups.advanced.length) return null;
              const renderRetrainParam = ({ key, property }: SchemaParamEntry) => {
                const value = retrainParamDisplayValue(key, task?.hyperParamsJson, retrainEdits);
                const setValue = (next: string) => setRetrainEdits((current) => ({ ...current, [key]: next }));
                const isNumeric = property.type === "integer" || property.type === "number";
                const original = task?.hyperParamsJson?.[key];
                const sourceText = original == null || typeof original === "object" ? "" : String(original);
                return (
                  <label className="automl-field" key={key}>
                    <span>{typeof property.title === "string" && property.title ? property.title : key}</span>
                    {Array.isArray(property.enum) && property.enum.length ? (
                      <select
                        className="device-dialog-select"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                      >
                        <option value="">跟随默认</option>
                        {property.enum.map((candidate) => (
                          <option value={String(candidate)} key={String(candidate)}>{String(candidate)}</option>
                        ))}
                      </select>
                    ) : property.type === "boolean" ? (
                      <select
                        className="device-dialog-select"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                      >
                        <option value="">跟随默认</option>
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    ) : isNumeric ? (
                      <input
                        className="device-dialog-select"
                        type="number"
                        min={property.minimum != null ? String(property.minimum) : undefined}
                        max={property.maximum != null ? String(property.maximum) : undefined}
                        step={property.type === "integer" ? "1" : "any"}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                      />
                    ) : (
                      <input
                        className="device-dialog-select"
                        value={value}
                        placeholder={property.default !== undefined ? `默认 ${String(property.default)}` : "选填"}
                        onChange={(event) => setValue(event.target.value)}
                      />
                    )}
                    {sourceText && sourceText !== value ? (
                      <small>来源任务：{sourceText}</small>
                    ) : null}
                  </label>
                );
              };
              return (
                <div className="task-retrain-field">
                  <span className="task-retrain-label">训练参数（预填当前任务值）</span>
                  <div className="task-params-grid">
                    {groups.common.map(renderRetrainParam)}
                  </div>
                  {groups.advanced.length ? (
                    <details className="platform-param-advanced">
                      <summary>高级参数（{groups.advanced.length}）</summary>
                      <div className="task-params-grid">
                        {groups.advanced.map(renderRetrainParam)}
                      </div>
                    </details>
                  ) : null}
                  <small>清空某项表示跟随平台默认；schema 外的来源参数原样透传。</small>
                </div>
              );
            })()}
            <div className="task-retrain-field">
              <label className="task-retrain-checkbox">
                <input
                  type="checkbox"
                  checked={retrainDispatch}
                  onChange={(event) => setRetrainDispatch(event.target.checked)}
                />
                创建后立即下发到设备
              </label>
              {retrainDispatch ? (
                retrainDevices === null ? (
                  <p className="device-detail-hint"><LoaderCircle size={12} className="spinner" /> 正在加载在线设备…</p>
                ) : retrainDevices.length ? (
                  <select
                    className="task-retrain-select"
                    value={retrainDeviceId}
                    onChange={(event) => setRetrainDeviceId(event.target.value)}
                    aria-label="选择下发设备"
                  >
                    <option value="">请选择在线设备</option>
                    {retrainDevices.map((device) => (
                      <option value={String(device.deviceId)} key={String(device.deviceId)}>
                        {device.name}（{device.deviceCode}）
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="device-detail-hint is-error">没有支持训练的在线设备：端侧需启用训练能力并安装训练依赖（设备列表中带「支持训练」标识）；也可只创建任务，稍后在任务详情页下发。</p>
                )
              ) : null}
            </div>
            {retrainError ? <p className="resource-action-error" role="alert">{retrainError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={retrainBusy} onClick={() => setRetrainOpen(false)}>取消</button>
              <button
                className="primary-button"
                type="button"
                disabled={retrainBusy || !retrainVersionId || (retrainDispatch && !retrainDeviceId)}
                onClick={() => void confirmRetrain()}
              >
                {retrainBusy ? "正在创建" : retrainDispatch ? "创建并下发" : "创建任务"}
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
