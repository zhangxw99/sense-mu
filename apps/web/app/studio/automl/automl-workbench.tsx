"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Tags,
  Upload,
} from "lucide-react";
import {
  AutomlAnnotationTaskSummary,
  AutomlChunkedUploadProgress,
  AutomlDatasetCreated,
  AutomlDatasetModel,
  AutomlId,
  AutomlMaterial,
  AutomlUploadResult,
  AutomlUploadStatus,
  AutomlVersionDetail,
  createAutomlDatasetFromFiles,
  createAutomlStandardAnnotationTask,
  getAutomlDatasetVersionDetails,
  getAutomlUploadStatus,
  listAutomlAnnotationTasks,
  listAutomlDatasetMaterials,
  listAutomlDatasetModels,
  uploadAutomlFiles,
  uploadAutomlFileChunked,
  searchAutomlAlgorithms,
} from "../../../lib/automl-data-api";

const TASK_TYPES = [
  { value: "OBJECT_DETECTION", label: "目标检测" },
  { value: "CLASSIFICATION", label: "图像分类" },
  { value: "SEGMENTATION", label: "图像分割" },
];

type InspectorTab = "materials" | "versions" | "models";

const AUTOML_CONTEXT_STORAGE_KEY = "sensemu-automl-context";

type StoredAutomlContext = {
  datasetId: string;
  versionId: string;
};

