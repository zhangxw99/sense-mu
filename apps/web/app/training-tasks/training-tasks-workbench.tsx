"use client";

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AutomlDevice,
  listAutomlDevices,
} from "../../lib/automl-device-api";
import {
  type AutomlDataset,
  type AutomlId,
  type AutomlVersionDetail,
  getAutomlDatasetVersionDetails,
  listAutomlDatasets,
} from "../../lib/automl-data-api";
import {
  type AutomlPlatformConfigProperty,
  type AutomlPlatformOption,
  listAutomlPlatformOptions,
} from "../../lib/automl-platform-api";
import {
  type AutomlReadiness,
  type AutomlTrainingTask,
  AUTOML_TRAINING_TASKS_CHANGED_EVENT,
  cancelAutomlTrainingTask,
  createAutomlTrainingTask,
  deleteAutomlTrainingTask,
  dispatchAutomlTrainingTask,
  getAutomlTaskReadiness,
  listAutomlTrainingTasks,
  trainingTaskStatusLabels,
} from "../../lib/automl-training-api";

const PAGE_LIMIT = 10;

const TASK_STATUS_FILTERS = [
  { value: "CREATED", label: "已创建" },
  { value: "QUEUED", label: "已下发" },
  { value: "SCHEDULED", label: "已调度" },
  { value: "RUNNING", label: "训练中" },
  { value: "SUCCEEDED", label: "已完成" },
  { value: "FAILED", label: "失败" },
  { value: "CANCELLED", label: "已取消" },
];

type WizardStep = 1 | 2 | 3;

type PendingAction =
  | { kind: "dispatch"; task: AutomlTrainingTask }
  | { kind: "cancel"; task: AutomlTrainingTask }
  | { kind: "delete"; task: AutomlTrainingTask }
  | null;

function formatProgress(progress: number): string {
  const value = Number(progress);
  return `${Number.isFinite(value) ? Math.round(value) : 0}%`;
}

function progressWidth(progress: number): string {
  const value = Number(progress);
  return `${Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))}%`;
}

function formatNumberPair(current: number, total: number): string {
  const currentText = Number.isFinite(Number(current)) ? String(current) : "—";
  const totalText = Number.isFinite(Number(total)) && total > 0 ? String(total) : "—";
  return `${currentText} / ${totalText}`;
}

function describePropertyValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function statusText(statusCd: string): string {
  return trainingTaskStatusLabels[statusCd] ?? statusCd;
}

