"use client";

import {
  AlertCircle,
  Check,
  Cpu,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AutomlBaseModel,
  type AutomlBaseModelInput,
  type AutomlConstant,
  type AutomlPlatform,
  type AutomlPlatformConfigProperty,
  type AutomlPlatformConfigSchema,
  createAutomlPlatform,
  createAutomlPlatformBaseModel,
  deleteAutomlBaseModel,
  deleteAutomlPlatform,
  getAutomlPlatform,
  listAutomlConstants,
  listAutomlPlatformBaseModels,
  listAutomlPlatforms,
  statusCdLabels,
  updateAutomlBaseModel,
  updateAutomlPlatform,
} from "../../lib/automl-platform-api";

type PlatformForm = {
  platformCode: string;
  name: string;
  framework: string;
  operatorKey: string;
  taskTypes: string[];
  schemaText: string;
  sortOrder: string;
  statusCd: string;
  description: string;
};

type BaseModelForm = {
  modelCode: string;
  name: string;
  taskType: string;
  weightsObjectKey: string;
  paramCount: string;
  modelSizeBytes: string;
  flops: string;
  inputSize: string;
  configText: string;
  sortOrder: string;
  statusCd: string;
  remark: string;
};

type BaseModelDialog =
  | { kind: "create"; platformId: string }
  | { kind: "edit"; platformId: string; baseModel: AutomlBaseModel }
  | null;

type PendingDelete =
  | { kind: "platform"; platform: AutomlPlatform }
  | { kind: "baseModel"; platformId: string; baseModel: AutomlBaseModel }
  | null;

const emptyPlatformForm: PlatformForm = {
  platformCode: "",
  name: "",
  framework: "",
  operatorKey: "",
  taskTypes: [],
  schemaText: "",
  sortOrder: "0",
  statusCd: "ENABLED",
  description: "",
};

const emptyBaseModelForm: BaseModelForm = {
  modelCode: "",
  name: "",
  taskType: "",
  weightsObjectKey: "",
  paramCount: "",
  modelSizeBytes: "",
  flops: "",
  inputSize: "",
  configText: "",
  sortOrder: "0",
  statusCd: "ENABLED",
  remark: "",
};

function formatBytesMb(value: AutomlBaseModel["modelSizeBytes"]): string {
  const bytes = Number(value);
  if (value == null || !Number.isFinite(bytes)) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function formatNumber(value: AutomlBaseModel["paramCount"] | AutomlBaseModel["flops"]): string {
  const parsed = Number(value);
  if (value == null || !Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("zh-CN");
}

function parseOptionalJson(text: string): { value: Record<string, unknown> | null; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: "需要是一个 JSON 对象" };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: null, error: "JSON 格式不合法" };
  }
}