function formatBytes(size: AutomlId): string {
  const bytes = Number(size);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

export function AutomlWorkbench() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<AutomlUploadResult[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<AutomlId[]>([]);
  const [datasetName, setDatasetName] = useState("");
  const [datasetTaskType, setDatasetTaskType] = useState("OBJECT_DETECTION");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [creatingDataset, setCreatingDataset] = useState(false);
  const [createdDataset, setCreatedDataset] = useState<AutomlDatasetCreated | null>(null);
  const [inspectorDatasetId, setInspectorDatasetId] = useState("");
  const [activeTab, setActiveTab] = useState<InspectorTab>("materials");
  const [inspecting, setInspecting] = useState(false);
  const [materials, setMaterials] = useState<AutomlMaterial[] | null>(null);
  const [versionDetail, setVersionDetail] = useState<AutomlVersionDetail | null>(null);
  const [models, setModels] = useState<AutomlDatasetModel[] | null>(null);
  const [versionIdInput, setVersionIdInput] = useState("");
  const [tasks, setTasks] = useState<AutomlAnnotationTaskSummary[] | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [taskMethod, setTaskMethod] = useState<"MANUAL" | "MODEL_ASSISTED">("MANUAL");
  const [creatingTask, setCreatingTask] = useState(false);
  const [chunkedUploading, setChunkedUploading] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<AutomlChunkedUploadProgress | null>(null);
  const [chunkedDeduplicated, setChunkedDeduplicated] = useState<boolean | null>(null);
  const [chunkSizeMb, setChunkSizeMb] = useState(5);
  const [statusUploadId, setStatusUploadId] = useState("");
  const [uploadStatus, setUploadStatus] = useState<AutomlUploadStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [algorithmTotal, setAlgorithmTotal] = useState<AutomlId | null>(null);

  const inspectorId = useMemo(() => inspectorDatasetId.trim(), [inspectorDatasetId]);

  const persistContext = useCallback((datasetId: string, versionId: string) => {
    try {
      window.localStorage.setItem(
        AUTOML_CONTEXT_STORAGE_KEY,
        JSON.stringify({ datasetId, versionId } satisfies StoredAutomlContext),
      );
    } catch {
      // 存储不可用时静默跳过，仅影响刷新后的自动恢复。
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const result = await searchAutomlAlgorithms({ limit: 1 });
        if (cancelled) return;
        setBackendStatus("online");
        setAlgorithmTotal(result.total);
      } catch {
        if (!cancelled) setBackendStatus("offline");
      }
      let stored: StoredAutomlContext | null = null;
      try {
        stored = JSON.parse(window.localStorage.getItem(AUTOML_CONTEXT_STORAGE_KEY) ?? "null") as StoredAutomlContext | null;
      } catch {
        stored = null;
      }
      if (cancelled || !stored?.datasetId) return;
      setInspectorDatasetId(stored.datasetId);
      if (stored.versionId) setVersionIdInput(stored.versionId);
      try {
        setInspecting(true);
        setMaterials(await listAutomlDatasetMaterials(stored.datasetId));
        setVersionDetail(await getAutomlDatasetVersionDetails(stored.datasetId));
        if (stored.versionId) {
          setTasks(await listAutomlAnnotationTasks(stored.datasetId, stored.versionId));
        }
      } catch {
        // 上次的 ID 已失效时静默忽略，保留输入框供手动修改。
      } finally {
        if (!cancelled) setInspecting(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (action: () => Promise<string | void>) => {
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (typeof message === "string") setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试");
    }
  }, []);

  const handleUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    void run(async () => {
      setUploading(true);
      try {
        const results = await uploadAutomlFiles(Array.from(files));
        setUploadedFiles((current) => {
          const seen = new Set(current.map((item) => item.fileId));
          return [...current, ...results.filter((item) => !seen.has(item.fileId))];
        });
        setSelectedFileIds((current) => [...new Set([...current, ...results.map((item) => item.fileId)])]);
        return `已上传 ${results.length} 个文件`;
      } finally {
        setUploading(false);
      }
    });
  }, [run]);

  const toggleFile = useCallback((fileId: AutomlId) => {
    setSelectedFileIds((current) => (
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]
    ));
  }, []);

  const handleChunkedUpload = useCallback((file: File | null) => {
    if (!file) return;
    void run(async () => {
      setChunkedUploading(true);
      setChunkedDeduplicated(null);
      setChunkProgress(null);
      try {
        const { result, deduplicated } = await uploadAutomlFileChunked(file, {
          chunkSize: chunkSizeMb * 1024 * 1024,
          onProgress: setChunkProgress,
        });
        setUploadedFiles((current) => (
          current.some((item) => item.fileId === result.fileId)
            ? current
            : [...current, { ...result, originName: result.originName || file.name }]
        ));
        setSelectedFileIds((current) => [...new Set([...current, result.fileId])]);
        setChunkedDeduplicated(deduplicated);
        return deduplicated
          ? `秒传命中：${file.name}（文件 #${result.fileId}）`
          : `分片上传完成：${file.name}（文件 #${result.fileId}）`;
      } finally {
        setChunkedUploading(false);
      }
    });
  }, [chunkSizeMb, run]);

  const handleStatusQuery = useCallback(() => {
    const uploadId = statusUploadId.trim();
    if (!uploadId) {
      setError("请填写分片上传会话 ID");
      return;
    }
    void run(async () => {
      setStatusLoading(true);
      try {
        setUploadStatus(await getAutomlUploadStatus(uploadId));
      } finally {
        setStatusLoading(false);
      }
    });
  }, [run, statusUploadId]);

  const handleCreateDataset = useCallback(() => {
    if (!datasetName.trim()) {
      setError("请填写数据集名称");
      return;
    }
    if (selectedFileIds.length === 0) {
      setError("请至少勾选一个已上传文件");
      return;
    }
    void run(async () => {
      setCreatingDataset(true);
      try {
        const dataset = await createAutomlDatasetFromFiles({
          dataFileIds: selectedFileIds,
          name: datasetName.trim(),
          description: datasetDescription.trim() || undefined,
          taskType: datasetTaskType,
        });
        setCreatedDataset(dataset);
        setInspectorDatasetId(String(dataset.id));
        setVersionIdInput(String(dataset.initialDatasetVersionId));
        setMaterials(null);
        setVersionDetail(null);
        setModels(null);
        setTasks(null);
        persistContext(String(dataset.id), String(dataset.initialDatasetVersionId));
        return `数据集创建成功：${dataset.datasetCode}（v1 版本 ${dataset.initialDatasetVersionId}）`;
      } finally {
        setCreatingDataset(false);
      }
    });
  }, [datasetDescription, datasetName, datasetTaskType, persistContext, run, selectedFileIds]);

  const loadInspectorTab = useCallback((tab: InspectorTab, datasetId: string) => {
    void run(async () => {
      setInspecting(true);
      setActiveTab(tab);
      try {
        if (tab === "materials") setMaterials(await listAutomlDatasetMaterials(datasetId));
        if (tab === "versions") setVersionDetail(await getAutomlDatasetVersionDetails(datasetId));
        if (tab === "models") setModels(await listAutomlDatasetModels(datasetId));
        persistContext(datasetId, versionIdInput.trim());
      } finally {
        setInspecting(false);
      }
    });
  }, [persistContext, run, versionIdInput]);

  const loadTasks = useCallback((datasetId: string, versionId: string) => {
    void run(async () => {
      setTasksLoading(true);
      try {
        setTasks(await listAutomlAnnotationTasks(datasetId, versionId));
      } finally {
        setTasksLoading(false);
      }
    });
  }, [run]);

  const handleCreateTask = useCallback(() => {
    if (!inspectorId) {
      setError("请先填写数据集 ID");
      return;
    }
    if (!versionIdInput.trim()) {
      setError("请填写数据集版本 ID");
      return;
    }
    if (!taskName.trim()) {
      setError("请填写任务名称");
      return;
    }
    void run(async () => {
      setCreatingTask(true);
      try {
        const task = await createAutomlStandardAnnotationTask({
          datasetId: inspectorId,
          datasetVersionId: versionIdInput.trim(),
          name: taskName.trim(),
          method: taskMethod,
        });
        setTasks(null);
        return `标注任务创建成功：${task.name}（${task.statusCd}）`;
      } finally {
        setCreatingTask(false);
      }
    });
  }, [inspectorId, run, taskMethod, taskName, versionIdInput]);

  return (
    <section className="data-workbench" id="automl-workbench">
      <div className="data-content">
        <div className={`automl-backend-status${backendStatus === "online" ? " is-online" : ""}`} role="status">
          <i aria-hidden="true" />
          {backendStatus === "checking"
            ? "正在连接 sz-boot 后端…"
            : backendStatus === "online"
              ? `sz-boot 后端已连接 · 算法库 ${algorithmTotal} 个 · 接口前缀 /sz-api/automl`
              : "无法连接 sz-boot 后端（127.0.0.1:9992），请确认服务已启动"}
        </div>
        {error ? (
          <div className="workbench-message error-message" role="alert">
            <span>{error}</span>
            <button className="workbench-message-dismiss" type="button" onClick={() => setError(null)}>关闭</button>
          </div>
        ) : null}
        {notice ? (
          <div className="workbench-message notice-message" role="status">
            <span>{notice}</span>
            <button className="workbench-message-dismiss" type="button" onClick={() => setNotice(null)}>关闭</button>
          </div>
        ) : null}

        <article className="panel automl-panel">
          <header className="automl-panel-header">
            <span className="dataset-object-mark"><Upload size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>1 · 上传素材文件</h2>
              <p className="automl-panel-hint">直传 sz-boot（MD5 秒传）；大文件分片上传待客户端 MD5 方案落地后接入。</p>
            </div>
          </header>
          <label className="primary-button automl-upload-button">
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={(event) => {
                handleUpload(event.target.files);
                event.target.value = "";
              }}
            />
            {uploading ? <LoaderCircle size={16} className="spinner" /> : <Upload size={16} />}
            选择文件并上传
          </label>
          {uploadedFiles.length > 0 ? (
            <ul className="automl-file-list">
              {uploadedFiles.map((file) => (
                <li key={file.fileId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedFileIds.includes(file.fileId)}
                      onChange={() => toggleFile(file.fileId)}
                    />
                    <span className="automl-file-name">{file.originName}</span>
                    <span className="automl-file-meta">#{file.fileId} · {formatBytes(file.size)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="automl-panel-hint">尚未上传文件。</p>
          )}
          <div className="automl-subpanel">
            <h3>大文件分片上传</h3>
            <div className="automl-actions">
              <label className="secondary-button automl-upload-button">
                <input
                  type="file"
                  accept="image/*,video/*"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    handleChunkedUpload(file);
                    event.target.value = "";
                  }}
                />
                {chunkedUploading ? <LoaderCircle size={16} className="spinner" /> : <Upload size={16} />}
                选择大文件（大于 20MB 建议）
              </label>
              <label className="automl-field automl-field-inline">
                <span>分片大小</span>
                <select value={chunkSizeMb} disabled={chunkedUploading} onChange={(event) => setChunkSizeMb(Number(event.target.value))}>
                  <option value={1}>1 MB</option>
                  <option value={5}>5 MB</option>
                  <option value={10}>10 MB</option>
                  <option value={20}>20 MB</option>
                </select>
              </label>
            </div>
            {chunkProgress ? (
              <div className="automl-progress">
                <div className="automl-progress-bar">
                  <i style={{ width: `${Math.round((chunkProgress.uploadedChunks / chunkProgress.totalChunks) * 100)}%` }} />
                </div>
                <span className="automl-file-meta">
                  {chunkedDeduplicated ? "秒传完成" : `分片 ${chunkProgress.uploadedChunks}/${chunkProgress.totalChunks}`}
                </span>
              </div>
            ) : null}
          </div>
          <div className="automl-subpanel">
            <h3>上传状态查询（断点续传）</h3>
            <div className="automl-actions">
              <input
                className="automl-inline-input"
                value={statusUploadId}
                onChange={(event) => setStatusUploadId(event.target.value)}
                placeholder="分片上传会话 ID（uploadId）"
              />
              <button className="secondary-button" type="button" disabled={statusLoading || !statusUploadId.trim()} onClick={handleStatusQuery}>
                {statusLoading ? <LoaderCircle size={16} className="spinner" /> : <RefreshCw size={16} />}
                查询状态
              </button>
            </div>
            {uploadStatus ? (
              <p className="automl-panel-hint">
                {uploadStatus.fileName} · {uploadStatus.status} ·{" "}
                已传 {uploadStatus.uploadedChunks.length}/{uploadStatus.totalChunks} 片 ·{" "}
                {formatBytes(uploadStatus.receivedBytes)}/{formatBytes(uploadStatus.fileSize)}
              </p>
            ) : null}
          </div>
        </article>

        <article className="panel automl-panel">
          <header className="automl-panel-header">
            <span className="dataset-object-mark"><Database size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>2 · 创建数据集</h2>
              <p className="automl-panel-hint">使用勾选的文件创建数据集，服务端自动生成 v1 版本（样本全部在 train 划分）。</p>
            </div>
          </header>
          <div className="automl-form-grid">
            <label className="automl-field">
              <span>数据集名称</span>
              <input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="如：安全帽数据集" />
            </label>
            <label className="automl-field">
              <span>任务类型</span>
              <select value={datasetTaskType} onChange={(event) => setDatasetTaskType(event.target.value)}>
                {TASK_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="automl-field automl-field-wide">
              <span>描述（可选）</span>
              <input value={datasetDescription} onChange={(event) => setDatasetDescription(event.target.value)} placeholder="数据集说明" />
            </label>
          </div>
          <div className="automl-actions">
            <span className="automl-panel-hint">已勾选 {selectedFileIds.length} 个文件</span>
            <button className="primary-button" type="button" disabled={creatingDataset} onClick={handleCreateDataset}>
              {creatingDataset ? <LoaderCircle size={16} className="spinner" /> : null}
              创建数据集
            </button>
          </div>
          {createdDataset ? (
            <p className="automl-panel-hint">
              最近创建：{createdDataset.name} · id {createdDataset.id} · 编码 {createdDataset.datasetCode} · v{createdDataset.initialDatasetVersionId}
            </p>
          ) : null}
        </article>

        <article className="panel automl-panel">
          <header className="automl-panel-header">
            <span className="dataset-object-mark"><RefreshCw size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>3 · 数据集查看器</h2>
              <p className="automl-panel-hint">输入数据集数字 ID 查看素材、版本统计与关联模型（数据集列表接口待后端 P0-1 补齐后接入）。</p>
            </div>
          </header>
          <div className="automl-actions">
            <input
              className="automl-inline-input"
              value={inspectorDatasetId}
              onChange={(event) => setInspectorDatasetId(event.target.value)}
              placeholder="数据集数字 ID，如 910001"
            />
            <button
              className="secondary-button"
              type="button"
              disabled={inspecting || !inspectorId}
              onClick={() => loadInspectorTab(activeTab, inspectorId)}
            >
              {inspecting ? <LoaderCircle size={16} className="spinner" /> : <RefreshCw size={16} />}
              查询当前页签
            </button>
          </div>
          <nav className="dataset-view-tabs" aria-label="数据集视图">
            <button type="button" className={activeTab === "materials" ? "is-active" : ""} onClick={() => inspectorId && loadInspectorTab("materials", inspectorId)}>素材</button>
            <button type="button" className={activeTab === "versions" ? "is-active" : ""} onClick={() => inspectorId && loadInspectorTab("versions", inspectorId)}>版本</button>
            <button type="button" className={activeTab === "models" ? "is-active" : ""} onClick={() => inspectorId && loadInspectorTab("models", inspectorId)}>模型</button>
          </nav>
          {activeTab === "materials" ? (
            materials ? (
              <table className="automl-table">
                <thead><tr><th>文件</th><th>大小</th><th>样本数</th><th>划分</th><th>标注</th></tr></thead>
                <tbody>
                  {materials.map((material) => (
                    <tr key={material.id}>
                      <td>{material.originName}</td>
                      <td>{formatBytes(material.size)}</td>
                      <td>{material.samples.length}</td>
                      <td>{[...new Set(material.samples.map((sample) => sample.splitType))].join("/") || "-"}</td>
                      <td>{material.samples.some((sample) => sample.annotation) ? "有" : "无"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="automl-panel-hint">输入 ID 后查询素材。</p>
          ) : null}
          {activeTab === "versions" ? (
            versionDetail ? (
              <table className="automl-table">
                <thead><tr><th>版本</th><th>状态</th><th>样本</th><th>图片</th><th>类别样本</th></tr></thead>
                <tbody>
                  {versionDetail.versions.map((version) => (
                    <tr key={version.id}>
                      <td>{version.version}</td>
                      <td>{version.statusCd}</td>
                      <td>{version.sampleCount}</td>
                      <td>{version.imageCount}</td>
                      <td>{version.classSampleStats.map((stat) => `${stat.className}:${stat.sampleCount}`).join("，") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="automl-panel-hint">输入 ID 后查询版本统计。</p>
          ) : null}
          {activeTab === "models" ? (
            models ? (
              models.length > 0 ? (
                <table className="automl-table">
                  <thead><tr><th>模型</th><th>版本</th><th>训练任务</th><th>状态</th></tr></thead>
                  <tbody>
                    {models.map((item) => (
                      <tr key={item.modelVersionId}>
                        <td>{item.modelName}</td>
                        <td>{item.modelVersion}</td>
                        <td>{item.trainingTask?.name ?? "-"}</td>
                        <td>{item.trainingTask?.statusCd ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="automl-panel-hint">该数据集暂无关联模型。</p>
            ) : <p className="automl-panel-hint">输入 ID 后查询关联模型。</p>
          ) : null}
        </article>

        <article className="panel automl-panel">
          <header className="automl-panel-header">
            <span className="dataset-object-mark"><Tags size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>4 · 标注任务</h2>
              <p className="automl-panel-hint">基于数据集 + 版本创建标准标注任务，创建后自动填入任务名称供确认。</p>
            </div>
          </header>
          <div className="automl-form-grid">
            <label className="automl-field">
              <span>数据集 ID</span>
              <input value={inspectorDatasetId} onChange={(event) => setInspectorDatasetId(event.target.value)} placeholder="与上方查看器共用" />
            </label>
            <label className="automl-field">
              <span>版本 ID</span>
              <input value={versionIdInput} onChange={(event) => setVersionIdInput(event.target.value)} placeholder="如 920001" />
            </label>
            <label className="automl-field">
              <span>任务名称</span>
              <input value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="如：安全帽标注任务" />
            </label>
            <label className="automl-field">
              <span>标注方式</span>
              <select value={taskMethod} onChange={(event) => setTaskMethod(event.target.value as "MANUAL" | "MODEL_ASSISTED")}>
                <option value="MANUAL">手动标注</option>
                <option value="MODEL_ASSISTED">智能预标注</option>
              </select>
            </label>
          </div>
          <div className="automl-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={tasksLoading || !inspectorId || !versionIdInput.trim()}
              onClick={() => loadTasks(inspectorId, versionIdInput.trim())}
            >
              {tasksLoading ? <LoaderCircle size={16} className="spinner" /> : <ListChecks size={16} />}
              查询任务列表
            </button>
            <button className="primary-button" type="button" disabled={creatingTask} onClick={handleCreateTask}>
              {creatingTask ? <LoaderCircle size={16} className="spinner" /> : null}
              创建标准任务
            </button>
          </div>
          {tasks ? (
            tasks.length > 0 ? (
              <table className="automl-table">
                <thead><tr><th>任务</th><th>方式</th><th>进度</th><th>状态</th></tr></thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={`${task.name}-${task.method}`}>
                      <td>{task.name}</td>
                      <td>{task.method}</td>
                      <td>{task.annotatedItemCount}/{task.totalItemCount}</td>
                      <td>{task.statusCd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="automl-panel-hint">该版本暂无标注任务。</p>
          ) : null}
        </article>
      </div>
    </section>
  );
}
