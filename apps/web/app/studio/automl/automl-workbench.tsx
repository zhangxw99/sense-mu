"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookmarkPlus,
  Database,
  FileImage,
  FolderOpen,
  ListChecks,
  LoaderCircle,
  PenLine,
  RefreshCw,
  Tags,
  Upload,
} from "lucide-react";
import Link from "next/link";
import {
  AutomlAlgorithmDetail,
  AutomlAlgorithmSearchItem,
  AutomlAnnotationTaskSummary,
  AutomlAnnotation,
  AutomlDatasetClass,
  AutomlChunkedUploadProgress,
  AutomlDatasetCreated,
  AutomlDataset,
  AutomlDatasetModel,
  AutomlDatasetItem,
  AutomlId,
  AutomlMaterial,
  AutomlFileUrl,
  AutomlUploadResult,
  AutomlUploadStatus,
  AutomlVersionDetail,
  createAutomlDatasetClass,
  createAutomlDatasetFromFiles,
  createAutomlStandardAnnotationTask,
  deleteAutomlDatasetClass,
  getAutomlDatasetVersionDetails,
  getAutomlAlgorithmDetail,
  getAutomlFileUrls,
  getAutomlUploadStatus,
  listAutomlAnnotations,
  listAutomlDatasetClasses,
  listAutomlDatasetItems,
  listAutomlDatasets,
  listAutomlAnnotationTasks,
  listAutomlDatasetMaterials,
  listAutomlDatasetModels,
  saveAutomlAnnotations,
  setAutomlDataApiToken,
  uploadAutomlFiles,
  uploadAutomlFileChunked,
  searchAutomlAlgorithms,
  updateAutomlDatasetClass,
  updateAutomlDatasetItemSplits,
} from "../../../lib/automl-data-api";
import { DynamicAssetImage } from "../../components/dynamic-asset-image";

const TASK_TYPES = [
  { value: "OBJECT_DETECTION", label: "目标检测" },
  { value: "CLASSIFICATION", label: "图像分类" },
  { value: "SEGMENTATION", label: "图像分割" },
];

