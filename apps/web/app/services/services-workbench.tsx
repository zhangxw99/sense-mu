"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LoaderCircle,
  RefreshCw,
  Rocket,
  ScanSearch,
  ServerCog,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type AutomlDeploymentStatus,
  type AutomlDeviceDeployment,
  deploymentStatusLabel,
  isDeploymentInProgress,
  listAutomlDeployments,
} from "../../lib/automl-device-api";
import { listAutomlAlgorithmMarketListings } from "../../lib/automl-data-api";

type ConnectionState = "checking" | "online" | "offline";
type ServicesView = "running" | "records";

// 心跳 30s 一次，运行中列表按同节奏静默刷新在线状态
const REFRESH_INTERVAL_MS = 30_000;
const RECORDS_PAGE_LIMIT = 20;
const RUNNING_PAGE_LIMIT = 50;

const recordStatusFilters: Array<{ value: string; label: string }> = [
  { value: "", label: "全部状态" },
  { value: "ACTIVE", label: "已激活" },
  { value: "FAILED", label: "失败" },
  { value: "ISSUED", label: "已下发" },
  { value: "DOWNLOADING", label: "下载中" },
  { value: "VALIDATING", label: "校验中" },
  { value: "HEALTH_CHECKING", label: "健康检查中" },
  { value: "ROLLED_BACK", label: "已回滚" },
  { value: "CANCELLED", label: "已取消" },
];