export function TrainingTasksWorkbench() {
  const [tasks, setTasks] = useState<AutomlTrainingTask[]>([]);
  const [total, setTotal] = useState<AutomlId | null>(null);
  const [totalPage, setTotalPage] = useState(1);
  const [page, setPage] = useState(1);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 新建任务向导
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [datasets, setDatasets] = useState<AutomlDataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [versionDetail, setVersionDetail] = useState<AutomlVersionDetail | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [readiness, setReadiness] = useState<AutomlReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [platformOptions, setPlatformOptions] = useState<AutomlPlatformOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionPlatformId, setOptionPlatformId] = useState("");
  const [baseModelId, setBaseModelId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [hyperParams, setHyperParams] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  // 下发 / 取消
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [onlineDevices, setOnlineDevices] = useState<AutomlDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadTasks = useCallback(async (
    nextPage: number,
    nextKeyword: string,
    nextStatus: string,
    options: { silent?: boolean } = {},
  ) => {
    if (!options.silent) setLoading(true);
    try {
      const result = await listAutomlTrainingTasks({
        page: nextPage,
        limit: PAGE_LIMIT,
        keyword: nextKeyword.trim() || undefined,
        statusCd: nextStatus || undefined,
      });
      setTasks(result.rows);
      setTotal(result.total);
      setTotalPage(Math.max(1, Number(result.totalPage) || 1));
      setPage(Number(result.current) || nextPage);
      if (!options.silent) setError(null);
    } catch (reason) {
      setTasks((current) => current ?? []);
      if (!options.silent) {
        setError(reason instanceof Error ? reason.message : "训练任务列表加载失败");
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks(1, "", "");
  }, [loadTasks]);

  // 侧栏等外部入口删除任务后联动刷新当前列表视图
  useEffect(() => {
    const reload = () => { void loadTasks(page, keyword, statusFilter, { silent: true }); };
    window.addEventListener(AUTOML_TRAINING_TASKS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(AUTOML_TRAINING_TASKS_CHANGED_EVENT, reload);
  }, [loadTasks, page, keyword, statusFilter]);

  const submitKeyword = useCallback(() => {
    setKeyword(keywordDraft);
    void loadTasks(1, keywordDraft, statusFilter);
  }, [keywordDraft, loadTasks, statusFilter]);

  const changeStatusFilter = useCallback((value: string) => {
    setStatusFilter(value);
    void loadTasks(1, keyword, value);
  }, [keyword, loadTasks]);

  const changePage = useCallback((nextPage: number) => {
    void loadTasks(nextPage, keyword, statusFilter);
  }, [keyword, loadTasks, statusFilter]);

  const closeWizard = useCallback(() => {
    if (submitting) return;
    setWizardOpen(false);
    setStep(1);
    setDatasetId("");
    setVersionDetail(null);
    setVersionId("");
    setReadiness(null);
    setReadinessError(null);
    setPlatformOptions([]);
    setOptionPlatformId("");
    setBaseModelId("");
    setTaskName("");
    setHyperParams({});
    setWizardError(null);
  }, [submitting]);

  function openWizard() {
    setWizardOpen(true);
    setStep(1);
    setDatasetsLoading(true);
    void (async () => {
      try {
        const datasetsPage = await listAutomlDatasets({ page: 1, limit: 50 });
        setDatasets(datasetsPage.rows);
      } catch (reason) {
        setWizardError(reason instanceof Error ? reason.message : "数据集列表加载失败");
      } finally {
        setDatasetsLoading(false);
      }
    })();
  }

  function selectDataset(nextDatasetId: string) {
    setDatasetId(nextDatasetId);
    setVersionId("");
    setVersionDetail(null);
    setReadiness(null);
    setReadinessError(null);
    if (!nextDatasetId) return;
    setVersionsLoading(true);
    void (async () => {
      try {
        const detail = await getAutomlDatasetVersionDetails(nextDatasetId);
        setVersionDetail(detail);
      } catch (reason) {
        setWizardError(reason instanceof Error ? reason.message : "数据集版本加载失败");
      } finally {
        setVersionsLoading(false);
      }
    })();
  }

  // 选定版本即拉取就绪检查（HARD 未过禁用下一步）
  function selectVersion(nextVersionId: string) {
    setVersionId(nextVersionId);
    setReadiness(null);
    setReadinessError(null);
    if (!nextVersionId) return;
    setReadinessLoading(true);
    void (async () => {
      try {
        setReadiness(await getAutomlTaskReadiness(nextVersionId));
      } catch (reason) {
        setReadinessError(reason instanceof Error ? reason.message : "就绪检查加载失败");
      } finally {
        setReadinessLoading(false);
      }
    })();
  }

  const hardBlocked = useMemo(() => {
    if (!readiness) return true;
    const hardChecks = readiness.checks.filter((check) => check.level === "HARD");
    if (!hardChecks.length) return !readiness.ready;
    return hardChecks.some((check) => !check.passed);
  }, [readiness]);

  function goToStep2() {
    if (!versionId || hardBlocked) return;
    setOptionsLoading(true);
    setWizardError(null);
    void (async () => {
      try {
        const dataset = datasets.find((candidate) => String(candidate.id) === datasetId);
        const options = await listAutomlPlatformOptions(dataset?.taskType || undefined);
        setPlatformOptions(options);
        setOptionPlatformId("");
        setBaseModelId("");
        setStep(2);
      } catch (reason) {
        setWizardError(reason instanceof Error ? reason.message : "训练平台列表加载失败");
      } finally {
        setOptionsLoading(false);
      }
    })();
  }

  const selectedOption = useMemo(
    () => platformOptions.find((option) => String(option.platformId) === optionPlatformId) ?? null,
    [optionPlatformId, platformOptions],
  );
  const selectedBaseModel = useMemo(
    () => selectedOption?.baseModels.find((model) => String(model.id) === baseModelId) ?? null,
    [baseModelId, selectedOption],
  );
  const selectedVersionLabel = useMemo(() => {
    const dataset = datasets.find((candidate) => String(candidate.id) === datasetId);
    const version = versionDetail?.versions.find((candidate) => String(candidate.id) === versionId);
    if (!version) return versionId || "—";
    return `${dataset ? `${dataset.name} ` : ""}v${version.version}`;
  }, [datasetId, datasets, versionDetail, versionId]);

  function goToStep3() {
    if (!selectedOption || !selectedBaseModel) return;
    // 参数初值：平台 Schema 默认值为基础，基础模型 defaultConfigJson 覆盖
    const properties = selectedOption.configSchemaJson?.properties ?? {};
    const initial: Record<string, string> = {};
    for (const [name, property] of Object.entries(properties)) {
      const overlay = selectedBaseModel.defaultConfigJson?.[name];
      const fallback = (property as AutomlPlatformConfigProperty)?.default;
      const value = overlay !== undefined ? overlay : fallback;
      initial[name] = value === undefined || value === null ? "" : String(value);
    }
    setHyperParams(initial);
    setStep(3);
  }

  async function submitCreateTask() {
    if (!selectedBaseModel || !versionId) return;
    setSubmitting(true);
    setWizardError(null);
    try {
      // 按 Schema 声明的类型提交：integer/number 转数字，其余保留字符串
      const properties = selectedOption?.configSchemaJson?.properties ?? {};
      const hyperParamsJson: Record<string, unknown> = {};
      for (const [name, text] of Object.entries(hyperParams)) {
        if (!String(text).trim()) continue;
        const propertyType = (properties[name] as AutomlPlatformConfigProperty | undefined)?.type;
        if (propertyType === "integer" || propertyType === "number") {
          const parsed = Number(text);
          hyperParamsJson[name] = Number.isFinite(parsed) ? parsed : text;
        } else {
          hyperParamsJson[name] = text;
        }
      }
      const created = await createAutomlTrainingTask({
        name: taskName.trim() || undefined,
        datasetVersionId: versionId,
        baseModelId: selectedBaseModel.id,
        hyperParamsJson,
      });
      setNotice(`训练任务「${created.name || created.taskCode}」已创建，可在列表中下发到设备`);
      closeWizard();
      await loadTasks(1, keyword, statusFilter);
    } catch (reason) {
      setWizardError(reason instanceof Error ? reason.message : "训练任务创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  function openDispatch(task: AutomlTrainingTask) {
    setPendingAction({ kind: "dispatch", task });
    setSelectedDeviceId("");
    setActionError(null);
    setDevicesLoading(true);
    void (async () => {
      try {
        const devicesPage = await listAutomlDevices({ page: 1, limit: 50, statusCd: "ONLINE" });
        setOnlineDevices(devicesPage.rows);
      } catch (reason) {
        setActionError(reason instanceof Error ? reason.message : "设备列表加载失败");
      } finally {
        setDevicesLoading(false);
      }
    })();
  }

  async function confirmAction() {
    const action = pendingAction;
    if (!action) return;
    if (action.kind === "dispatch" && !selectedDeviceId) {
      setActionError("请选择一台在线设备");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      if (action.kind === "dispatch") {
        const dispatched = await dispatchAutomlTrainingTask(action.task.id, selectedDeviceId);
        setNotice(`任务「${dispatched.name || dispatched.taskCode}」已下发到设备`);
      } else if (action.kind === "delete") {
        await deleteAutomlTrainingTask(action.task.id);
        setNotice(`任务「${action.task.name || action.task.taskCode}」已删除`);
        setTotal((current) => String(Math.max(0, Number(current ?? 0) - 1)));
      } else {
        await cancelAutomlTrainingTask(action.task.id);
        setNotice(`任务「${action.task.name || action.task.taskCode}」已取消`);
      }
      setPendingAction(null);
      await loadTasks(page, keyword, statusFilter, { silent: true });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "操作失败，请稍后重试");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <section className="tasks-page">
      <div className="devices-header">
        <div>
          <span className="eyebrow">平台 · 训练任务</span>
          <h1>训练任务</h1>
          <p>基于数据集版本与基础模型创建训练任务，下发到边缘设备并跟踪进度。</p>
        </div>
        <div className="devices-header-actions">
          <button className="secondary-button compact" type="button" onClick={() => void loadTasks(page, keyword, statusFilter)} disabled={loading}>
            {loading ? <LoaderCircle size={13} className="spinner" /> : <RefreshCw size={13} />}
            刷新
          </button>
          <button className="primary-button compact" type="button" onClick={openWizard}>
            <Plus size={13} />
            新建训练任务
          </button>
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
          <Check size={14} aria-hidden="true" />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>关闭</button>
        </div>
      ) : null}

      <div className="devices-toolbar">
        <div className="devices-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={keywordDraft}
            onChange={(event) => setKeywordDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitKeyword();
            }}
            placeholder="搜索任务名称 / 编码"
            aria-label="搜索训练任务"
          />
          {keywordDraft ? (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => {
                setKeywordDraft("");
                setKeyword("");
                void loadTasks(1, "", statusFilter);
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
          {TASK_STATUS_FILTERS.map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="devices-count">共 {total == null ? "—" : Number(total)} 个任务</span>
      </div>

      {loading && tasks.length === 0 ? (
        <article className="panel workbench-loading" aria-live="polite">
          <LoaderCircle size={20} className="spinner" />
          <span>正在读取训练任务…</span>
        </article>
      ) : tasks.length === 0 ? (
        <article className="panel workbench-empty-state">
          <span className="empty-state-icon"><Rocket size={20} /></span>
          <span className="eyebrow">训练任务</span>
          <h2>暂无训练任务</h2>
          <p>选择数据集版本与基础模型创建第一个训练任务，创建后下发到在线边缘设备开始训练。</p>
          <button className="primary-button" type="button" onClick={openWizard}>
            <Plus size={14} />
            新建训练任务
          </button>
        </article>
      ) : (
        <>
          <article className="panel task-table">
            <div className="task-table-head" aria-hidden="true">
              <span>任务</span>
              <span>状态</span>
              <span>平台</span>
              <span>基础模型</span>
              <span>进度</span>
              <span>轮次</span>
              <span>设备</span>
              <span>开始时间</span>
              <span className="task-actions-head">操作</span>
            </div>
            {tasks.map((task) => (
              <div className="task-row" key={String(task.id)}>
                <div className="task-name">
                  <Link href={`/training-tasks/${encodeURIComponent(String(task.id))}`} title={task.name || task.taskCode}>
                    {task.name || task.taskCode}
                  </Link>
                  <small>{task.taskCode}</small>
                </div>
                <span>
                  <span className="device-status-chip task-status-chip" data-status={task.statusCd}>
                    {statusText(task.statusCd)}
                  </span>
                </span>
                <span className="task-cell" title={task.platformName ?? undefined}>{task.platformName || "—"}</span>
                <span className="task-cell" title={task.baseModelName ?? undefined}>{task.baseModelName || "—"}</span>
                <div className="task-progress">
                  <div className="automl-progress-bar"><i style={{ width: progressWidth(task.progress) }} /></div>
                  <small>{formatProgress(task.progress)}</small>
                </div>
                <span className="task-cell task-epochs">{formatNumberPair(task.currentEpoch, task.totalEpochs)}</span>
                <span className="task-cell" title={task.deviceName ?? undefined}>{task.deviceName || "—"}</span>
                <span className="task-cell">{task.startedAt || "—"}</span>
                <div className="task-actions">
                  <Link className="secondary-button compact" href={`/training-tasks/${encodeURIComponent(String(task.id))}`}>
                    详情
                  </Link>
                  {task.statusCd === "CREATED" ? (
                    <button className="secondary-button compact" type="button" onClick={() => openDispatch(task)}>
                      <Send size={12} />
                      下发
                    </button>
                  ) : null}
                  {task.statusCd === "CREATED" || task.statusCd === "QUEUED" ? (
                    <button
                      className="secondary-button compact device-delete-button"
                      type="button"
                      onClick={() => setPendingAction({ kind: "cancel", task })}
                    >
                      取消
                    </button>
                  ) : null}
                  {task.statusCd !== "RUNNING" && task.statusCd !== "SCHEDULED" ? (
                    <button
                      className="secondary-button compact device-delete-button"
                      type="button"
                      onClick={() => setPendingAction({ kind: "delete", task })}
                    >
                      删除
                    </button>
                  ) : null}
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

      {wizardOpen ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog task-wizard-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-wizard-title"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Rocket size={18} /></span>
                <span>
                  <h2 id="task-wizard-title">新建训练任务</h2>
                  <p>第 {step} / 3 步：{step === 1 ? "选择数据集版本并确认就绪" : step === 2 ? "选择训练平台与基础模型" : "确认训练参数并创建"}</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={submitting} onClick={closeWizard}>×</button>
            </div>

            <div className="task-wizard-steps" aria-hidden="true">
              {([1, 2, 3] as WizardStep[]).map((candidate) => (
                <span key={candidate} className={candidate === step ? "is-active" : candidate < step ? "is-done" : ""} />
              ))}
            </div>

            {step === 1 ? (
              <>
                <label className="device-dialog-field">
                  <span>数据集</span>
                  <select
                    className="device-dialog-select"
                    value={datasetId}
                    disabled={datasetsLoading}
                    onChange={(event) => selectDataset(event.target.value)}
                  >
                    <option value="">{datasetsLoading ? "正在加载数据集…" : datasets.length ? "请选择数据集" : "暂无数据集"}</option>
                    {datasets.map((dataset) => (
                      <option value={String(dataset.id)} key={String(dataset.id)}>{dataset.name}</option>
                    ))}
                  </select>
                </label>
                <label className="device-dialog-field">
                  <span>数据集版本</span>
                  <select
                    className="device-dialog-select"
                    value={versionId}
                    disabled={!datasetId || versionsLoading}
                    onChange={(event) => selectVersion(event.target.value)}
                  >
                    <option value="">
                      {versionsLoading ? "正在加载版本…" : versionDetail?.versions.length ? "请选择版本" : "该数据集暂无版本"}
                    </option>
                    {versionDetail?.versions.map((version) => (
                      <option value={String(version.id)} key={String(version.id)}>
                        v{version.version} · {version.sampleCount} 个样本 · {version.statusCd}
                      </option>
                    ))}
                  </select>
                </label>

                {readinessLoading ? (
                  <p className="device-detail-hint"><LoaderCircle size={12} className="spinner" /> 正在执行就绪检查…</p>
                ) : null}
                {readinessError ? <p className="device-detail-hint is-error" role="alert">{readinessError}</p> : null}
                {readiness ? (
                  <div className="readiness-panel" aria-live="polite">
                    <div className="readiness-summary">
                      <span>样本 {Number(readiness.summary?.itemCount ?? 0)}</span>
                      <span>已标注 {Number(readiness.summary?.annotatedItemCount ?? 0)}</span>
                      <span>类别 {readiness.summary?.classCount ?? 0}</span>
                      <span>训练 {Number(readiness.summary?.splitCounts?.TRAIN ?? 0)}</span>
                      <span>验证 {Number(readiness.summary?.splitCounts?.VAL ?? 0)}</span>
                      <span>未分配 {Number(readiness.summary?.splitCounts?.UNASSIGNED ?? 0)}</span>
                    </div>
                    <ul className="readiness-checks">
                      {readiness.checks.map((check) => (
                        <li
                          key={check.key}
                          className={`readiness-check${check.passed ? " is-passed" : check.level === "HARD" ? " is-hard-failed" : " is-soft-failed"}`}
                        >
                          <strong>{check.level === "HARD" ? "阻断" : "提示"}</strong>
                          <span>{check.message}</span>
                          <em>{check.passed ? "通过" : "未通过"}</em>
                        </li>
                      ))}
                    </ul>
                    {hardBlocked ? (
                      <p className="device-detail-hint is-error" role="alert">存在未通过的阻断项，无法进入下一步。</p>
                    ) : null}
                  </div>
                ) : null}
                {wizardError ? <p className="device-detail-hint is-error" role="alert">{wizardError}</p> : null}
                <div className="dialog-actions">
                  <button className="secondary-button" type="button" disabled={submitting} onClick={closeWizard}>取消</button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!versionId || hardBlocked || readinessLoading || optionsLoading}
                    onClick={goToStep2}
                  >
                    {optionsLoading ? <LoaderCircle size={14} className="spinner" /> : null}
                    下一步
                  </button>
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <label className="device-dialog-field">
                  <span>训练平台</span>
                  <select
                    className="device-dialog-select"
                    value={optionPlatformId}
                    disabled={optionsLoading}
                    onChange={(event) => {
                      setOptionPlatformId(event.target.value);
                      setBaseModelId("");
                    }}
                  >
                    <option value="">
                      {optionsLoading ? "正在加载平台…" : platformOptions.length ? "请选择训练平台" : "暂无可用平台"}
                    </option>
                    {platformOptions.map((option) => (
                      <option value={String(option.platformId)} key={String(option.platformId)}>
                        {option.name}（{option.baseModels.length} 个基础模型）
                      </option>
                    ))}
                  </select>
                </label>
                <label className="device-dialog-field">
                  <span>基础模型</span>
                  <select
                    className="device-dialog-select"
                    value={baseModelId}
                    disabled={!optionPlatformId}
                    onChange={(event) => setBaseModelId(event.target.value)}
                  >
                    <option value="">
                      {selectedOption?.baseModels.length ? "请选择基础模型" : "该平台暂无基础模型"}
                    </option>
                    {selectedOption?.baseModels.map((model) => (
                      <option value={String(model.id)} key={String(model.id)}>
                        {model.name}（{model.modelCode}）
                      </option>
                    ))}
                  </select>
                </label>
                {selectedBaseModel?.defaultConfigJson ? (
                  <p className="device-detail-hint">
                    该基础模型带默认参数覆盖：{Object.entries(selectedBaseModel.defaultConfigJson)
                      .map(([key, value]) => `${key}=${describePropertyValue(value)}`)
                      .join("，")}
                  </p>
                ) : null}
                {wizardError ? <p className="device-detail-hint is-error" role="alert">{wizardError}</p> : null}
                <div className="dialog-actions">
                  <button className="secondary-button" type="button" disabled={submitting} onClick={() => setStep(1)}>上一步</button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!selectedOption || !selectedBaseModel}
                    onClick={goToStep3}
                  >
                    下一步
                  </button>
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <div className="task-wizard-recap">
                  <span>数据集版本：{selectedVersionLabel}</span>
                  <span>平台：{selectedOption?.name ?? "—"}</span>
                  <span>基础模型：{selectedBaseModel ? `${selectedBaseModel.name}（${selectedBaseModel.modelCode}）` : "—"}</span>
                </div>
                <label className="device-dialog-field">
                  <span>任务名称（选填）</span>
                  <input
                    className="device-dialog-select constants-dialog-input"
                    value={taskName}
                    placeholder="不填时由后端生成"
                    onChange={(event) => setTaskName(event.target.value)}
                  />
                </label>
                {Object.keys(selectedOption?.configSchemaJson?.properties ?? {}).length ? (
                  <div className="task-params-grid">
                    {Object.entries(selectedOption?.configSchemaJson?.properties ?? {}).map(([name, rawProperty]) => {
                      const property = (rawProperty ?? {}) as AutomlPlatformConfigProperty;
                      const value = hyperParams[name] ?? "";
                      const setValue = (next: string) => setHyperParams((current) => ({ ...current, [name]: next }));
                      const isNumeric = property.type === "integer" || property.type === "number";
                      return (
                        <label className="automl-field" key={name}>
                          <span>{name}{isNumeric && property.minimum != null ? `（最小 ${String(property.minimum)}）` : ""}</span>
                          {Array.isArray(property.enum) && property.enum.length ? (
                            <select
                              className="device-dialog-select"
                              value={value}
                              onChange={(event) => setValue(event.target.value)}
                            >
                              <option value="">未设置</option>
                              {property.enum.map((candidate) => (
                                <option value={String(candidate)} key={String(candidate)}>{String(candidate)}</option>
                              ))}
                            </select>
                          ) : isNumeric ? (
                            <input
                              className="device-dialog-select constants-dialog-input"
                              type="number"
                              min={property.minimum != null ? String(property.minimum) : undefined}
                              max={property.maximum != null ? String(property.maximum) : undefined}
                              step={property.type === "integer" ? "1" : "any"}
                              value={value}
                              onChange={(event) => setValue(event.target.value)}
                            />
                          ) : (
                            <input
                              className="device-dialog-select constants-dialog-input"
                              value={value}
                              placeholder={property.default !== undefined ? `默认 ${describePropertyValue(property.default)}` : "选填"}
                              onChange={(event) => setValue(event.target.value)}
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="device-detail-hint">该平台未声明训练参数 Schema，将直接使用基础模型默认配置。</p>
                )}
                {wizardError ? <p className="device-detail-hint is-error" role="alert">{wizardError}</p> : null}
                <div className="dialog-actions">
                  <button className="secondary-button" type="button" disabled={submitting} onClick={() => setStep(2)}>上一步</button>
                  <button className="primary-button" type="button" disabled={submitting} onClick={() => void submitCreateTask()}>
                    {submitting ? <LoaderCircle size={14} className="spinner" /> : <Plus size={14} />}
                    {submitting ? "正在创建" : "创建训练任务"}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {pendingAction?.kind === "dispatch" ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog device-deploy-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-dispatch-title"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Send size={18} /></span>
                <span>
                  <h2 id="task-dispatch-title">下发任务 · {pendingAction.task.name || pendingAction.task.taskCode}</h2>
                  <p>选择一台在线设备，任务将排队等待该设备领取并开始训练。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={actionBusy} onClick={() => setPendingAction(null)}>×</button>
            </div>
            {devicesLoading ? (
              <p className="device-detail-hint"><LoaderCircle size={12} className="spinner" /> 正在读取在线设备…</p>
            ) : onlineDevices.length === 0 ? (
              <p className="device-detail-hint is-error">暂无在线设备：请先启动端侧服务并等待心跳上线。</p>
            ) : (
              <div className="task-device-list" role="radiogroup" aria-label="选择在线设备">
                {onlineDevices.map((device) => (
                  <label
                    className={`task-device-option${selectedDeviceId === String(device.deviceId) ? " is-selected" : ""}`}
                    key={String(device.deviceId)}
                    htmlFor={`dispatch-device-${String(device.deviceId)}`}
                  >
                    <input
                      type="radio"
                      id={`dispatch-device-${String(device.deviceId)}`}
                      name="dispatch-device"
                      value={String(device.deviceId)}
                      checked={selectedDeviceId === String(device.deviceId)}
                      onChange={() => setSelectedDeviceId(String(device.deviceId))}
                    />
                    <strong>{device.name}</strong>
                    <small>{device.deviceCode} · {device.runtime || "—"}</small>
                  </label>
                ))}
              </div>
            )}
            {actionError ? <p className="device-detail-hint is-error" role="alert">{actionError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={actionBusy} onClick={() => setPendingAction(null)}>取消</button>
              <button
                className="primary-button"
                type="button"
                disabled={actionBusy || devicesLoading || !selectedDeviceId}
                onClick={() => void confirmAction()}
              >
                {actionBusy ? <LoaderCircle size={14} className="spinner" /> : <Send size={14} />}
                {actionBusy ? "正在下发" : "确认下发"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingAction?.kind === "delete" ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog resource-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-delete-title"
            aria-describedby="task-delete-detail"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><AlertCircle size={18} /></span>
                <span>
                  <h2 id="task-delete-title">删除训练任务</h2>
                  <p>确定要删除「{pendingAction.task.name || pendingAction.task.taskCode}」吗？</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={actionBusy} onClick={() => setPendingAction(null)}>×</button>
            </div>
            <p className="resource-action-detail" id="task-delete-detail">
              删除后任务的指标、事件与产物清单一并清除，且不可恢复；已发布为模型版本的任务不可删除。
            </p>
            {actionError ? <p className="device-detail-hint is-error" role="alert">{actionError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={actionBusy} onClick={() => setPendingAction(null)}>返回</button>
              <button className="primary-button device-confirm-danger" type="button" disabled={actionBusy} onClick={() => void confirmAction()}>
                {actionBusy ? "正在删除" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingAction?.kind === "cancel" ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog resource-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-cancel-title"
            aria-describedby="task-cancel-detail"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><AlertCircle size={18} /></span>
                <span>
                  <h2 id="task-cancel-title">取消训练任务</h2>
                  <p>确定要取消「{pendingAction.task.name || pendingAction.task.taskCode}」吗？</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={actionBusy} onClick={() => setPendingAction(null)}>×</button>
            </div>
            <p className="resource-action-detail" id="task-cancel-detail">
              取消后任务进入终态，不能再下发或恢复；如需重新训练请再次创建任务。
            </p>
            {actionError ? <p className="device-detail-hint is-error" role="alert">{actionError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={actionBusy} onClick={() => setPendingAction(null)}>返回</button>
              <button className="primary-button device-confirm-danger" type="button" disabled={actionBusy} onClick={() => void confirmAction()}>
                {actionBusy ? "正在处理" : "确认取消"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