type InspectorTab = "materials" | "versions" | "models" | "items" | "classes";

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
  const [datasetClassNamesDraft, setDatasetClassNamesDraft] = useState("");
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
  const [tokenInput, setTokenInput] = useState("");
  const [tokenApplied, setTokenApplied] = useState(false);
  const [algorithmQueryName, setAlgorithmQueryName] = useState("");
  const [algorithmRows, setAlgorithmRows] = useState<AutomlAlgorithmSearchItem[] | null>(null);
  const [algorithmSearchLoading, setAlgorithmSearchLoading] = useState(false);
  const [algorithmDetail, setAlgorithmDetail] = useState<AutomlAlgorithmDetail | null>(null);
  const [algorithmLoading, setAlgorithmLoading] = useState(false);
  const [fileUrls, setFileUrls] = useState<AutomlFileUrl[] | null>(null);
  const [datasetQuery, setDatasetQuery] = useState({ name: "", taskType: "", statusCd: "", page: 1 });
  const [datasets, setDatasets] = useState<AutomlDataset[] | null>(null);
  const [datasetListLoading, setDatasetListLoading] = useState(false);
  const [items, setItems] = useState<AutomlDatasetItem[] | null>(null);
  const [itemUrls, setItemUrls] = useState<Record<string, string>>({});
  const [itemTotal, setItemTotal] = useState<AutomlId | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemPage, setItemPage] = useState(1);
  const [classes, setClasses] = useState<AutomlDatasetClass[] | null>(null);
  const [classForm, setClassForm] = useState({ classCode: "", className: "", color: "#1677ff", sortNo: 0, statusCd: "ENABLED" });
  const [selectedClassId, setSelectedClassId] = useState("");
  const [classSaving, setClassSaving] = useState(false);
  const [annotationItemId, setAnnotationItemId] = useState("");
  const [annotationTaskIdInput, setAnnotationTaskIdInput] = useState("");
  const [annotations, setAnnotations] = useState<AutomlAnnotation[] | null>(null);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState(JSON.stringify([
    { labelName: "", annotationJson: { type: "bbox", x: 0.1, y: 0.1, w: 0.3, h: 0.3 } },
  ], null, 2));

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

  const applyToken = useCallback(() => {
    setAutomlDataApiToken(tokenInput.trim() || null);
    setTokenApplied(Boolean(tokenInput.trim()));
    if (!tokenInput.trim()) {
      setNotice("已清空令牌");
      return;
    }
    void run(async () => {
      const result = await searchAutomlAlgorithms({ limit: 1 });
      setBackendStatus("online");
      setAlgorithmTotal(result.total);
      return "令牌已注入并重新校验连接";
    });
  }, [run, tokenInput]);

  const searchAlgorithmRows = useCallback(() => {
    void run(async () => {
      setAlgorithmSearchLoading(true);
      try {
        const result = await searchAutomlAlgorithms({
          name: algorithmQueryName.trim() || undefined,
          limit: 10,
        });
        setAlgorithmRows(result.rows);
        setAlgorithmTotal(result.total);
        return `算法库共 ${result.total} 个，当前显示 ${result.rows.length} 个`;
      } finally {
        setAlgorithmSearchLoading(false);
      }
    });
  }, [algorithmQueryName, run]);

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
        const classNames = datasetClassNamesDraft
          .split(/[\n,，]/)
          .map((entry) => entry.trim())
          .filter(Boolean);
        const dataset = await createAutomlDatasetFromFiles({
          dataFileIds: selectedFileIds,
          name: datasetName.trim(),
          description: datasetDescription.trim() || undefined,
          taskType: datasetTaskType,
          classNames: classNames.length ? classNames : undefined,
        });
        setCreatedDataset(dataset);
        setInspectorDatasetId(String(dataset.id));
        setVersionIdInput(String(dataset.initialDatasetVersionId));
        setMaterials(null);
        setVersionDetail(null);
        setModels(null);
        setItems(null);
        setClasses(null);
        setTasks(null);
        persistContext(String(dataset.id), String(dataset.initialDatasetVersionId));
        return `数据集创建成功：${dataset.datasetCode}（v1 版本 ${dataset.initialDatasetVersionId}）`;
      } finally {
        setCreatingDataset(false);
      }
    });
  }, [datasetClassNamesDraft, datasetDescription, datasetName, datasetTaskType, persistContext, run, selectedFileIds]);

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
        setAnnotationTaskIdInput(String(task.id));
        setTasks(null);
        return `标注任务创建成功：${task.name}（${task.statusCd}）`;
      } finally {
        setCreatingTask(false);
      }
    });
  }, [inspectorId, run, taskMethod, taskName, versionIdInput]);

  const loadFileUrls = useCallback(() => {
    const objectKeys = uploadedFiles.filter((file) => selectedFileIds.includes(file.fileId)).map((file) => file.objectKey);
    if (objectKeys.length === 0) {
      setError("请先勾选已上传文件");
      return;
    }
    void run(async () => {
      setFileUrls(await getAutomlFileUrls(objectKeys));
    });
  }, [run, selectedFileIds, uploadedFiles]);

  const loadDatasets = useCallback((page = datasetQuery.page) => {
    void run(async () => {
      setDatasetListLoading(true);
      try {
        const result = await listAutomlDatasets({ ...datasetQuery, page });
        setDatasets(result.rows);
        setDatasetQuery((current) => ({ ...current, page }));
      } finally {
        setDatasetListLoading(false);
      }
    });
  }, [datasetQuery, run]);

  const loadItems = useCallback((page = itemPage) => {
    const datasetId = inspectorDatasetId.trim();
    const versionId = versionIdInput.trim();
    if (!datasetId || !versionId) {
      setError("请填写数据集 ID 和版本 ID");
      return;
    }
    void run(async () => {
      setItemsLoading(true);
      setActiveTab("items");
      try {
        const result = await listAutomlDatasetItems(datasetId, versionId, { page, limit: 10 });
        setItems(result.rows);
        setItemTotal(result.total);
        setItemPage(page);
        const objectKeys = result.rows.map((row) => row.sampleObjectKey).filter(Boolean);
        if (objectKeys.length) {
          try {
            const urls = await getAutomlFileUrls(objectKeys);
            setItemUrls(Object.fromEntries(urls.map((entry) => [entry.objectKey, entry.url])));
          } catch {
            // 缩略图获取失败不阻断样本列表，仅退化为占位图标。
            setItemUrls({});
          }
        } else {
          setItemUrls({});
        }
      } finally {
        setItemsLoading(false);
      }
    });
  }, [inspectorDatasetId, itemPage, run, versionIdInput]);

  const loadClasses = useCallback(() => {
    const datasetId = inspectorDatasetId.trim();
    if (!datasetId) {
      setError("请填写数据集 ID");
      return;
    }
    void run(async () => {
      setActiveTab("classes");
      setClasses(await listAutomlDatasetClasses(datasetId));
    });
  }, [inspectorDatasetId, run]);

  const handleSaveClass = useCallback(() => {
    const datasetId = inspectorDatasetId.trim();
    if (!datasetId) {
      setError("请填写数据集 ID");
      return;
    }
    if (!classForm.classCode.trim() || !classForm.className.trim()) {
      setError("请填写类别编码和名称");
      return;
    }
    void run(async () => {
      setClassSaving(true);
      const body = {
        classCode: classForm.classCode.trim(),
        className: classForm.className.trim(),
        color: classForm.color || undefined,
        sortNo: classForm.sortNo,
        statusCd: classForm.statusCd as "ENABLED" | "DISABLED",
      };
      try {
        if (selectedClassId) {
          await updateAutomlDatasetClass(datasetId, selectedClassId, {
            ...body,
            datasetId,
            classIndex: classes?.find((item) => String(item.id) === selectedClassId)?.classIndex ?? 0,
          });
        } else {
          await createAutomlDatasetClass(datasetId, body);
        }
        setClasses(await listAutomlDatasetClasses(datasetId));
        return selectedClassId ? "类别已更新" : "类别已创建";
      } finally {
        setClassSaving(false);
      }
    });
  }, [classForm, classes, inspectorDatasetId, run, selectedClassId]);

  const handleDeleteClass = useCallback((classId: AutomlId) => {
    const datasetId = inspectorDatasetId.trim();
    if (!datasetId) return;
    void run(async () => {
      await deleteAutomlDatasetClass(datasetId, classId);
      setClasses(await listAutomlDatasetClasses(datasetId));
      return "类别已删除";
    });
  }, [inspectorDatasetId, run]);

  const handleUpdateSplit = useCallback((itemId: AutomlId, splitType: string) => {
    const datasetId = inspectorDatasetId.trim();
    const versionId = versionIdInput.trim();
    if (!datasetId || !versionId) {
      setError("请填写数据集 ID 和版本 ID");
      return;
    }
    void run(async () => {
      await updateAutomlDatasetItemSplits(datasetId, versionId, [{ itemId, splitType: splitType as "train" | "val" | "test" }]);
      const result = await listAutomlDatasetItems(datasetId, versionId, { page: itemPage, limit: 10 });
      setItems(result.rows);
      return "样本划分已更新";
    });
  }, [inspectorDatasetId, itemPage, run, versionIdInput]);

  const loadAnnotations = useCallback((itemId: AutomlId = annotationItemId.trim()) => {
    const datasetId = inspectorDatasetId.trim();
    const versionId = versionIdInput.trim();
    if (!datasetId || !versionId || !itemId) {
      setError("请填写数据集、版本和样本 ID");
      return;
    }
    void run(async () => {
      setAnnotationLoading(true);
      const normalizedItemId = String(itemId);
      setAnnotationItemId(normalizedItemId);
      try {
        setAnnotations(await listAutomlAnnotations(datasetId, versionId, normalizedItemId, annotationTaskIdInput.trim() || undefined));
      } finally {
        setAnnotationLoading(false);
      }
    });
  }, [annotationItemId, annotationTaskIdInput, inspectorDatasetId, run, versionIdInput]);

  const handleSaveAnnotations = useCallback(() => {
    const datasetId = inspectorDatasetId.trim();
    const versionId = versionIdInput.trim();
    const itemId = annotationItemId.trim();
    const taskId = annotationTaskIdInput.trim();
    if (!datasetId || !versionId || !itemId || !taskId) {
      setError("保存标注需要数据集、版本、样本和任务 ID");
      return;
    }
    let parsedAnnotations;
    try {
      parsedAnnotations = JSON.parse(annotationDraft);
      if (!Array.isArray(parsedAnnotations)) throw new Error("not array");
    } catch {
      setError("标注 JSON 必须是数组");
      return;
    }
    void run(async () => {
      setAnnotationSaving(true);
      try {
        setAnnotations(await saveAutomlAnnotations(datasetId, versionId, itemId, {
          annotationTaskId: taskId,
          annotations: parsedAnnotations,
        }));
        return "样本标注已保存";
      } finally {
        setAnnotationSaving(false);
      }
    });
  }, [annotationDraft, annotationItemId, annotationTaskIdInput, inspectorDatasetId, run, versionIdInput]);

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
        <div className="automl-subpanel">
          <h3>后端访问令牌</h3>
          <div className="automl-actions">
            <input
              className="automl-inline-input"
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="粘贴 Bruno「AutoML 登录」返回的 accessToken"
              aria-label="后端访问令牌"
            />
            <button className="secondary-button" type="button" onClick={applyToken}>
              {tokenApplied ? "重新注入" : "注入令牌"}
            </button>
          </div>
          <p className="automl-panel-hint">
            {tokenApplied
              ? "令牌已注入页面内存（不写入浏览器存储），刷新页面后需重新注入。"
              : "当前后端已将 /automl/** 加入白名单，可不注入令牌直接联调；恢复鉴权后再用 Bruno「AutoML 登录」取 accessToken 粘贴到这里。"}
          </p>
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
            <span className="dataset-object-mark"><FolderOpen size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>1 · 算法库</h2>
              <p className="automl-panel-hint">按名称模糊搜索算法，点击「详情」读取元信息、训练指标与输入输出 Schema。</p>
            </div>
          </header>
          <div className="automl-actions">
            <input
              className="automl-inline-input"
              value={algorithmQueryName}
              onChange={(event) => setAlgorithmQueryName(event.target.value)}
              placeholder="算法名称，如：安全帽"
              aria-label="算法名称搜索"
            />
            <button className="secondary-button" type="button" disabled={algorithmSearchLoading} onClick={searchAlgorithmRows}>
              {algorithmSearchLoading ? <LoaderCircle size={16} className="spinner" /> : <RefreshCw size={16} />}
              搜索算法
            </button>
            <span className="automl-panel-hint">算法库共 {algorithmTotal ?? "-"} 个</span>
          </div>
          {algorithmRows ? (
            algorithmRows.length > 0 ? (
              <table className="automl-table">
                <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>场景</th><th>描述</th><th>操作</th></tr></thead>
                <tbody>
                  {algorithmRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.id}</td>
                      <td>{row.model_name}</td>
                      <td>{row.model_type ?? "-"}</td>
                      <td>{row.model_scene ?? "-"}</td>
                      <td title={row.model_description ?? undefined}>{row.model_description ?? "-"}</td>
                      <td>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={algorithmLoading}
                          onClick={() => {
                            void run(async () => {
                              setAlgorithmLoading(true);
                              try {
                                setAlgorithmDetail(await getAutomlAlgorithmDetail(row.id));
                              } finally {
                                setAlgorithmLoading(false);
                              }
                            });
                          }}
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="automl-panel-hint">没有匹配的算法。</p>
          ) : (
            <p className="automl-panel-hint">页面加载时已按空条件探测连通性；输入名称后点击搜索查看列表。</p>
          )}
          {algorithmDetail ? (
            <pre className="automl-panel-hint">{JSON.stringify(algorithmDetail, null, 2)}</pre>
          ) : null}
        </article>

        <article className="panel automl-panel">
          <header className="automl-panel-header">
            <span className="dataset-object-mark"><Upload size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>2 · 上传素材文件</h2>
              <p className="automl-panel-hint">支持单文件、批量、分片、状态查询和批量获取临时访问 URL。</p>
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
          <div className="automl-actions">
            <button className="secondary-button" type="button" disabled={selectedFileIds.length === 0} onClick={loadFileUrls}>
              <FolderOpen size={16} />
              获取选中文件 URL
            </button>
          </div>
          {fileUrls ? (
            <table className="automl-table">
              <thead><tr><th>对象键</th><th>过期时间</th><th>访问地址</th></tr></thead>
              <tbody>
                {fileUrls.map((item) => (
                  <tr key={item.objectKey}>
                    <td>{item.objectKey}</td>
                    <td>{item.expiresAt}</td>
                    <td><a href={item.url} target="_blank" rel="noreferrer">打开文件</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
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
              <h2>3 · 创建数据集</h2>
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
            <label className="automl-field automl-field-wide">
              <span>初始类别（可选，逗号或换行分隔）</span>
              <textarea
                rows={2}
                value={datasetClassNamesDraft}
                onChange={(event) => setDatasetClassNamesDraft(event.target.value)}
                placeholder="如：helmet, person"
              />
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
            <span className="dataset-object-mark"><Database size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>4 · 数据集列表</h2>
              <p className="automl-panel-hint">分页查询最新版本统计，并可一键载入下方查看器。</p>
            </div>
          </header>
          <div className="automl-form-grid">
            <label className="automl-field"><span>名称</span><input value={datasetQuery.name} onChange={(event) => setDatasetQuery({ ...datasetQuery, name: event.target.value })} /></label>
            <label className="automl-field"><span>任务类型</span><input value={datasetQuery.taskType} onChange={(event) => setDatasetQuery({ ...datasetQuery, taskType: event.target.value })} placeholder="OBJECT_DETECTION" /></label>
            <label className="automl-field"><span>状态</span><input value={datasetQuery.statusCd} onChange={(event) => setDatasetQuery({ ...datasetQuery, statusCd: event.target.value })} placeholder="ENABLED" /></label>
            <label className="automl-field"><span>页码</span><input type="number" min={1} value={datasetQuery.page} onChange={(event) => setDatasetQuery({ ...datasetQuery, page: Number(event.target.value) || 1 })} /></label>
          </div>
          <div className="automl-actions">
            <button className="secondary-button" type="button" disabled={datasetListLoading} onClick={() => loadDatasets()}>
              {datasetListLoading ? <LoaderCircle size={16} className="spinner" /> : <RefreshCw size={16} />}
              查询数据集
            </button>
          </div>
          {datasets ? (
            datasets.length > 0 ? (
              <table className="automl-table">
                <thead><tr><th>名称</th><th>任务</th><th>样本</th><th>最新版本</th><th>操作</th></tr></thead>
                <tbody>
                  {datasets.map((dataset) => (
                    <tr key={dataset.id}>
                      <td>{dataset.name}</td>
                      <td>{dataset.taskType}</td>
                      <td>{dataset.sampleCount ?? "-"}</td>
                      <td>{dataset.latestVersionId ?? "-"}</td>
                      <td>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={!dataset.latestVersionId}
                          onClick={() => {
                            setInspectorDatasetId(String(dataset.id));
                            setVersionIdInput(String(dataset.latestVersionId));
                            setItems(null);
                            setClasses(null);
                          }}
                        >
                          载入
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="automl-panel-hint">暂无数据集。</p>
          ) : null}
        </article>

        <article className="panel automl-panel">
          <header className="automl-panel-header">
            <span className="dataset-object-mark"><RefreshCw size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>5 · 数据集查看器</h2>
              <p className="automl-panel-hint">分页查看素材、版本、模型、样本和类别，并直接维护样本划分与类别。</p>
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
            <button type="button" className={activeTab === "items" ? "is-active" : ""} onClick={() => loadItems(1)}>样本</button>
            <button type="button" className={activeTab === "classes" ? "is-active" : ""} onClick={loadClasses}>类别</button>
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
          {activeTab === "items" ? (
            items ? (
              items.length > 0 ? (
                <>
                  <table className="automl-table">
                    <thead><tr><th>预览</th><th>样本</th><th>划分</th><th>标注数</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>
                      {items.map((item) => {
                        const thumbUrl = itemUrls[item.sampleObjectKey];
                        const annotateHref = `/studio/automl/annotate?dataset=${encodeURIComponent(inspectorDatasetId.trim())}&version=${encodeURIComponent(versionIdInput.trim())}&item=${encodeURIComponent(String(item.itemId))}&from=automl`;
                        return (
                          <tr key={item.itemId}>
                            <td>
                              {thumbUrl ? (
                                <DynamicAssetImage
                                  src={thumbUrl}
                                  alt={item.originName ?? "样本预览"}
                                  style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, display: "block" }}
                                />
                              ) : (
                                <FileImage size={18} aria-hidden="true" />
                              )}
                            </td>
                            <td title={item.sampleObjectKey}>{item.originName ?? item.sampleObjectKey}</td>
                            <td>
                              <select defaultValue={item.splitType} onChange={(event) => handleUpdateSplit(item.itemId, event.target.value)}>
                                <option value="train">train</option>
                                <option value="val">val</option>
                                <option value="test">test</option>
                              </select>
                            </td>
                            <td>{item.annotatedItemCount}</td>
                            <td>{item.statusCd}</td>
                            <td>
                              <div className="automl-actions">
                                <Link className="secondary-button" href={annotateHref}><PenLine size={13} />可视化标注</Link>
                                <button className="secondary-button" type="button" onClick={() => loadAnnotations(item.itemId)}>JSON</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="automl-actions">
                    <button className="secondary-button" type="button" disabled={itemPage <= 1 || itemsLoading} onClick={() => loadItems(itemPage - 1)}>上一页</button>
                    <button className="secondary-button" type="button" disabled={Number(itemTotal ?? 0) <= itemPage * 10 || itemsLoading} onClick={() => loadItems(itemPage + 1)}>下一页</button>
                    <span className="automl-panel-hint">共 {itemTotal} 条</span>
                  </div>
                </>
              ) : <p className="automl-panel-hint">该版本暂无样本。</p>
            ) : <p className="automl-panel-hint">输入数据集和版本 ID 后查询样本。</p>
          ) : null}
          {activeTab === "classes" ? (
            <>
              <div className="automl-form-grid">
                <label className="automl-field"><span>类别编码</span><input value={classForm.classCode} disabled={Boolean(selectedClassId)} onChange={(event) => setClassForm({ ...classForm, classCode: event.target.value })} /></label>
                <label className="automl-field"><span>类别名称</span><input value={classForm.className} onChange={(event) => setClassForm({ ...classForm, className: event.target.value })} /></label>
                <label className="automl-field"><span>颜色</span><input value={classForm.color} onChange={(event) => setClassForm({ ...classForm, color: event.target.value })} /></label>
                <label className="automl-field"><span>排序</span><input type="number" value={classForm.sortNo} onChange={(event) => setClassForm({ ...classForm, sortNo: Number(event.target.value) || 0 })} /></label>
                <label className="automl-field"><span>状态</span>
                  <select value={classForm.statusCd} onChange={(event) => setClassForm({ ...classForm, statusCd: event.target.value })}>
                    <option value="ENABLED">启用</option>
                    <option value="DISABLED">停用</option>
                  </select>
                </label>
              </div>
              <div className="automl-actions">
                <button className="primary-button" type="button" disabled={classSaving} onClick={handleSaveClass}>
                  {classSaving ? <LoaderCircle size={16} className="spinner" /> : <BookmarkPlus size={16} />}
                  {selectedClassId ? "更新类别" : "新增类别"}
                </button>
                {selectedClassId ? <button className="secondary-button" type="button" onClick={() => setSelectedClassId("")}>改为新增</button> : null}
              </div>
              {classes ? (
                classes.length > 0 ? (
                  <table className="automl-table">
                    <thead><tr><th>编码</th><th>名称</th><th>索引</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>
                      {classes.map((item) => (
                        <tr key={item.id}>
                          <td>{item.classCode}</td><td>{item.className}</td><td>{item.classIndex}</td><td>{item.statusCd}</td>
                          <td>
                            <div className="automl-actions">
                              <button className="secondary-button" type="button" onClick={() => {
                                setSelectedClassId(String(item.id));
                                setClassForm({ classCode: item.classCode, className: item.className, color: item.color ?? "", sortNo: item.sortNo, statusCd: item.statusCd });
                              }}>编辑</button>
                              <button className="secondary-button" type="button" onClick={() => handleDeleteClass(item.id)}>删除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="automl-panel-hint">该数据集暂无类别。</p>
              ) : null}
            </>
          ) : null}
        </article>

        <article className="panel automl-panel">
          <header className="automl-panel-header">
            <span className="dataset-object-mark"><Tags size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>6 · 标注任务与样本标注</h2>
              <p className="automl-panel-hint">创建/查询任务，读取样本已有标注，并用 JSON 数组全量覆盖保存。</p>
            </div>
          </header>
          <div className="automl-form-grid">
            <label className="automl-field">
              <span>数据集 ID</span>
              <input value={inspectorDatasetId} onChange={(event) => setInspectorDatasetId(event.target.value)} placeholder="与上方查看器共用" />
            </label>
            <label className="automl-field">
              <span>任务 ID（标注用）</span>
              <input value={annotationTaskIdInput} onChange={(event) => setAnnotationTaskIdInput(event.target.value)} placeholder="创建后自动填入" />
            </label>
            <label className="automl-field">
              <span>样本 ID（标注用）</span>
              <input value={annotationItemId} onChange={(event) => setAnnotationItemId(event.target.value)} placeholder="可在样本页签点击标注" />
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

          <div className="automl-subpanel">
            <h3>样本标注</h3>
            <div className="automl-actions">
              <button className="secondary-button" type="button" disabled={annotationLoading || !inspectorId || !versionIdInput.trim() || !annotationItemId.trim()} onClick={() => loadAnnotations()}>
                {annotationLoading ? <LoaderCircle size={16} className="spinner" /> : <RefreshCw size={16} />}
                读取标注
              </button>
              <button className="primary-button" type="button" disabled={annotationSaving || !inspectorId || !versionIdInput.trim() || !annotationItemId.trim() || !annotationTaskIdInput.trim()} onClick={handleSaveAnnotations}>
                {annotationSaving ? <LoaderCircle size={16} className="spinner" /> : <BookmarkPlus size={16} />}
                全量覆盖保存
              </button>
              <Link
                className="secondary-button"
                href={`/studio/automl/annotate?dataset=${encodeURIComponent(inspectorDatasetId.trim())}&version=${encodeURIComponent(versionIdInput.trim())}${annotationTaskIdInput.trim() ? `&task=${encodeURIComponent(annotationTaskIdInput.trim())}` : ""}&from=automl`}
              >
                <PenLine size={16} />
                打开可视化标注
              </Link>
            </div>
            <textarea
              className="automl-annotation-json"
              value={annotationDraft}
              onChange={(event) => setAnnotationDraft(event.target.value)}
              rows={8}
            />
            {annotations ? (
              annotations.length > 0 ? (
                <table className="automl-table">
                  <thead><tr><th>类别</th><th>来源</th><th>状态</th><th>几何/属性</th></tr></thead>
                  <tbody>
                    {annotations.map((item) => (
                      <tr key={item.id}>
                        <td>{item.labelName}</td><td>{item.sourceCd}</td><td>{item.statusCd}</td>
                        <td><code>{JSON.stringify(item.annotationJson)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="automl-panel-hint">该样本暂无标注。</p>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
