"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  HardDrive,
  LoaderCircle,
  MemoryStick,
  MonitorSmartphone,
  RefreshCw,
  Rocket,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AutomlDevice,
  type AutomlDeviceDeployment,
  createAutomlDeviceDeployment,
  deleteAutomlDevice,
  deploymentStatusLabel,
  deviceStatusLabel,
  getAutomlDevice,
  getAutomlDeviceDeployment,
  isDeploymentInProgress,
  listAutomlDeviceDeployments,
  listAutomlDevices,
  setAutomlDeviceStatus,
} from "../../lib/automl-device-api";
import {
  type AutomlDataset,
  type AutomlDatasetModel,
  type AutomlId,
  listAutomlDatasetModels,
  listAutomlDatasets,
} from "../../lib/automl-data-api";

type ConnectionState = "checking" | "online" | "offline";

// 心跳默认 30s 一次，列表按同节奏静默刷新在线状态
const DEVICE_REFRESH_INTERVAL_MS = 30_000;
const DEPLOY_POLL_INTERVAL_MS = 3_000;
const PAGE_LIMIT = 20;

const deviceTypeLabels: Record<string, string> = {
  MAC: "Mac",
  NVIDIA: "NVIDIA",
};

const accessModeLabels: Record<string, string> = {
  DIRECT_HTTP: "直连",
  EDGE_PULL: "边缘拉取",
};

const serviceStatusLabels: Record<string, string> = {
  RUNNING: "运行中",
  STOPPED: "已停止",
};

const terminalDeploymentNotices: Record<string, string> = {
  ACTIVE: "模型部署完成，设备已切换到新模型",
  FAILED: "模型部署失败，设备保留原模型继续服务",
  ROLLED_BACK: "模型部署已回滚",
  CANCELLED: "模型部署任务已取消",
};

function formatTime(value: string | null): string {
  return value ?? "—";
}

function formatMb(mb: number | null | undefined): string {
  if (mb == null || Number.isNaN(Number(mb))) return "—";
  const value = Number(mb);
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}

function formatUptime(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(Number(sec))) return "—";
  const total = Math.max(0, Math.floor(Number(sec)));
  if (total < 60) return `${total} 秒`;
  if (total < 3600) return `${Math.floor(total / 60)} 分钟`;
  if (total < 86400) return `${Math.floor(total / 3600)} 小时 ${Math.floor((total % 3600) / 60)} 分`;
  return `${Math.floor(total / 86400)} 天 ${Math.floor((total % 86400) / 3600)} 小时`;
}

function formatJsonBlock(value: unknown): string {
  if (value == null || (typeof value === "object" && Object.keys(value).length === 0)) {
    return "暂无数据";
  }
  return JSON.stringify(value, null, 2);
}

type PendingDeviceAction = {
  kind: "enable" | "disable" | "delete";
  device: AutomlDevice;
};

const pendingActionCopy: Record<PendingDeviceAction["kind"], { title: string; confirm: string; detail: string }> = {
  enable: {
    title: "启用设备",
    confirm: "启用设备",
    detail: "解禁后设备状态为离线，端侧下一次心跳成功后自动恢复在线。",
  },
  disable: {
    title: "禁用设备",
    confirm: "禁用设备",
    detail: "禁用后设备注册与心跳都会被拒绝，重新启用前无法参与部署。",
  },
  delete: {
    title: "删除设备",
    confirm: "删除设备",
    detail: "删除后设备令牌随之失效；同一设备再次注册会按新设备重建。",
  },
};

