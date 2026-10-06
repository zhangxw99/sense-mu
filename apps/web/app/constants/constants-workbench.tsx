"use client";

import {
  AlertCircle,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Tags,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type AutomlConstant,
  AUTOML_CONSTANT_TYPES,
  constantTypeLabels,
  createAutomlConstant,
  deleteAutomlConstant,
  listAutomlConstants,
  statusCdLabels,
  updateAutomlConstant,
} from "../../lib/automl-platform-api";

type DialogMode = { kind: "create" } | { kind: "edit"; constant: AutomlConstant } | null;

type PendingDelete = AutomlConstant | null;

type FormState = {
  constType: string;
  code: string;
  name: string;
  sortOrder: string;
  statusCd: string;
  remark: string;
};

const emptyForm: FormState = {
  constType: "TASK_TYPE",
  code: "",
  name: "",
  sortOrder: "0",
  statusCd: "ENABLED",
  remark: "",
};

export function ConstantsWorkbench() {
  const [constants, setConstants] = useState<AutomlConstant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadConstants = useCallback(async (constType: string) => {
    setLoading(true);
    try {
      const rows = await listAutomlConstants({ constType: constType || undefined });
      setConstants(rows);
      setError(null);
    } catch (reason) {
      setConstants([]);
      setError(reason instanceof Error ? reason.message : "常量列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConstants(typeFilter);
  }, [loadConstants, typeFilter]);

  function openCreate() {
    setForm(emptyForm);
    setFormError(null);
    setDialog({ kind: "create" });
  }

  function openEdit(constant: AutomlConstant) {
    setForm({
      constType: constant.constType,
      code: constant.code,
      name: constant.name,
      sortOrder: String(constant.sortOrder ?? 0),
      statusCd: constant.statusCd || "ENABLED",
      remark: constant.remark ?? "",
    });
    setFormError(null);
    setDialog({ kind: "edit", constant });
  }

  async function submitForm() {
    if (!form.name.trim()) {
      setFormError("请填写名称");
      return;
    }
    if (dialog?.kind === "create" && !form.code.trim()) {
      setFormError("请填写编码");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const sortOrder = Number(form.sortOrder);
      if (dialog?.kind === "edit") {
        await updateAutomlConstant(dialog.constant.id, {
          name: form.name.trim(),
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
          statusCd: form.statusCd,
          remark: form.remark.trim() || undefined,
        });
        setNotice(`常量「${form.name.trim()}」已更新`);
      } else {
        await createAutomlConstant({
          constType: form.constType,
          code: form.code.trim(),
          name: form.name.trim(),
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
          statusCd: form.statusCd,
          remark: form.remark.trim() || undefined,
        });
        setNotice(`常量「${form.name.trim()}」已创建`);
      }
      setDialog(null);
      await loadConstants(typeFilter);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const constant = pendingDelete;
    if (!constant) return;
    setDeleteBusy(true);
    try {
      await deleteAutomlConstant(constant.id);
      setNotice(`常量「${constant.name}」已删除`);
      setPendingDelete(null);
      await loadConstants(typeFilter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败，请稍后重试");
      setPendingDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="constants-page">
      <div className="devices-header">
        <div>
          <span className="eyebrow">平台 · 常量管理</span>
          <h1>常量管理</h1>
          <p>维护训练平台使用的常量字典：任务类型、训练框架等分组枚举。</p>
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
        <select
          className="asset-filter-select"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          aria-label="按分组筛选"
        >
          <option value="">全部分组</option>
          {AUTOML_CONSTANT_TYPES.map((type) => (
            <option value={type} key={type}>{constantTypeLabels[type] ?? type}</option>
          ))}
        </select>
        <button className="secondary-button compact" type="button" onClick={() => void loadConstants(typeFilter)} disabled={loading}>
          {loading ? <LoaderCircle size={13} className="spinner" /> : <RefreshCw size={13} />}
          刷新
        </button>
        <button className="primary-button compact constants-add-button" type="button" onClick={openCreate}>
          <Plus size={13} />
          新增常量
        </button>
        <span className="devices-count">共 {constants.length} 条常量</span>
      </div>

      {loading && constants.length === 0 ? (
        <article className="panel workbench-loading" aria-live="polite">
          <LoaderCircle size={20} className="spinner" />
          <span>正在读取常量…</span>
        </article>
      ) : constants.length === 0 ? (
        <article className="panel workbench-empty-state">
          <span className="empty-state-icon"><Tags size={20} /></span>
          <span className="eyebrow">常量管理</span>
          <h2>暂无常量</h2>
          <p>先新增任务类型或训练框架常量，训练平台的表单下拉会从这里取值。</p>
          <button className="primary-button" type="button" onClick={openCreate}>
            <Plus size={14} />
            新增常量
          </button>
        </article>
      ) : (
        <article className="panel constants-table">
          <div className="constants-table-head" aria-hidden="true">
            <span>分组</span>
            <span>编码</span>
            <span>名称</span>
            <span>排序</span>
            <span>状态</span>
            <span>备注</span>
            <span>更新时间</span>
            <span className="constants-actions-head">操作</span>
          </div>
          {constants.map((constant) => (
            <div className="constants-row" key={String(constant.id)}>
              <span className="constants-cell">{constantTypeLabels[constant.constType] ?? constant.constType}</span>
              <span className="constants-code" title={constant.code}>{constant.code}</span>
              <span className="constants-cell constants-name" title={constant.name}>{constant.name}</span>
              <span className="constants-cell">{constant.sortOrder}</span>
              <span>
                <span className="device-status-chip" data-status={constant.statusCd === "DISABLED" ? "DISABLED" : "ONLINE"}>
                  {statusCdLabels[constant.statusCd] ?? constant.statusCd}
                </span>
              </span>
              <span className="constants-cell" title={constant.remark ?? undefined}>{constant.remark || "—"}</span>
              <span className="constants-cell">{constant.updateTime || constant.createTime || "—"}</span>
              <div className="constants-actions">
                <button className="secondary-button compact" type="button" onClick={() => openEdit(constant)}>
                  <Pencil size={12} />
                  编辑
                </button>
                <button
                  className="secondary-button compact device-delete-button"
                  type="button"
                  onClick={() => setPendingDelete(constant)}
                >
                  <Trash2 size={12} />
                  删除
                </button>
              </div>
            </div>
          ))}
        </article>
      )}

      {dialog ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <section
            className="workbench-dialog constants-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="constants-dialog-title"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Tags size={18} /></span>
                <span>
                  <h2 id="constants-dialog-title">{dialog.kind === "edit" ? "编辑常量" : "新增常量"}</h2>
                  <p>编码与分组创建后不可修改，调整枚举名称、排序或状态。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={saving} onClick={() => setDialog(null)}>×</button>
            </div>
            <label className="device-dialog-field">
              <span>分组</span>
              <select
                className="device-dialog-select"
                value={form.constType}
                disabled={dialog.kind === "edit"}
                onChange={(event) => setForm((current) => ({ ...current, constType: event.target.value }))}
              >
                {AUTOML_CONSTANT_TYPES.map((type) => (
                  <option value={type} key={type}>{constantTypeLabels[type] ?? type}</option>
                ))}
              </select>
            </label>
            <label className="device-dialog-field">
              <span>编码</span>
              <input
                className="device-dialog-select constants-dialog-input"
                value={form.code}
                disabled={dialog.kind === "edit"}
                placeholder="如 OBJECT_DETECTION"
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
              />
            </label>
            <label className="device-dialog-field">
              <span>名称</span>
              <input
                className="device-dialog-select constants-dialog-input"
                value={form.name}
                placeholder="如 目标检测"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <div className="constants-dialog-pair">
              <label className="device-dialog-field">
                <span>排序</span>
                <input
                  className="device-dialog-select constants-dialog-input"
                  type="number"
                  value={form.sortOrder}
                  onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                />
              </label>
              <label className="device-dialog-field">
                <span>状态</span>
                <select
                  className="device-dialog-select"
                  value={form.statusCd}
                  onChange={(event) => setForm((current) => ({ ...current, statusCd: event.target.value }))}
                >
                  <option value="ENABLED">启用</option>
                  <option value="DISABLED">停用</option>
                </select>
              </label>
            </div>
            <label className="device-dialog-field">
              <span>备注</span>
              <input
                className="device-dialog-select constants-dialog-input"
                value={form.remark}
                placeholder="选填"
                onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
              />
            </label>
            {formError ? <p className="device-detail-hint is-error" role="alert">{formError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={saving} onClick={() => setDialog(null)}>取消</button>
              <button className="primary-button" type="button" disabled={saving} onClick={() => void submitForm()}>
                {saving ? <LoaderCircle size={14} className="spinner" /> : null}
                {saving ? "正在保存" : "保存"}
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
            aria-labelledby="constants-delete-title"
            aria-describedby="constants-delete-detail"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><AlertCircle size={18} /></span>
                <span>
                  <h2 id="constants-delete-title">删除常量</h2>
                  <p>确定要删除「{pendingDelete.name}」吗？</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={deleteBusy} onClick={() => setPendingDelete(null)}>×</button>
            </div>
            <p className="resource-action-detail" id="constants-delete-detail">
              删除后分组下拉不再出现该枚举；已被训练平台或基础模型引用的常量无法删除。
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={deleteBusy} onClick={() => setPendingDelete(null)}>
                取消
              </button>
              <button className="primary-button device-confirm-danger" type="button" disabled={deleteBusy} onClick={() => void confirmDelete()}>
                {deleteBusy ? "正在处理" : "删除常量"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