export function TrainingPlatformsWorkbench() {
  const [platforms, setPlatforms] = useState<AutomlPlatform[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [taskTypeConstants, setTaskTypeConstants] = useState<AutomlConstant[]>([]);
  const [frameworkConstants, setFrameworkConstants] = useState<AutomlConstant[]>([]);

  const [mode, setMode] = useState<"view" | "create">("view");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState<PlatformForm>(emptyPlatformForm);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [parsedSchema, setParsedSchema] = useState<AutomlPlatformConfigSchema | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [baseModels, setBaseModels] = useState<AutomlBaseModel[]>([]);
  const [baseModelsLoading, setBaseModelsLoading] = useState(false);
  const [baseModelDialog, setBaseModelDialog] = useState<BaseModelDialog>(null);
  const [baseModelForm, setBaseModelForm] = useState<BaseModelForm>(emptyBaseModelForm);
  const [baseModelError, setBaseModelError] = useState<string | null>(null);
  const [baseModelSaving, setBaseModelSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadPlatforms = useCallback(async (preferId?: string | null) => {
    setListLoading(true);
    try {
      const rows = await listAutomlPlatforms();
      setPlatforms(rows);
      setError(null);
      if (rows.length === 0) {
        // 没有任何平台时直接进入新建模式，右侧给出可填写的表单
        setMode("create");
        setSelectedId(null);
        return;
      }
      const nextId = preferId
        && rows.some((platform) => String(platform.id) === preferId)
        ? preferId
        : rows[0] != null ? String(rows[0].id) : null;
      setSelectedId(nextId);
    } catch (reason) {
      setPlatforms([]);
      setSelectedId(null);
      setError(reason instanceof Error ? reason.message : "训练平台列表加载失败");
    } finally {
      setListLoading(false);
    }
  }, []);

  // 加载常量字典：平台表单的 framework / taskTypes 下拉来源
  useEffect(() => {
    void (async () => {
      try {
        const [taskTypes, frameworks] = await Promise.all([
          listAutomlConstants({ constType: "TASK_TYPE" }),
          listAutomlConstants({ constType: "FRAMEWORK" }),
        ]);
        setTaskTypeConstants(taskTypes);
        setFrameworkConstants(frameworks);
      } catch {
        // 字典加载失败时下拉退化为空，不阻断页面
      }
    })();
  }, []);

  useEffect(() => {
    void loadPlatforms(null);
  }, [loadPlatforms]);

  const fillFormFromPlatform = useCallback((platform: AutomlPlatform) => {
    setForm({
      platformCode: platform.platformCode,
      name: platform.name,
      framework: platform.framework ?? "",
      operatorKey: platform.operatorKey ?? "",
      taskTypes: platform.taskTypes ?? [],
      schemaText: platform.configSchemaJson ? JSON.stringify(platform.configSchemaJson, null, 2) : "",
      sortOrder: String(platform.sortOrder ?? 0),
      statusCd: platform.statusCd || "ENABLED",
      description: platform.description ?? "",
    });
    setParsedSchema(platform.configSchemaJson);
    setSchemaError(null);
    setFormError(null);
  }, []);

  // 选中平台后拉详情与基础模型
  useEffect(() => {
    if (mode === "create") return;
    if (!selectedId) {
      setForm(emptyPlatformForm);
      setParsedSchema(null);
      setBaseModels([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setBaseModelsLoading(true);
    void (async () => {
      try {
        const platform = await getAutomlPlatform(selectedId);
        if (cancelled) return;
        fillFormFromPlatform(platform);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "平台详情加载失败");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    void (async () => {
      try {
        const models = await listAutomlPlatformBaseModels(selectedId);
        if (!cancelled) setBaseModels(models);
      } catch {
        if (!cancelled) setBaseModels([]);
      } finally {
        if (!cancelled) setBaseModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fillFormFromPlatform, mode, selectedId]);

  function selectPlatform(id: string) {
    setMode("view");
    setSelectedId(id);
  }

  function openCreate() {
    setMode("create");
    setSelectedId(null);
    setForm(emptyPlatformForm);
    setParsedSchema(null);
    setSchemaError(null);
    setFormError(null);
    setBaseModels([]);
  }

  // Schema 文本失焦时校验并同步右侧参数卡片
  function validateSchemaText() {
    const { value, error: parseError } = parseOptionalJson(form.schemaText);
    setSchemaError(parseError);
    setParsedSchema(parseError ? null : value);
  }

  async function submitPlatform() {
    if (!form.name.trim()) {
      setFormError("请填写平台名称");
      return;
    }
    if (mode === "create" && !form.platformCode.trim()) {
      setFormError("请填写平台编码");
      return;
    }
    const schema = parseOptionalJson(form.schemaText);
    if (schema.error) {
      setSchemaError(schema.error);
      setFormError("训练参数 Schema JSON 不合法，请修正后再保存");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const sortOrder = Number(form.sortOrder);
      const payload = {
        name: form.name.trim(),
        framework: form.framework || undefined,
        operatorKey: form.operatorKey.trim() || undefined,
        taskTypes: form.taskTypes,
        configSchemaJson: schema.value,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        statusCd: form.statusCd,
        description: form.description.trim() || undefined,
      };
      if (mode === "create") {
        const created = await createAutomlPlatform({ ...payload, platformCode: form.platformCode.trim() });
        setNotice(`平台「${created.name}」已创建`);
        setMode("view");
        await loadPlatforms(String(created.id));
      } else if (selectedId) {
        const updated = await updateAutomlPlatform(selectedId, payload);
        setNotice(`平台「${updated.name}」已保存`);
        fillFormFromPlatform(updated);
        await loadPlatforms(selectedId);
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  function openBaseModelCreate() {
    setBaseModelForm(emptyBaseModelForm);
    setBaseModelError(null);
    if (!selectedId) return;
    setBaseModelDialog({ kind: "create", platformId: selectedId });
  }

  function openBaseModelEdit(baseModel: AutomlBaseModel) {
    setBaseModelForm({
      modelCode: baseModel.modelCode,
      name: baseModel.name,
      taskType: baseModel.taskType ?? "",
      weightsObjectKey: baseModel.weightsObjectKey ?? "",
      paramCount: baseModel.paramCount == null ? "" : String(baseModel.paramCount),
      modelSizeBytes: baseModel.modelSizeBytes == null ? "" : String(baseModel.modelSizeBytes),
      flops: baseModel.flops == null ? "" : String(baseModel.flops),
      inputSize: baseModel.inputSize ?? "",
      configText: baseModel.defaultConfigJson ? JSON.stringify(baseModel.defaultConfigJson, null, 2) : "",
      sortOrder: String(baseModel.sortOrder ?? 0),
      statusCd: baseModel.statusCd || "ENABLED",
      remark: baseModel.remark ?? "",
    });
    setBaseModelError(null);
    setBaseModelDialog({ kind: "edit", platformId: String(baseModel.platformId), baseModel });
  }

  async function submitBaseModel() {
    if (!baseModelDialog) return;
    if (!baseModelForm.name.trim()) {
      setBaseModelError("请填写基础模型名称");
      return;
    }
    if (baseModelDialog.kind === "create" && !baseModelForm.modelCode.trim()) {
      setBaseModelError("请填写基础模型编码");
      return;
    }
    const config = parseOptionalJson(baseModelForm.configText);
    if (config.error) {
      setBaseModelError(`默认参数覆盖 JSON 不合法：${config.error}`);
      return;
    }
    setBaseModelSaving(true);
    setBaseModelError(null);
    try {
      const numberOrUndefined = (text: string) => {
        const parsed = Number(text);
        return text.trim() && Number.isFinite(parsed) ? parsed : undefined;
      };
      const sortOrder = Number(baseModelForm.sortOrder);
      const payload: AutomlBaseModelInput = {
        name: baseModelForm.name.trim(),
        taskType: baseModelForm.taskType || undefined,
        weightsObjectKey: baseModelForm.weightsObjectKey.trim() || undefined,
        // 权重文件大小/校验和由文件上传链路维护，表单不提供
        paramCount: numberOrUndefined(baseModelForm.paramCount),
        modelSizeBytes: numberOrUndefined(baseModelForm.modelSizeBytes),
        flops: numberOrUndefined(baseModelForm.flops),
        inputSize: baseModelForm.inputSize.trim() || undefined,
        defaultConfigJson: config.value,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        statusCd: baseModelForm.statusCd,
        remark: baseModelForm.remark.trim() || undefined,
      };
      if (baseModelDialog.kind === "edit") {
        await updateAutomlBaseModel(baseModelDialog.baseModel.id, payload);
        setNotice(`基础模型「${payload.name}」已保存`);
      } else {
        await createAutomlPlatformBaseModel(baseModelDialog.platformId, {
          ...payload,
          modelCode: baseModelForm.modelCode.trim(),
        });
        setNotice(`基础模型「${payload.name}」已创建`);
      }
      setBaseModelDialog(null);
      if (selectedId) {
        setBaseModelsLoading(true);
        try {
          setBaseModels(await listAutomlPlatformBaseModels(selectedId));
        } finally {
          setBaseModelsLoading(false);
        }
        await loadPlatforms(selectedId);
      }
    } catch (reason) {
      setBaseModelError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setBaseModelSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      if (pendingDelete.kind === "platform") {
        await deleteAutomlPlatform(pendingDelete.platform.id);
        setNotice(`平台「${pendingDelete.platform.name}」已删除`);
        setPendingDelete(null);
        await loadPlatforms(null);
      } else {
        await deleteAutomlBaseModel(pendingDelete.baseModel.id);
        setNotice(`基础模型「${pendingDelete.baseModel.name}」已删除`);
        setPendingDelete(null);
        if (pendingDelete.platformId) {
          setBaseModels(await listAutomlPlatformBaseModels(pendingDelete.platformId));
        }
        if (selectedId) await loadPlatforms(selectedId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败，请稍后重试");
      setPendingDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  const schemaProperties = useMemo(
    () => Object.entries(parsedSchema?.properties ?? {}) as [string, AutomlPlatformConfigProperty][],
    [parsedSchema],
  );

  const editing = mode === "view" && !!selectedId;
  const showCreatePanel = mode === "create" || (!listLoading && platforms.length === 0);

  return (
    <section className="platforms-page">
      <div className="devices-header">
        <div>
          <span className="eyebrow">平台 · 训练平台</span>
          <h1>训练平台</h1>
          <p>维护训练平台与基础模型：平台信息、训练参数 Schema 与基础模型清单。</p>
        </div>
        <div className="devices-header-actions">
          <button className="secondary-button compact" type="button" onClick={() => void loadPlatforms(selectedId)} disabled={listLoading}>
            {listLoading ? <LoaderCircle size={13} className="spinner" /> : <RefreshCw size={13} />}
            刷新
          </button>
          <button className="primary-button compact" type="button" onClick={openCreate}>
            <Plus size={13} />
            新建平台
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

      <div className="platforms-layout">
        <aside className="panel platforms-list" aria-label="平台列表">
          {listLoading && platforms.length === 0 ? (
            <div className="platforms-list-loading"><LoaderCircle size={16} className="spinner" /> 正在读取平台…</div>
          ) : platforms.length === 0 ? (
            <div className="platforms-list-loading">暂无训练平台，点击右上角「新建平台」创建。</div>
          ) : platforms.map((platform) => (
            <button
              className={`platform-card${!editing && String(platform.id) === selectedId ? " is-selected" : ""}`}
              type="button"
              key={String(platform.id)}
              onClick={() => selectPlatform(String(platform.id))}
            >
              <span className="platform-card-top">
                <strong>{platform.name}</strong>
                <span className="device-status-chip" data-status={platform.statusCd === "DISABLED" ? "DISABLED" : "ONLINE"}>
                  {statusCdLabels[platform.statusCd] ?? platform.statusCd}
                </span>
              </span>
              <small className="platform-card-code">{platform.platformCode}</small>
              <small>{platform.baseModelCount} 个基础模型</small>
            </button>
          ))}
        </aside>

        <div className="platforms-detail">
          {showCreatePanel ? (
            <article className="panel workbench-empty-state">
              <span className="empty-state-icon"><Cpu size={20} /></span>
              <span className="eyebrow">训练平台</span>
              <h2>新建训练平台</h2>
              <p>在左侧表单填写平台编码与名称，保存后可继续维护训练参数 Schema 与基础模型。</p>
            </article>
          ) : null}

          {!showCreatePanel && !selectedId && !listLoading ? (
            <article className="panel workbench-empty-state">
              <span className="empty-state-icon"><Cpu size={20} /></span>
              <span className="eyebrow">训练平台</span>
              <h2>选择一个训练平台</h2>
              <p>从左侧列表选择平台后，在这里维护平台信息、训练参数 Schema 与基础模型。</p>
            </article>
          ) : null}

          {mode === "view" && detailLoading && !form.name ? (
            <article className="panel workbench-loading" aria-live="polite">
              <LoaderCircle size={20} className="spinner" />
              <span>正在读取平台详情…</span>
            </article>
          ) : null}

          {mode === "create" || form.name || detailLoading ? (
            <article className="panel platform-section">
              <h3 className="device-section-title">
                平台信息
                <small>{mode === "create" ? "创建后编码不可修改" : `编码 ${form.platformCode || "—"}`}</small>
              </h3>
              <div className="platform-form-grid">
                <label className="automl-field">
                  <span>平台编码</span>
                  <input
                    value={form.platformCode}
                    disabled={mode === "view"}
                    placeholder="如 PYTORCH"
                    onChange={(event) => setForm((current) => ({ ...current, platformCode: event.target.value }))}
                  />
                </label>
                <label className="automl-field">
                  <span>名称</span>
                  <input
                    value={form.name}
                    placeholder="如 PyTorch"
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="automl-field">
                  <span>训练框架</span>
                  <select
                    value={form.framework}
                    onChange={(event) => setForm((current) => ({ ...current, framework: event.target.value }))}
                  >
                    <option value="">未指定</option>
                    {frameworkConstants.map((constant) => (
                      <option value={constant.code} key={String(constant.id)}>{constant.name}</option>
                    ))}
                  </select>
                </label>
                <label className="automl-field">
                  <span>算子标识 operatorKey</span>
                  <input
                    value={form.operatorKey}
                    placeholder="如 torch.detection.v1"
                    onChange={(event) => setForm((current) => ({ ...current, operatorKey: event.target.value }))}
                  />
                </label>
                <div className="automl-field automl-field-wide">
                  <span>支持的任务类型</span>
                  <div className="platform-tasktype-picker" role="group" aria-label="支持的任务类型">
                    {taskTypeConstants.length === 0 ? <small>暂无任务类型常量，请先到常量管理维护。</small> : taskTypeConstants.map((constant) => {
                      const checked = form.taskTypes.includes(constant.code);
                      return (
                        <label className={`platform-tasktype-chip${checked ? " is-checked" : ""}`} key={String(constant.id)}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setForm((current) => ({
                                ...current,
                                taskTypes: checked
                                  ? current.taskTypes.filter((code) => code !== constant.code)
                                  : [...current.taskTypes, constant.code],
                              }));
                            }}
                          />
                          {constant.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <label className="automl-field">
                  <span>排序</span>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                  />
                </label>
                <div className="automl-field">
                  <span>状态</span>
                  <label className="platform-status-toggle">
                    <input
                      type="checkbox"
                      checked={form.statusCd !== "DISABLED"}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        statusCd: event.target.checked ? "ENABLED" : "DISABLED",
                      }))}
                    />
                    <i aria-hidden="true" />
                    <span>{form.statusCd !== "DISABLED" ? "启用" : "停用"}</span>
                  </label>
                </div>
                <label className="automl-field automl-field-wide">
                  <span>描述</span>
                  <textarea
                    rows={2}
                    value={form.description}
                    placeholder="平台用途说明，选填"
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
              </div>
              {formError ? <p className="device-detail-hint is-error" role="alert">{formError}</p> : null}
              <div className="automl-actions">
                <button className="primary-button" type="button" disabled={saving || detailLoading} onClick={() => void submitPlatform()}>
                  {saving ? <LoaderCircle size={14} className="spinner" /> : null}
                  {saving ? "正在保存" : mode === "create" ? "创建平台" : "保存平台"}
                </button>
              </div>
            </article>
          ) : null}

          {editing ? (
            <>
              <article className="panel platform-section">
                <h3 className="device-section-title">训练参数 Schema <small>JSON Schema，properties 中的参数会展示给训练表单</small></h3>
                <textarea
                  className={`platform-schema-editor${schemaError ? " is-invalid" : ""}`}
                  rows={8}
                  spellCheck={false}
                  value={form.schemaText}
                  placeholder='{"type":"object","properties":{"epochs":{"type":"integer","default":50,"minimum":1}}}'
                  aria-label="训练参数 Schema JSON"
                  onBlur={validateSchemaText}
                  onChange={(event) => setForm((current) => ({ ...current, schemaText: event.target.value }))}
                />
                {schemaError ? (
                  <p className="device-detail-hint is-error" role="alert">Schema JSON 不合法：{schemaError}</p>
                ) : (
                  <p className="device-detail-hint">失焦时自动校验 JSON；properties 参数会渲染为下方只读卡片。</p>
                )}
                {schemaProperties.length ? (
                  <div className="platform-schema-params">
                    {schemaProperties.map(([name, property]) => (
                      <div className="platform-schema-param" key={name}>
                        <strong title={name}>{name}</strong>
                        <span>{property?.type ?? "未声明类型"}</span>
                        <small>
                          默认值：{property && "default" in property ? JSON.stringify(property.default) ?? "—" : "—"}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : parsedSchema ? (
                  <p className="device-detail-hint">当前 Schema 未声明 properties。</p>
                ) : null}
              </article>

              <article className="panel platform-section">
                <div className="platform-section-heading">
                  <h3 className="device-section-title">基础模型 <small>共 {baseModels.length} 个</small></h3>
                  <button className="secondary-button compact" type="button" onClick={openBaseModelCreate}>
                    <Plus size={13} />
                    新建基础模型
                  </button>
                </div>
                {baseModelsLoading ? (
                  <p className="device-detail-hint"><LoaderCircle size={12} className="spinner" /> 正在读取基础模型…</p>
                ) : baseModels.length === 0 ? (
                  <p className="device-detail-hint">暂无基础模型。训练任务创建时从这里选择初始权重。</p>
                ) : (
                  <div className="base-model-table">
                    <div className="base-model-head" aria-hidden="true">
                      <span>编码</span>
                      <span>名称</span>
                      <span>任务类型</span>
                      <span>参数量</span>
                      <span>大小</span>
                      <span>状态</span>
                      <span className="base-model-actions-head">操作</span>
                    </div>
                    {baseModels.map((baseModel) => (
                      <div className="base-model-row" key={String(baseModel.id)}>
                        <span className="constants-code" title={baseModel.modelCode}>{baseModel.modelCode}</span>
                        <span className="constants-name" title={baseModel.name}>{baseModel.name}</span>
                        <span className="base-model-cell">{baseModel.taskType || "—"}</span>
                        <span className="base-model-cell">{formatNumber(baseModel.paramCount)}</span>
                        <span className="base-model-cell" title={baseModel.modelSizeBytes == null ? undefined : `${Number(baseModel.modelSizeBytes)} 字节`}>
                          {formatBytesMb(baseModel.modelSizeBytes)}
                        </span>
                        <span>
                          <span className="device-status-chip" data-status={baseModel.statusCd === "DISABLED" ? "DISABLED" : "ONLINE"}>
                            {statusCdLabels[baseModel.statusCd] ?? baseModel.statusCd}
                          </span>
                        </span>
                        <div className="base-model-actions">
                          <button className="secondary-button compact" type="button" onClick={() => openBaseModelEdit(baseModel)}>
                            <Pencil size={12} />
                            编辑
                          </button>
                          <button
                            className="secondary-button compact device-delete-button"
                            type="button"
                            onClick={() => setPendingDelete({ kind: "baseModel", platformId: selectedId, baseModel })}
                          >
                            <Trash2 size={12} />
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="panel platform-section">
                <button
                  className="secondary-button compact device-delete-button"
                  type="button"
                  onClick={() => {
                    const platform = platforms.find((candidate) => String(candidate.id) === selectedId);
                    if (platform) setPendingDelete({ kind: "platform", platform });
                  }}
                >
                  <Trash2 size={12} />
                  删除平台
                </button>
              </article>
            </>
          ) : null}
        </div>
      </div>

      {baseModelDialog ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog base-model-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="base-model-dialog-title"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Cpu size={18} /></span>
                <span>
                  <h2 id="base-model-dialog-title">
                    {baseModelDialog.kind === "edit" ? `编辑基础模型 · ${baseModelDialog.baseModel.name}` : "新建基础模型"}
                  </h2>
                  <p>基础模型是训练任务的初始权重来源；权重对象键由文件上传接口获得。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={baseModelSaving} onClick={() => setBaseModelDialog(null)}>×</button>
            </div>
            <div className="base-model-form-grid">
              <label className="automl-field">
                <span>编码</span>
                <input
                  value={baseModelForm.modelCode}
                  disabled={baseModelDialog.kind === "edit"}
                  placeholder="如 YOLOV8N"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, modelCode: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>名称</span>
                <input
                  value={baseModelForm.name}
                  placeholder="如 YOLOv8n"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>任务类型</span>
                <select
                  value={baseModelForm.taskType}
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, taskType: event.target.value }))}
                >
                  <option value="">未指定</option>
                  {taskTypeConstants.map((constant) => (
                    <option value={constant.code} key={String(constant.id)}>{constant.name}</option>
                  ))}
                </select>
              </label>
              <label className="automl-field automl-field-wide">
                <span>权重对象键 weightsObjectKey</span>
                <input
                  value={baseModelForm.weightsObjectKey}
                  placeholder="由文件上传接口获得"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, weightsObjectKey: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>参数量</span>
                <input
                  type="number"
                  value={baseModelForm.paramCount}
                  placeholder="如 31500400"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, paramCount: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>模型大小（字节）</span>
                <input
                  type="number"
                  value={baseModelForm.modelSizeBytes}
                  placeholder="如 63000000"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, modelSizeBytes: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>FLOPs</span>
                <input
                  type="number"
                  value={baseModelForm.flops}
                  placeholder="如 8700000000"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, flops: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>输入尺寸</span>
                <input
                  value={baseModelForm.inputSize}
                  placeholder="如 640x640"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, inputSize: event.target.value }))}
                />
              </label>
              <label className="automl-field automl-field-wide">
                <span>默认参数覆盖 JSON</span>
                <textarea
                  className="platform-schema-editor base-model-config-editor"
                  rows={4}
                  spellCheck={false}
                  value={baseModelForm.configText}
                  placeholder='{"epochs":100,"batch":16}'
                  onBlur={() => {
                    const { error: configError } = parseOptionalJson(baseModelForm.configText);
                    setBaseModelError(configError ? `默认参数覆盖 JSON 不合法：${configError}` : null);
                  }}
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, configText: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>排序</span>
                <input
                  type="number"
                  value={baseModelForm.sortOrder}
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, sortOrder: event.target.value }))}
                />
              </label>
              <label className="automl-field">
                <span>状态</span>
                <select
                  value={baseModelForm.statusCd}
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, statusCd: event.target.value }))}
                >
                  <option value="ENABLED">启用</option>
                  <option value="DISABLED">停用</option>
                </select>
              </label>
              <label className="automl-field automl-field-wide">
                <span>备注</span>
                <input
                  value={baseModelForm.remark}
                  placeholder="选填"
                  onChange={(event) => setBaseModelForm((current) => ({ ...current, remark: event.target.value }))}
                />
              </label>
            </div>
            {baseModelError ? <p className="device-detail-hint is-error" role="alert">{baseModelError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={baseModelSaving} onClick={() => setBaseModelDialog(null)}>取消</button>
              <button className="primary-button" type="button" disabled={baseModelSaving} onClick={() => void submitBaseModel()}>
                {baseModelSaving ? <LoaderCircle size={14} className="spinner" /> : null}
                {baseModelSaving ? "正在保存" : "保存"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog resource-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="platform-delete-title"
            aria-describedby="platform-delete-detail"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><AlertCircle size={18} /></span>
                <span>
                  <h2 id="platform-delete-title">
                    {pendingDelete.kind === "platform" ? "删除训练平台" : "删除基础模型"}
                  </h2>
                  <p>确定要删除「{pendingDelete.kind === "platform" ? pendingDelete.platform.name : pendingDelete.baseModel.name}」吗？</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={deleteBusy} onClick={() => setPendingDelete(null)}>×</button>
            </div>
            <p className="resource-action-detail" id="platform-delete-detail">
              {pendingDelete.kind === "platform"
                ? "删除后该平台及其基础模型不再可用于创建训练任务；已被训练任务引用的平台无法删除。"
                : "删除后该基础模型不再出现在训练任务的模型下拉里；已被训练任务引用的模型无法删除。"}
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={deleteBusy} onClick={() => setPendingDelete(null)}>取消</button>
              <button className="primary-button device-confirm-danger" type="button" disabled={deleteBusy} onClick={() => void confirmDelete()}>
                {deleteBusy ? "正在处理" : "删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