export function DevicesWorkbench() {
  const searchParams = useSearchParams();
  const requestedDeviceId = searchParams.get("device");

  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [devices, setDevices] = useState<AutomlDevice[] | null>(null);
  const [total, setTotal] = useState<AutomlId | null>(null);
  const [totalPage, setTotalPage] = useState(1);
  const [page, setPage] = useState(1);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 详情不再是弹框：选中设备后整页渲染设备信息
  const [detail, setDetail] = useState<AutomlDevice | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingDeviceAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [deployOpen, setDeployOpen] = useState(false);
  const [deployTarget, setDeployTarget] = useState<AutomlDevice | null>(null);
  const [deployDatasets, setDeployDatasets] = useState<AutomlDataset[] | null>(null);
  const [deployDatasetId, setDeployDatasetId] = useState("");
  const [deployModels, setDeployModels] = useState<AutomlDatasetModel[] | null>(null);
  const [deployModelsLoading, setDeployModelsLoading] = useState(false);
  const [deployModelVersionId, setDeployModelVersionId] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<AutomlDeviceDeployment | null>(null);

  const loadDevices = useCallback(async (
    nextPage: number,
    nextKeyword: string,
    nextStatus: string,
    options: { silent?: boolean } = {},
  ) => {
    if (!options.silent) setLoading(true);
    try {
      const result = await listAutomlDevices({
        page: nextPage,
        limit: PAGE_LIMIT,
        keyword: nextKeyword.trim() || undefined,
        statusCd: nextStatus || undefined,
      });
      setConnection("online");
      setDevices(result.rows);
      setTotal(result.total);
      setTotalPage(Math.max(1, Number(result.totalPage) || 1));
      setPage(Number(result.current) || nextPage);
      if (!options.silent) setError(null);
    } catch (reason) {
      setConnection("offline");
      setDevices((current) => current ?? []);
      if (!options.silent) {
        setError(reason instanceof Error ? reason.message : "设备列表加载失败");
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  const refreshDevices = useCallback(() => {
    void loadDevices(page, keyword, statusFilter);
  }, [keyword, loadDevices, page, statusFilter]);

  const openDetail = useCallback((device: AutomlDevice) => {
    setDetail(device);
    // URL 记住选中设备，刷新后仍落在详情视图
    try {
      window.history.replaceState(null, "", `/devices?device=${encodeURIComponent(String(device.deviceId))}`);
    } catch {
      // 地址栏同步失败只影响刷新恢复
    }
    // 行内数据先展示，后台拉详情补齐心跳快照
    void (async () => {
      try {
        setDetail(await getAutomlDevice(device.deviceId));
      } catch {
        // 拉取失败时保留行内数据展示
      }
    })();
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
    try {
      window.history.replaceState(null, "", "/devices");
    } catch {
      // 忽略
    }
  }, []);

  useEffect(() => {
    void loadDevices(1, "", "");
    // 侧栏/详情链接带入 ?device= 时直接进入详情视图
    if (!requestedDeviceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const deviceDetail = await getAutomlDevice(requestedDeviceId);
        if (!cancelled) setDetail(deviceDetail);
      } catch {
        // ID 已失效时静默忽略，保留列表视图
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // 详情打开时刷详情（资源/服务随心跳更新），否则刷列表
      if (detail) {
        void (async () => {
          try {
            setDetail(await getAutomlDevice(detail.deviceId));
          } catch {
            // 单次刷新失败等下一轮
          }
        })();
      } else {
        void loadDevices(page, keyword, statusFilter, { silent: true });
      }
    }, DEVICE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [detail, keyword, loadDevices, page, statusFilter]);

  const submitKeyword = useCallback(() => {
    setKeyword(keywordDraft);
    void loadDevices(1, keywordDraft, statusFilter);
  }, [keywordDraft, loadDevices, statusFilter]);

  const changeStatusFilter = useCallback((value: string) => {
    setStatusFilter(value);
    void loadDevices(1, keyword, value);
  }, [keyword, loadDevices]);

  const changePage = useCallback((nextPage: number) => {
    void loadDevices(nextPage, keyword, statusFilter);
  }, [keyword, loadDevices, statusFilter]);

  const confirmPendingAction = useCallback(async () => {
    const action = pendingAction;
    if (!action) return;
    setActionBusy(true);
    setError(null);
    try {
      if (action.kind === "delete") {
        await deleteAutomlDevice(action.device.deviceId);
        setNotice(`设备「${action.device.name}」已删除`);
        if (detail && String(detail.deviceId) === String(action.device.deviceId)) {
          closeDetail();
        }
      } else {
        await setAutomlDeviceStatus(action.device.deviceId, action.kind === "disable" ? "DISABLED" : "ENABLED");
        setNotice(action.kind === "disable"
          ? `设备「${action.device.name}」已禁用`
          : `设备「${action.device.name}」已启用，等待下一次心跳恢复在线`);
        if (detail && String(detail.deviceId) === String(action.device.deviceId)) {
          setDetail(await getAutomlDevice(detail.deviceId));
        }
      }
      setPendingAction(null);
      await loadDevices(page, keyword, statusFilter, { silent: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试");
    } finally {
      setActionBusy(false);
    }
  }, [closeDetail, detail, keyword, loadDevices, page, pendingAction, statusFilter]);

  const openDeploy = useCallback(async (device: AutomlDevice) => {
    setDeployTarget(device);
    setDeployOpen(true);
    setDeployError(null);
    setDeployment(null);
    setDeployDatasetId("");
    setDeployModels(null);
    setDeployModelVersionId("");
    setDeployDatasets(null);
    try {
      const datasetsPage = await listAutomlDatasets({ page: 1, limit: 50 });
      setDeployDatasets(datasetsPage.rows);
    } catch (reason) {
      setDeployError(reason instanceof Error ? reason.message : "数据集列表加载失败");
    }
  }, []);

  const selectDeployDataset = useCallback(async (datasetId: string) => {
    setDeployDatasetId(datasetId);
    setDeployModelVersionId("");
    setDeployModels(null);
    setDeployError(null);
    if (!datasetId) return;
    try {
      setDeployModelsLoading(true);
      setDeployModels(await listAutomlDatasetModels(datasetId));
    } catch (reason) {
      setDeployError(reason instanceof Error ? reason.message : "模型列表加载失败");
    } finally {
      setDeployModelsLoading(false);
    }
  }, []);

  const submitDeploy = useCallback(async () => {
    const device = deployTarget;
    if (!device || !deployModelVersionId) return;
    setDeployError(null);
    setDeploying(true);
    try {
      const created = await createAutomlDeviceDeployment(device.deviceId, deployModelVersionId);
      setDeployment(created);
    } catch (reason) {
      setDeployError(reason instanceof Error ? reason.message : "部署任务创建失败");
    } finally {
      setDeploying(false);
    }
  }, [deployModelVersionId, deployTarget]);

  // 部署任务进行中时轮询 §6.8 详情，终态后刷新设备（ACTIVE 会更新 currentModel）
  useEffect(() => {
    if (!deployment || !isDeploymentInProgress(deployment.statusCd)) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const latest = await getAutomlDeviceDeployment(deployment.deploymentId);
          setDeployment(latest);
          if (!isDeploymentInProgress(latest.statusCd)) {
            setNotice(terminalDeploymentNotices[latest.statusCd] ?? `部署任务结束：${latest.statusCd}`);
            if (detail) {
              setDetail(await getAutomlDevice(detail.deviceId));
            }
            void loadDevices(page, keyword, statusFilter, { silent: true });
          }
        } catch {
          // 单次轮询失败等下一轮重试
        }
      })();
    }, DEPLOY_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [deployment, detail, keyword, loadDevices, page, statusFilter]);

  function closeDeploy() {
    setDeployOpen(false);
    setDeployTarget(null);
    setDeployment(null);
    setDeployError(null);
  }

  const showOfflineState = connection === "offline" && !devices?.length;
  const showLoadingState = connection === "checking" && !devices?.length;
  const showEmptyState = connection === "online" && !!devices && devices.length === 0;

  return (
    <section className="devices-page">
      {detail ? (
        <div className="devices-header">
          <div>
            <button className="device-back-link" type="button" onClick={closeDetail}>
              <ArrowLeft size={13} aria-hidden="true" />
              设备 / 边缘设备
            </button>
            <h1>{detail.name}</h1>
            <p className="device-header-meta">
              <span className="device-status-chip" data-status={detail.statusCd}>
                {deviceStatusLabel[detail.statusCd] ?? detail.statusCd}
              </span>
              <span>{detail.deviceCode} · ID {String(detail.deviceId)} · {deviceTypeLabels[detail.deviceType] ?? detail.deviceType} · {accessModeLabels[detail.accessMode] ?? detail.accessMode}</span>
            </p>
          </div>
          <div className="devices-header-actions">
            {detail.statusCd === "DISABLED" ? (
              <button
                className="secondary-button"
                type="button"
                disabled={actionBusy}
                onClick={() => setPendingAction({ kind: "enable", device: detail })}
              >
                启用设备
              </button>
            ) : (
              <button
                className="secondary-button"
                type="button"
                disabled={actionBusy}
                onClick={() => setPendingAction({ kind: "disable", device: detail })}
              >
                禁用设备
              </button>
            )}
            <button
              className="primary-button"
              type="button"
              disabled={detail.statusCd === "DISABLED"}
              onClick={() => void openDeploy(detail)}
            >
              <Rocket size={14} />
              部署模型
            </button>
            <button
              className="secondary-button device-delete-button"
              type="button"
              onClick={() => setPendingAction({ kind: "delete", device: detail })}
            >
              删除
            </button>
          </div>
        </div>
      ) : (
        <div className="devices-header">
          <div>
            <span className="eyebrow">设备 · 边缘设备</span>
            <h1>边缘设备</h1>
            <p>查看已纳管的边缘设备与在线状态，禁用异常设备并下发模型部署任务。</p>
          </div>
        </div>
      )}

      {error ? (
        <div className="workbench-message error-message" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      ) : null}
      {notice ? (
        <div className="workbench-message notice-message" role="status">
          <Check size={14} aria-hidden="true" />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>关闭</button>
        </div>
      ) : null}

      {detail ? (
        <DeviceDetailView device={detail} />
      ) : showOfflineState ? (
        <article className="panel workbench-empty-state">
          <span className="empty-state-icon"><AlertCircle size={20} /></span>
          <span className="eyebrow">边缘设备</span>
          <h2>设备服务尚未连接</h2>
          <p>启动 sz-boot 后端（9992 端口）后，这里会显示端侧服务自注册的设备。</p>
          <button className="primary-button" type="button" onClick={refreshDevices}>
            <RefreshCw size={14} />
            重新连接
          </button>
        </article>
      ) : showLoadingState ? (
        <article className="panel workbench-loading" aria-live="polite">
          <LoaderCircle size={20} className="spinner" />
          <span>正在读取设备…</span>
        </article>
      ) : showEmptyState ? (
        <article className="panel workbench-empty-state">
          <span className="empty-state-icon"><Cpu size={20} /></span>
          <span className="eyebrow">边缘设备</span>
          <h2>暂无已注册设备</h2>
          <p>设备由端侧服务自注册：在设备上启动 edge/edge-service 后，它会自动出现在这里，无需手工创建。</p>
          <button className="secondary-button" type="button" onClick={refreshDevices}>
            <RefreshCw size={14} />
            刷新
          </button>
        </article>
      ) : (
        <>
          <div className="devices-toolbar">
            <div className="devices-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={keywordDraft}
                onChange={(event) => setKeywordDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitKeyword();
                }}
                placeholder="搜索设备名称 / 编码 / 指纹"
                aria-label="搜索设备"
              />
              {keywordDraft ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => {
                    setKeywordDraft("");
                    setKeyword("");
                    void loadDevices(1, "", statusFilter);
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <select
              className="asset-filter-select"
              value={statusFilter}
              onChange={(event) => changeStatusFilter(event.target.value)}
              aria-label="按状态筛选"
            >
              <option value="">全部状态</option>
              <option value="ONLINE">在线</option>
              <option value="OFFLINE">离线</option>
              <option value="DISABLED">已禁用</option>
            </select>
            <button className="secondary-button compact" type="button" onClick={refreshDevices} disabled={loading}>
              {loading ? <LoaderCircle size={13} className="spinner" /> : <RefreshCw size={13} />}
              刷新
            </button>
            <span className="devices-count">共 {total == null ? "—" : Number(total)} 台设备</span>
          </div>

          <article className="panel device-table">
            <div className="device-table-head" aria-hidden="true">
              <span>设备</span>
              <span>状态</span>
              <span>类型</span>
              <span>当前模型</span>
              <span>Agent</span>
              <span>最近心跳</span>
              <span className="device-actions-head">操作</span>
            </div>
            {devices?.map((device) => (
              <div className="device-row" key={String(device.deviceId)}>
                <div className="device-name">
                  <button
                    type="button"
                    className="device-name-link"
                    title={`${device.name} · 查看详情`}
                    onClick={() => openDetail(device)}
                  >
                    {device.name}
                  </button>
                  <small title={device.deviceCode}>{device.deviceCode}</small>
                </div>
                <span className="device-status-chip" data-status={device.statusCd}>
                  {deviceStatusLabel[device.statusCd] ?? device.statusCd}
                </span>
                <span className="device-cell">
                  {deviceTypeLabels[device.deviceType] ?? device.deviceType} · {accessModeLabels[device.accessMode] ?? device.accessMode}
                </span>
                <span className="device-cell" title={device.currentModel ?? undefined}>{device.currentModel ?? "—"}</span>
                <span className="device-cell">{device.agentVersion ?? "—"}</span>
                <span className="device-cell">{formatTime(device.lastOnlineAt)}</span>
                <div className="device-actions">
                  <button className="secondary-button compact" type="button" onClick={() => openDetail(device)}>
                    详情
                  </button>
                  {device.statusCd === "DISABLED" ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => setPendingAction({ kind: "enable", device })}
                    >
                      启用
                    </button>
                  ) : (
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => setPendingAction({ kind: "disable", device })}
                    >
                      禁用
                    </button>
                  )}
                  <button
                    className="secondary-button compact device-delete-button"
                    type="button"
                    onClick={() => setPendingAction({ kind: "delete", device })}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </article>

          {totalPage > 1 ? (
            <div className="devices-pagination">
              <button
                className="secondary-button compact"
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => changePage(page - 1)}
                aria-label="上一页"
              >
                <ChevronLeft size={13} />
              </button>
              <span>第 {page} / {totalPage} 页</span>
              <button
                className="secondary-button compact"
                type="button"
                disabled={page >= totalPage || loading}
                onClick={() => changePage(page + 1)}
                aria-label="下一页"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          ) : null}
        </>
      )}

      {deployOpen && deployTarget ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog device-deploy-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-deploy-title"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Rocket size={18} /></span>
                <span>
                  <h2 id="device-deploy-title">部署模型 · {deployTarget.name}</h2>
                  <p>选择数据集及其关联的模型版本，创建部署任务后由端侧自动拉取安装。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" onClick={closeDeploy}>×</button>
            </div>

            {deployment ? (
              <div className="device-deployment-result" aria-live="polite">
                <div className="device-status-line">
                  <span className="device-deployment-chip" data-state={isDeploymentInProgress(deployment.statusCd) ? "running" : deployment.statusCd}>
                    {isDeploymentInProgress(deployment.statusCd) ? <LoaderCircle size={12} className="spinner" /> : null}
                    {deploymentStatusLabel[deployment.statusCd] ?? deployment.statusCd}
                  </span>
                  <span className="device-cell">任务 {deployment.deploymentCode}</span>
                </div>
                <dl className="device-detail-grid">
                  <div className="device-detail-item">
                    <dt>模型版本 ID</dt>
                    <dd>{String(deployment.modelVersionId)}</dd>
                  </div>
                  <div className="device-detail-item">
                    <dt>下发时间</dt>
                    <dd>{formatTime(deployment.issuedAt)}</dd>
                  </div>
                  <div className="device-detail-item">
                    <dt>激活时间</dt>
                    <dd>{formatTime(deployment.activatedAt)}</dd>
                  </div>
                  <div className="device-detail-item">
                    <dt>结束时间</dt>
                    <dd>{formatTime(deployment.finishedAt)}</dd>
                  </div>
                </dl>
                {deployment.errorMessage ? (
                  <p className="device-detail-hint is-error" role="alert">{deployment.errorMessage}</p>
                ) : null}
                {isDeploymentInProgress(deployment.statusCd) ? (
                  <p className="device-detail-hint">端侧设备将在下一次心跳收到指令并自动下载安装，可保持窗口打开查看进度。</p>
                ) : null}
                <div className="dialog-actions">
                  <button className="primary-button" type="button" onClick={closeDeploy}>完成</button>
                </div>
              </div>
            ) : (
              <>
                <label className="device-dialog-field">
                  <span>数据集</span>
                  <select
                    className="device-dialog-select"
                    value={deployDatasetId}
                    onChange={(event) => void selectDeployDataset(event.target.value)}
                  >
                    <option value="">{deployDatasets ? "请选择数据集" : "正在加载数据集…"}</option>
                    {deployDatasets?.map((dataset) => (
                      <option value={String(dataset.id)} key={String(dataset.id)}>{dataset.name}</option>
                    ))}
                  </select>
                </label>
                <label className="device-dialog-field">
                  <span>模型版本</span>
                  <select
                    className="device-dialog-select"
                    value={deployModelVersionId}
                    onChange={(event) => setDeployModelVersionId(event.target.value)}
                    disabled={!deployDatasetId || deployModelsLoading}
                  >
                    <option value="">
                      {deployModelsLoading ? "正在加载模型…" : deployModels?.length ? "请选择模型版本" : "该数据集暂无关联模型"}
                    </option>
                    {deployModels?.map((model) => (
                      <option value={String(model.modelVersionId)} key={String(model.modelVersionId)}>
                        {model.modelName} v{model.modelVersion}
                      </option>
                    ))}
                  </select>
                </label>
                {deployError ? <p className="device-detail-hint is-error" role="alert">{deployError}</p> : null}
                <div className="dialog-actions">
                  <button className="secondary-button" type="button" onClick={closeDeploy}>取消</button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!deployModelVersionId || deploying}
                    onClick={() => void submitDeploy()}
                  >
                    {deploying ? <LoaderCircle size={14} className="spinner" /> : <Rocket size={14} />}
                    {deploying ? "正在创建任务" : "开始部署"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog resource-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-action-title"
            aria-describedby="device-action-detail"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><AlertCircle size={18} /></span>
                <span>
                  <h2 id="device-action-title">{pendingActionCopy[pendingAction.kind].title}</h2>
                  <p>确定要处理「{pendingAction.device.name}」吗？</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={actionBusy} onClick={() => setPendingAction(null)}>×</button>
            </div>
            <p className="resource-action-detail" id="device-action-detail">
              {pendingActionCopy[pendingAction.kind].detail}
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={actionBusy} onClick={() => setPendingAction(null)}>
                取消
              </button>
              <button
                className={`primary-button${pendingAction.kind === "delete" ? " device-confirm-danger" : ""}`}
                type="button"
                disabled={actionBusy}
                onClick={() => void confirmPendingAction()}
              >
                {actionBusy ? "正在处理" : pendingActionCopy[pendingAction.kind].confirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function DeviceDetailView({ device }: { device: AutomlDevice }) {
  const resources = device.lastStateJson?.resources ?? null;
  const services = device.lastStateJson?.services ?? [];
  const gpu = resources?.gpu ?? null;
  // 设备部署历史：推理服务块（ACTIVE 部署的 serviceInfo）与跳转高亮的数据源
  const [deployments, setDeployments] = useState<AutomlDeviceDeployment[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listAutomlDeviceDeployments(device.deviceId);
        if (!cancelled) setDeployments(list);
      } catch {
        // 部署历史加载失败不阻塞详情页
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [device.deviceId]);

  const activeDeployment = deployments.find((deployment) => deployment.statusCd === "ACTIVE") ?? null;
  const serviceInfo = activeDeployment?.serviceInfo ?? null;

  // 点推理服务块 → 滚动并高亮来源部署的详情
  const focusDeployment = useCallback((deploymentId: string) => {
    setHighlightId(deploymentId);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  return (
    <>
      <article className="panel device-section">
        <h3 className="device-section-title">资源占用 <small>随心跳更新 · 上报于 {formatTime(device.lastOnlineAt)}</small></h3>
        {resources && (resources.memTotalMb != null || resources.diskFreeMb != null) ? (
          <div className="device-resource-grid">
            <div className="device-resource-card">
              <span className="device-resource-label"><MemoryStick size={13} aria-hidden="true" /> 内存可用</span>
              <strong>{formatMb(resources.memAvailableMb)}</strong>
              <small>共 {formatMb(resources.memTotalMb)} · 已用 {resources.memPercent ?? "—"}%</small>
            </div>
            <div className="device-resource-card">
              <span className="device-resource-label"><HardDrive size={13} aria-hidden="true" /> 磁盘可用</span>
              <strong>{formatMb(resources.diskFreeMb)}</strong>
              <small>模型盘剩余空间</small>
            </div>
            <div className="device-resource-card">
              <span className="device-resource-label"><Zap size={13} aria-hidden="true" /> 负载（1 分钟）</span>
              <strong>{resources.loadAvg1 ?? "—"}</strong>
              <small>系统平均负载</small>
            </div>
            {gpu ? (
              <div className="device-resource-card">
                <span className="device-resource-label"><MonitorSmartphone size={13} aria-hidden="true" /> 显存剩余</span>
                <strong>{formatMb(gpu.memFreeMb)}</strong>
                <small>{gpu.name ?? "GPU"} · 共 {formatMb(gpu.memTotalMb)} · 利用率 {gpu.utilPercent ?? "—"}%</small>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="device-detail-hint">暂无资源数据：设备离线或心跳版本较旧，等待下一次心跳上报。</p>
        )}
      </article>

      <article className="panel device-section">
        <h3 className="device-section-title">运行服务 <small>由边缘计算服务上报</small></h3>
        {services.length ? (
          <div className="device-service-table">
            <div className="device-service-head" aria-hidden="true">
              <span>服务</span>
              <span>状态</span>
              <span>版本</span>
              <span>端口</span>
              <span>进程</span>
              <span>已运行</span>
            </div>
            {services.map((service) => (
              <div className="device-service-row" key={service.name}>
                <span className="device-service-name">{service.name}</span>
                <span className="device-service-chip" data-status={service.status}>
                  {serviceStatusLabels[service.status] ?? service.status}
                </span>
                <span className="device-cell">{service.version ?? "—"}</span>
                <span className="device-cell">{service.port ?? "—"}</span>
                <span className="device-cell">{service.pid ?? "—"}</span>
                <span className="device-cell">{formatUptime(service.uptimeSec)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="device-detail-hint">暂无服务上报数据，等待下一次心跳。</p>
        )}
      </article>

      <article className="panel device-section">
        <h3 className="device-section-title">推理服务 <small>当前加载的模型与部署来源 · 点击跳转部署详情</small></h3>
        {serviceInfo ? (
          <button
            type="button"
            className="device-inference-card"
            onClick={() => focusDeployment(String(activeDeployment!.deploymentId))}
          >
            <span className="device-inference-main">
              <strong>{serviceInfo.modelCode ?? "—"} · {serviceInfo.modelVersion ?? "—"}</strong>
              <small>
                {serviceInfo.serviceName ?? "inference-service"} · 端口 {serviceInfo.port ?? "—"}
                {" · "}运行时 {serviceInfo.runtime ?? "ONNX"}
                {Array.isArray(serviceInfo.classes) && serviceInfo.classes.length
                  ? ` · ${serviceInfo.classes.length} 类（${serviceInfo.classes.slice(0, 4).join("、")}${serviceInfo.classes.length > 4 ? "…" : ""}）`
                  : ""}
              </small>
            </span>
            <span className="device-inference-meta">
              部署 {activeDeployment!.deploymentCode}
              {" · "}激活于 {formatTime(activeDeployment!.activatedAt)}
            </span>
          </button>
        ) : (
          <p className="device-detail-hint">暂无激活部署：设备上的推理服务未加载平台部署的模型。</p>
        )}
        {deployments.length ? (
          <div className="device-deployment-history" ref={historyRef}>
            <div className="device-deployment-history-title" aria-hidden="true">
              <span>部署任务</span><span>状态</span><span>模型版本</span><span>下发</span><span>激活</span>
            </div>
            {deployments.map((deployment) => (
              <div
                className={`device-deployment-history-row${highlightId === String(deployment.deploymentId) ? " is-highlight" : ""}`}
                key={String(deployment.deploymentId)}
              >
                <span className="device-deployment-history-code">{deployment.deploymentCode}</span>
                <span className="device-deployment-chip" data-state={isDeploymentInProgress(deployment.statusCd) ? "running" : deployment.statusCd}>
                  {isDeploymentInProgress(deployment.statusCd) ? <LoaderCircle size={11} className="spinner" /> : null}
                  {deploymentStatusLabel[deployment.statusCd] ?? deployment.statusCd}
                </span>
                <span className="device-cell">#{String(deployment.modelVersionId)}</span>
                <span className="device-cell">{formatTime(deployment.issuedAt)}</span>
                <span className="device-cell">{formatTime(deployment.activatedAt)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="device-detail-hint">暂无部署历史。</p>
        )}
      </article>

      <article className="panel device-section">
        <h3 className="device-section-title">基础信息</h3>
        <dl className="device-detail-grid">
          <div className="device-detail-item">
            <dt>设备编码</dt>
            <dd>{device.deviceCode}</dd>
          </div>
          <div className="device-detail-item">
            <dt>设备 ID</dt>
            <dd>{String(device.deviceId)}</dd>
          </div>
          <div className="device-detail-item">
            <dt>运行时</dt>
            <dd>{device.runtime}</dd>
          </div>
          <div className="device-detail-item">
            <dt>Agent 版本</dt>
            <dd>{device.agentVersion ?? "—"}</dd>
          </div>
          <div className="device-detail-item">
            <dt>当前模型</dt>
            <dd>{device.currentModel ?? "—"}</dd>
          </div>
          <div className="device-detail-item">
            <dt>注册时间</dt>
            <dd>{formatTime(device.createTime)}</dd>
          </div>
          <div className="device-detail-item">
            <dt>最近心跳</dt>
            <dd>{formatTime(device.lastOnlineAt)}</dd>
          </div>
          {device.endpoint ? (
            <div className="device-detail-item">
              <dt>推理服务地址</dt>
              <dd>{device.endpoint}</dd>
            </div>
          ) : null}
        </dl>
        {device.statusCd === "DISABLED" ? (
          <p className="device-detail-hint">设备已禁用：注册与心跳被拒绝，启用后才能接收部署任务。</p>
        ) : null}
      </article>

      <article className="panel device-section">
        <h3 className="device-section-title">静态能力</h3>
        <div className="device-kv-block">
          <pre>{formatJsonBlock(device.capabilityJson)}</pre>
        </div>
      </article>
    </>
  );
}