// 进行中的部署用蓝色系，终态绿/红/灰
function deploymentTone(status: AutomlDeploymentStatus): "run" | "ok" | "bad" | "idle" {
  if (isDeploymentInProgress(status)) return "run";
  if (status === "ACTIVE") return "ok";
  if (status === "FAILED" || status === "ROLLED_BACK") return "bad";
  return "idle";
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function serviceAddress(deployment: AutomlDeviceDeployment): string {
  const info = deployment.serviceInfo;
  if (!info) return "—";
  const port = info.port != null ? `:${info.port}` : "";
  const runtime = info.runtime ?? "";
  const label = [runtime, port].filter(Boolean).join(" · ");
  return label || "—";
}

export function ServicesWorkbench() {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const view: ServicesView = requestedView === "records" ? "records" : "running";

  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [error, setError] = useState<string | null>(null);

  const [runningRows, setRunningRows] = useState<AutomlDeviceDeployment[] | null>(null);
  const [runningTotal, setRunningTotal] = useState(0);
  // 模型编码 → 市场条目 ID：运行服务跳「在线体验」（算法市场详情页）用
  const [marketModelIdByCode, setMarketModelIdByCode] = useState<Map<string, string>>(new Map());

  const [recordRows, setRecordRows] = useState<AutomlDeviceDeployment[] | null>(null);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(1);
  const [recordTotalPage, setRecordTotalPage] = useState(1);
  const [recordStatus, setRecordStatus] = useState("");

  const loadRunning = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setError(null);
    try {
      const result = await listAutomlDeployments({ page: 1, limit: RUNNING_PAGE_LIMIT, statusCd: "ACTIVE" });
      setConnection("online");
      setRunningRows(result.rows);
      setRunningTotal(Number(result.total) || 0);
      if (!options.silent) setError(null);
    } catch (reason) {
      setConnection("offline");
      setRunningRows((current) => current ?? []);
      if (!options.silent) {
        setError(reason instanceof Error ? reason.message : "运行服务列表加载失败");
      }
    }
  }, []);

  const loadRecords = useCallback(async (
    nextPage: number,
    nextStatus: string,
    options: { silent?: boolean } = {},
  ) => {
    if (!options.silent) setError(null);
    try {
      const result = await listAutomlDeployments({
        page: nextPage,
        limit: RECORDS_PAGE_LIMIT,
        statusCd: nextStatus || undefined,
      });
      setConnection("online");
      setRecordRows(result.rows);
      setRecordTotal(Number(result.total) || 0);
      setRecordTotalPage(Math.max(1, Number(result.totalPage) || 1));
      setRecordPage(Number(result.current) || nextPage);
      if (!options.silent) setError(null);
    } catch (reason) {
      setConnection("offline");
      setRecordRows((current) => current ?? []);
      if (!options.silent) {
        setError(reason instanceof Error ? reason.message : "部署记录加载失败");
      }
    }
  }, []);

  useEffect(() => {
    if (view === "running") void loadRunning();
    else void loadRecords(1, recordStatus);
    // 市场映射拉一次即可（下架/新增由刷新按钮兜底）
    void listAutomlAlgorithmMarketListings()
      .then((entries) => {
        setMarketModelIdByCode(new Map(entries.map((entry) => [entry.modelCode, String(entry.modelId)])));
      })
      .catch(() => {
        // 市场不可用只影响「在线体验」入口，列表照常展示
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (view === "running") void loadRunning({ silent: true });
      else void loadRecords(recordPage, recordStatus, { silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadRecords, loadRunning, recordPage, recordStatus, view]);

  function switchView(next: ServicesView) {
    try {
      window.history.replaceState(null, "", next === "records" ? "/services?view=records" : "/services");
    } catch {
      // 地址栏同步失败只影响刷新恢复
    }
  }

  const showLoadingState = connection === "checking";
  // 离线且没有缓存数据时给连接引导；离线但有旧数据就照常展示（等下一轮刷新）
  const runningEmpty = runningRows != null && runningRows.length === 0;
  const recordsEmpty = recordRows != null && recordRows.length === 0;

  return (
    <main className="services-main">
      <div className="services-header">
        <div>
          <span className="eyebrow">部署 · 运行服务</span>
          <h1>运行服务</h1>
          <p>查看各边缘设备上正在运行的推理服务与部署记录；部署入口在设备详情的「部署模型」。</p>
        </div>
      </div>

      {error ? (
        <div className="workbench-message error-message services-message" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      ) : null}

      <div className="services-view-tabs" aria-label="部署视图" role="tablist">
        <Link
          className={view === "running" ? "is-active" : ""}
          href="/services"
          role="tab"
          aria-selected={view === "running"}
          onClick={() => switchView("running")}
        >
          <ScanSearch size={14} aria-hidden="true" />运行中
        </Link>
        <Link
          className={view === "records" ? "is-active" : ""}
          href="/services?view=records"
          role="tab"
          aria-selected={view === "records"}
          onClick={() => switchView("records")}
        >
          <ServerCog size={14} aria-hidden="true" />部署记录
        </Link>
      </div>

      {showLoadingState ? (
        <article className="panel workbench-loading" aria-live="polite">
          <LoaderCircle size={20} className="spinner" />
          <span>正在读取部署…</span>
        </article>
      ) : view === "running" ? (
        runningRows?.length ? (
          <>
            <div className="services-toolbar">
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => void loadRunning()}
              >
                <RefreshCw size={13} aria-hidden="true" />
                刷新
              </button>
              <span className="services-count">共 {runningTotal} 个运行中的服务</span>
            </div>
            <article className="panel service-table">
              <div className="service-grid service-grid-head" aria-hidden="true">
                <span>运行模型</span>
                <span>设备</span>
                <span>在线状态</span>
                <span>推理服务</span>
                <span>激活时间</span>
                <span className="service-actions-head">操作</span>
              </div>
              {runningRows.map((deployment) => {
                const classes = deployment.serviceInfo?.classes ?? [];
                const marketModelId = deployment.serviceInfo?.modelCode
                  ? marketModelIdByCode.get(deployment.serviceInfo.modelCode)
                  : undefined;
                return (
                  <div className="service-grid service-row" key={String(deployment.deploymentId)}>
                    <div className="service-identity">
                      <Link
                        className="service-model-name service-model-link"
                        href={`/services/${encodeURIComponent(String(deployment.deploymentId))}`}
                        title={`${deployment.modelName ?? "模型"} · 查看运行服务详情`}
                      >
                        {deployment.modelName || "—"}
                        {deployment.modelVersion ? <small> {deployment.modelVersion}</small> : null}
                      </Link>
                      <small
                        className="service-model-classes"
                        title={classes.length ? `识别类别：${classes.join("、")}` : undefined}
                      >
                        {classes.length
                          ? `识别类别：${classes.slice(0, 4).join("、")}${classes.length > 4 ? ` 等 ${classes.length} 类` : ""}`
                          : deployment.serviceInfo?.modelCode ?? "—"}
                      </small>
                    </div>
                    <div className="service-identity">
                      <a
                        className="service-device-link"
                        href={`/devices?device=${encodeURIComponent(String(deployment.deviceId))}`}
                        title={`${deployment.deviceName ?? deployment.deviceId} · 查看设备详情`}
                      >
                        {deployment.deviceName || `设备 ${deployment.deviceId}`}
                      </a>
                      <small>{deployment.deploymentCode}</small>
                    </div>
                    <span
                      className="device-status-chip"
                      data-status={deployment.deviceStatusCd ?? "OFFLINE"}
                    >
                      {deployment.deviceStatusCd === "ONLINE"
                        ? "在线"
                        : deployment.deviceStatusCd === "DISABLED"
                          ? "已禁用"
                          : "离线"}
                    </span>
                    <span className="service-cell" title={deployment.serviceInfo?.baseUrl ?? undefined}>
                      {serviceAddress(deployment)}
                    </span>
                    <span className="service-cell">{formatTime(deployment.activatedAt)}</span>
                    <div className="service-actions">
                      {marketModelId ? (
                        <a
                          className="secondary-button compact"
                          href={`/marketplace/automl-${marketModelId}`}
                          title="打开算法详情页的在线体验（设备激活该模型时可真实识别）"
                        >
                          在线体验
                        </a>
                      ) : null}
                      <a
                        className="secondary-button compact"
                        href={`/devices?device=${encodeURIComponent(String(deployment.deviceId))}`}
                      >
                        设备详情
                      </a>
                    </div>
                  </div>
                );
              })}
            </article>
            {runningTotal > RUNNING_PAGE_LIMIT ? (
              <p className="service-hint">仅显示前 {RUNNING_PAGE_LIMIT} 条，更多设备请到设备页查看。</p>
            ) : null}
          </>
        ) : runningEmpty && connection === "offline" ? (
          <article className="panel workbench-empty-state">
            <span className="empty-state-icon"><AlertCircle size={20} /></span>
            <span className="eyebrow">运行服务</span>
            <h2>部署服务尚未连接</h2>
            <p>启动 sz-boot 后端（9992 端口）后，这里会显示设备上正在运行的推理服务。</p>
            <button className="primary-button" type="button" onClick={() => void loadRunning()}>
              <RefreshCw size={14} aria-hidden="true" />
              重新连接
            </button>
          </article>
        ) : runningEmpty ? (
          <article className="panel workbench-empty-state">
            <span className="empty-state-icon"><Cpu size={20} /></span>
            <span className="eyebrow">运行服务</span>
            <h2>还没有设备在运行模型</h2>
            <p>到设备详情选择模型下发部署，端侧会自动安装并拉起推理服务，成功后出现在这里。</p>
            <a className="primary-button" href="/devices">
              <Rocket size={14} aria-hidden="true" />
              去设备页部署
            </a>
          </article>
        ) : null
      ) : recordRows?.length ? (
        <>
          <div className="services-toolbar">
            <select
              className="asset-filter-select"
              value={recordStatus}
              onChange={(event) => {
                setRecordStatus(event.target.value);
                void loadRecords(1, event.target.value);
              }}
              aria-label="按部署状态筛选"
            >
              {recordStatusFilters.map((item) => (
                <option value={item.value} key={item.value || "all"}>{item.label}</option>
              ))}
            </select>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => void loadRecords(recordPage, recordStatus)}
            >
              <RefreshCw size={13} aria-hidden="true" />
              刷新
            </button>
            <span className="services-count">共 {recordTotal} 条部署记录</span>
          </div>
          <article className="panel service-table">
            <div className="record-grid record-grid-head" aria-hidden="true">
              <span>部署任务</span>
              <span>设备</span>
              <span>模型</span>
              <span>状态</span>
              <span>下发 / 激活</span>
              <span>备注</span>
            </div>
            {recordRows.map((deployment) => (
              <div className="record-grid record-row" key={String(deployment.deploymentId)}>
                <div className="service-identity">
                  <a
                    className="service-device-link"
                    href={`/devices?device=${encodeURIComponent(String(deployment.deviceId))}`}
                    title="查看设备部署历史"
                  >
                    {deployment.deploymentCode}
                  </a>
                  <small>ID {String(deployment.deploymentId)}</small>
                </div>
                <span className="service-cell">{deployment.deviceName || `设备 ${deployment.deviceId}`}</span>
                <span className="service-cell">
                  {deployment.modelName || "—"}
                  {deployment.modelVersion ? <small> {deployment.modelVersion}</small> : null}
                </span>
                <span className="deploy-chip" data-tone={deploymentTone(deployment.statusCd)}>
                  {deploymentStatusLabel[deployment.statusCd] ?? deployment.statusCd}
                </span>
                <span className="service-cell">
                  {formatTime(deployment.issuedAt)}
                  {deployment.activatedAt ? <small> → {formatTime(deployment.activatedAt)}</small> : null}
                </span>
                <span className="service-cell service-error" title={deployment.errorMessage || undefined}>
                  {deployment.errorMessage || "—"}
                </span>
              </div>
            ))}
          </article>
          {recordTotalPage > 1 ? (
            <div className="devices-pagination">
              <button
                className="secondary-button compact"
                type="button"
                disabled={recordPage <= 1}
                onClick={() => void loadRecords(recordPage - 1, recordStatus)}
                aria-label="上一页"
              >
                <ChevronLeft size={13} aria-hidden="true" />
              </button>
              <span>第 {recordPage} / {recordTotalPage} 页</span>
              <button
                className="secondary-button compact"
                type="button"
                disabled={recordPage >= recordTotalPage}
                onClick={() => void loadRecords(recordPage + 1, recordStatus)}
                aria-label="下一页"
              >
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </>
      ) : recordsEmpty && connection === "offline" ? (
        <article className="panel workbench-empty-state">
          <span className="empty-state-icon"><AlertCircle size={20} /></span>
          <span className="eyebrow">部署记录</span>
          <h2>部署服务尚未连接</h2>
          <p>启动 sz-boot 后端（9992 端口）后，这里会显示所有部署任务。</p>
          <button className="primary-button" type="button" onClick={() => void loadRecords(1, recordStatus)}>
            <RefreshCw size={14} aria-hidden="true" />
            重新连接
          </button>
        </article>
      ) : recordsEmpty ? (
        <article className="panel workbench-empty-state">
          <span className="empty-state-icon"><ServerCog size={20} /></span>
          <span className="eyebrow">部署记录</span>
          <h2>还没有部署任务</h2>
          <p>在设备详情点「部署模型」下发部署后，任务会记录在这里。</p>
          <a className="primary-button" href="/devices">
            <Rocket size={14} aria-hidden="true" />
            去设备页部署
          </a>
        </article>
      ) : null}
    </main>
  );
}
