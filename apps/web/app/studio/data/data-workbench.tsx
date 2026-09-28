"use client";

import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  FileCheck2,
  FileImage,
  Grid2X2,
  Layers3,
  List,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Tag,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DynamicAssetImage } from "../../components/dynamic-asset-image";
import {
  type AutomlDataset,
  type AutomlDatasetClass,
  type AutomlDatasetItem,
  type AutomlDatasetModel,
  type AutomlId,
  type AutomlVersionDetail,
  type AutomlAnnotation,
  type AutomlAnnotationTaskSummary,
  createAutomlDatasetClass,
  createAutomlDatasetFromFiles,
  createAutomlEmptyDataset,
  createAutomlDatasetVersionSnapshot,
  createAutomlStandardAnnotationTask,
  deleteAutomlDatasetClass,
  getAutomlDatasetVersionDetails,
  getAutomlFileUrls,
  listAutomlAnnotationTasks,
  listAutomlAnnotations,
  listAutomlDatasetClasses,
  listAutomlDatasetItems,
  listAutomlDatasetModels,
  listAutomlDatasets,
  appendAutomlDatasetFiles,
  importAutomlItems,
  publishAutomlVersionToMarket,
  unpublishAutomlVersionFromMarket,
  notifyAutomlDatasetsChanged,
  uploadAutomlFiles,
  releaseAutomlDatasetVersion,
  updateAutomlDatasetClass,
  updateAutomlDatasetItemSplits,
  uploadAutomlFile,
  uploadAutomlFileChunked,
} from "../../../lib/automl-data-api";
import { autoSplitCounts, shuffledIndexes } from "../../../lib/automl-split";
import { isAnnotationFile, isImageFile, isZipFile, pairAnnotationFiles } from "../../../lib/annotation-import";

type ConnectionState = "checking" | "online" | "offline";
type DataView = "assets" | "annotation" | "classes" | "models" | "versions";
type SplitFilter = "all" | "train" | "val" | "test";

const TASK_TYPES = [
  { value: "OBJECT_DETECTION", label: "目标检测", description: "用矩形框定位对象" },
  { value: "CLASSIFICATION", label: "图像分类", description: "为整张图像分配类别" },
  { value: "SEGMENTATION", label: "图像分割", description: "逐像素划分对象区域" },
] as const;

const taskTypeLabels: Record<string, string> = {
  OBJECT_DETECTION: "目标检测",
  CLASSIFICATION: "图像分类",
  SEGMENTATION: "语义分割",
  INSTANCE_SEGMENTATION: "实例分割",
  POSE: "姿态估计",
  OCR: "文字识别",
};

const splitLabels: Record<string, string> = {
  train: "训练集",
  val: "验证集",
  test: "测试集",
};

const taskStatusLabels: Record<string, string> = {
  PENDING: "待开始",
  ANNOTATING: "标注中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

const versionStatusLabels: Record<string, string> = {
  BUILDING: "生成中",
  READY: "已就绪",
  INVALID: "已失效",
};

const ITEMS_PAGE_LIMIT = 20;
const SMALL_FILE_BYTES = 8 * 1024 * 1024;
const UPLOAD_BATCH_SIZE = 10;

function formatBytes(size: AutomlId | number | null): string {
  const bytes = Number(size ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function itemDisplayName(item: AutomlDatasetItem): string {
  return item.originName || item.sampleObjectKey.split("/").pop() || String(item.itemId);
}

function ItemThumbnail({ objectKey, url, alt }: { objectKey: string; url: string | undefined; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <DynamicAssetImage
        src={url}
        alt={alt}
        onError={() => setFailed(true)}
      />
    );
  }
  return <FileImage size={20} aria-hidden="true" data-thumbnail-fallback={objectKey} />;
}

export function DataWorkbench() {
  const searchParams = useSearchParams();
  const requestedDatasetId = searchParams.get("dataset");
  const requestedVersionId = searchParams.get("version");
  const requestedDatasetCreation = searchParams.get("createDataset") === "1";
  const requestedView = searchParams.get("view");
  const initialView: DataView = requestedView === "annotation"
    || requestedView === "classes"
    || requestedView === "models"
    || requestedView === "versions"
    ? requestedView
    : "assets";

  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [datasets, setDatasets] = useState<AutomlDataset[]>([]);
  const [dataset, setDataset] = useState<AutomlDataset | null>(null);
  const [versionDetail, setVersionDetail] = useState<AutomlVersionDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [items, setItems] = useState<AutomlDatasetItem[]>([]);
  const [itemsTotal, setItemsTotal] = useState<AutomlId>(0);
  const [allTotal, setAllTotal] = useState<AutomlId>(0);
  const [itemsPage, setItemsPage] = useState(1);
  const [splitFilter, setSplitFilter] = useState<SplitFilter>("all");
  const [splitCounts, setSplitCounts] = useState<Record<"train" | "val" | "test", number>>({
    train: 0,
    val: 0,
    test: 0,
  });
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [classes, setClasses] = useState<AutomlDatasetClass[]>([]);
  const [tasks, setTasks] = useState<AutomlAnnotationTaskSummary[]>([]);
  const [models, setModels] = useState<AutomlDatasetModel[]>([]);
  const [creationOpen, setCreationOpen] = useState(requestedDatasetCreation);
  const [activeView, setActiveView] = useState<DataView>(initialView);
  const [datasetName, setDatasetName] = useState("");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [newDatasetTaskType, setNewDatasetTaskType] = useState<string>("OBJECT_DETECTION");
  const [datasetClassNames, setDatasetClassNames] = useState("");
  const [datasetSourceFiles, setDatasetSourceFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [snapshotSourceId, setSnapshotSourceId] = useState<string | null>(null);
  const [splitRatios, setSplitRatios] = useState({ train: 70, val: 20, test: 10 });
  const [taskName, setTaskName] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [itemLayout, setItemLayout] = useState<"grid" | "list">("grid");
  // 样本筛选：标注状态与类别走服务端过滤（跨分页准确），类别下拉选项来自数据集类别
  const [annotatedFilter, setAnnotatedFilter] = useState<"all" | "annotated" | "unannotated">("all");
  const [labelFilter, setLabelFilter] = useState("all");
  // 标注概览：开启后逐个拉取当前页样本的标注，在卡片上以标签章粗略展示
  const [annotationPreviewOn, setAnnotationPreviewOn] = useState(false);
  const [itemAnnotations, setItemAnnotations] = useState<Record<string, AutomlAnnotation[]>>({});
  // 每次出现新错误时递增，作为 error 提示的 key 重放抖动动画
  const [errorShakeKey, setErrorShakeKey] = useState(0);
  useEffect(() => {
    if (error) setErrorShakeKey((n) => n + 1);
  }, [error]);
  const [classDraft, setClassDraft] = useState("");
  const [classBusyId, setClassBusyId] = useState<AutomlId | null>(null);

  const datasetId = dataset ? String(dataset.id) : null;
  // 数据集切换瞬间 versionDetail 仍属于旧数据集，派生时按 datasetId 校验避免旧版本 ID 打到新数据集
  const versions = versionDetail != null && String(versionDetail.datasetId) === datasetId
    ? versionDetail.versions
    : [];
  const selectedVersion = versions.find((version) => String(version.id) === selectedVersionId)
    ?? versions.reduce<(typeof versions)[number] | null>((latest, version) =>
      Number(version.id) > Number(latest?.id ?? 0) ? version : latest, null)
    ?? null;
  const versionId = selectedVersion ? String(selectedVersion.id) : null;

  useEffect(() => {
    setCreationOpen(requestedDatasetCreation);
  }, [requestedDatasetCreation]);

  const loadDatasets = useCallback(async (preferredDatasetId: string | null) => {
    setConnection("checking");
    setError(null);
    try {
      const page = await listAutomlDatasets({ page: 1, limit: 50 });
      const rows = page.rows;
      setDatasets(rows);
      setDataset((current) =>
        rows.find((item) => String(item.id) === preferredDatasetId)
        ?? rows.find((item) => String(item.id) === String(current?.id))
        ?? rows[0]
        ?? null,
      );
      setConnection("online");
    } catch (reason) {
      setConnection("offline");
      setError(reason instanceof Error ? reason.message : "无法连接 AutoML 数据服务");
    }
  }, []);

  useEffect(() => {
    void loadDatasets(requestedDatasetId);
  }, [loadDatasets, requestedDatasetId]);

  const loadDatasetContext = useCallback(async (targetDatasetId: string, preferredVersionId: string | null) => {
    // 切换数据集时先清空版本上下文，避免旧版本 ID 与新数据集组合触发后端 400
    setVersionDetail(null);
    setSelectedVersionId(null);
    try {
      const [detail, classList, modelList] = await Promise.all([
        getAutomlDatasetVersionDetails(targetDatasetId),
        listAutomlDatasetClasses(targetDatasetId),
        listAutomlDatasetModels(targetDatasetId),
      ]);
      setVersionDetail(detail);
      setClasses(classList);
      setModels(modelList);
      const versionIds = detail.versions.map((version) => String(version.id));
      setSelectedVersionId((current) => {
        if (preferredVersionId && versionIds.includes(preferredVersionId)) return preferredVersionId;
        return current && versionIds.includes(current) ? current : null;
      });
      setItemsPage(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "数据集详情加载失败");
    }
  }, []);

  useEffect(() => {
    if (!datasetId) {
      setVersionDetail(null);
      setClasses([]);
      setModels([]);
      setTasks([]);
      return;
    }
    void loadDatasetContext(datasetId, requestedVersionId);
  }, [datasetId, loadDatasetContext, requestedVersionId]);

  const loadSplitCounts = useCallback(async (targetDatasetId: string, targetVersionId: string) => {
    try {
      const countOf = (splitType?: string) =>
        listAutomlDatasetItems(targetDatasetId, targetVersionId, {
          page: 1,
          limit: 1,
          splitType,
        }).then((page) => Number(page.total));
      const [train, val, test, all] = await Promise.all([
        countOf("train"),
        countOf("val"),
        countOf("test"),
        countOf(),
      ]);
      setSplitCounts({ train, val, test });
      // 「全部」tab 的计数独立于当前筛选的 itemsTotal，切筛选不会被覆盖
      setAllTotal(all);
    } catch {
      setSplitCounts({ train: 0, val: 0, test: 0 });
      setAllTotal(0);
    }
  }, []);

  useEffect(() => {
    if (!datasetId || !versionId) {
      setTasks([]);
      setItems([]);
      setItemsTotal(0);
      setAllTotal(0);
      setSplitCounts({ train: 0, val: 0, test: 0 });
      return;
    }
    void Promise.all([
      listAutomlAnnotationTasks(datasetId, versionId),
      listAutomlDatasetItems(datasetId, versionId, {
        page: itemsPage,
        limit: ITEMS_PAGE_LIMIT,
        splitType: splitFilter === "all" ? undefined : splitFilter,
        annotated: annotatedFilter === "all" ? undefined : annotatedFilter === "annotated",
        labelName: labelFilter === "all" ? undefined : labelFilter,
      }),
      loadSplitCounts(datasetId, versionId),
    ])
      .then(([taskList, itemPage]) => {
        setTasks(taskList);
        setItems(itemPage.rows);
        setItemsTotal(itemPage.total);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "样本数据加载失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, versionId, splitFilter, itemsPage, annotatedFilter, labelFilter, loadSplitCounts]);

  useEffect(() => {
    const objectKeys = items
      .map((item) => item.sampleObjectKey)
      .filter((objectKey) => objectKey && !thumbnails[objectKey]);
    if (!objectKeys.length) return;
    let cancelled = false;
    // batch-urls 可能与页面上其他请求撞后端 500ms 同 URL 防抖锁，失败按 900ms 间隔重试
    async function fetchThumbs() {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          const urls = await getAutomlFileUrls(objectKeys);
          if (cancelled) return;
          setThumbnails((current) => {
            const next = { ...current };
            for (const entry of urls) next[entry.objectKey] = entry.url;
            return next;
          });
          return;
        } catch {
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 900));
        }
      }
    }
    void fetchThumbs();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function stageDatasetSourceFiles(files: File[]) {
    const supported = files.filter((file) => isImageFile(file) || isAnnotationFile(file) || isZipFile(file));
    if (!supported.length) {
      setError("请选择图片、YOLO txt / VOC xml 标注或单个 zip 包");
      return;
    }
    setDatasetSourceFiles((current) => [...current, ...supported].slice(0, 100));
    setError(null);
  }

  function selectDatasetSourceFiles(event: ChangeEvent<HTMLInputElement>) {
    stageDatasetSourceFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (busy) return;
    stageDatasetSourceFiles(Array.from(event.dataTransfer.files));
  }

  async function createDataset(event: FormEvent) {
    event.preventDefault();
    if (datasetSourceFiles.some(isZipFile)) {
      setError("zip 包暂不参与创建数据集：请先创建数据集，再通过「导入素材」单独上传 zip");
      return;
    }
    const hasAnnotations = datasetSourceFiles.some(isAnnotationFile);
    setBusy(true);
    setError(null);
    try {
      const dataFileIds = datasetSourceFiles.length
        ? (await uploadDatasetImages(datasetSourceFiles)).map((entry) => entry.fileId)
        : [];
      setUploadProgress("正在创建数据集…");
      const classNames = datasetClassNames
        .split(/[,，\n]/)
        .map((name) => name.trim())
        .filter(Boolean);
      // 带标注文件：先建空数据集（版本自动创建），再结构化导入样本+标注，类别自动创建
      if (hasAnnotations) {
        const empty = await createAutomlEmptyDataset({
          name: datasetName.trim(),
          description: datasetDescription.trim() || undefined,
          taskType: newDatasetTaskType,
        });
        const imported = await importWithAnnotations(String(empty.id), datasetSourceFiles);
        setUploadProgress(null);
        setDatasetSourceFiles([]);
        setDatasetName("");
        setDatasetDescription("");
        setDatasetClassNames("");
        setCreationOpen(false);
        setDataset(empty);
        await loadDatasets(String(empty.id));
        await loadDatasetContext(String(empty.id), null);
        notifyAutomlDatasetsChanged();
        setNotice(`数据集与标注已创建：${imported} 个样本已写入 v1`);
        return;
      }
      // 有图走 from-files；无图创建空数据集，素材稍后用「导入素材」追加
      const created = dataFileIds.length
        ? await createAutomlDatasetFromFiles({
          dataFileIds,
          name: datasetName.trim(),
          description: datasetDescription.trim() || undefined,
          taskType: newDatasetTaskType,
          classNames: classNames.length ? classNames : undefined,
        })
        : await createAutomlEmptyDataset({
          name: datasetName.trim(),
          description: datasetDescription.trim() || undefined,
          taskType: newDatasetTaskType,
          classNames: classNames.length ? classNames : undefined,
        });
      setUploadProgress(null);
      setDatasetSourceFiles([]);
      setDatasetName("");
      setDatasetDescription("");
      setDatasetClassNames("");
      setCreationOpen(false);
      setDataset(created);
      setNotice(dataFileIds.length
        ? `数据集已创建（v1 含 ${dataFileIds.length} 个样本）`
        : "空数据集已创建，可用「导入素材」添加图片");
      notifyAutomlDatasetsChanged();
      await loadDatasets(String(created.id));
      await loadDatasetContext(String(created.id), null);
    } catch (reason) {
      setUploadProgress(null);
      setError(reason instanceof Error ? reason.message : "数据集创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateSplit(item: AutomlDatasetItem, split: "train" | "val" | "test") {
    if (!datasetId || !versionId) return;
    setBusy(true);
    setError(null);
    try {
      await updateAutomlDatasetItemSplits(datasetId, versionId, [
        { itemId: item.itemId, splitType: split },
      ]);
      setItems((current) => current.map((row) => (row.itemId === item.itemId ? { ...row, splitType: split } : row)));
      void loadSplitCounts(datasetId, versionId);
      setNotice(`已设为${splitLabels[split]}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "数据划分更新失败");
    } finally {
      setBusy(false);
    }
  }

  // 多图上传：小文件合并走批量端点（单请求多文件）；超 8MB 的逐个分片。
  // 不能逐个调 /files/upload——后端 500ms 同 URL 防抖会把紧随其后的第二张拒掉。
  // 返回按输入顺序排列的 file→fileId 映射，供标注配对使用。
  async function uploadDatasetImages(files: File[]): Promise<Array<{ file: File; fileId: AutomlId }>> {
    const results: Array<{ file: File; fileId: AutomlId } | null> = new Array(files.length).fill(null);
    const entries = files.map((file, index) => ({ file, index }));
    const smallEntries = entries.filter((entry) => entry.file.size <= SMALL_FILE_BYTES);
    const largeEntries = entries.filter((entry) => entry.file.size > SMALL_FILE_BYTES);
    for (let offset = 0; offset < smallEntries.length; offset += UPLOAD_BATCH_SIZE) {
      if (offset > 0) await new Promise((resolve) => setTimeout(resolve, 1200));
      const group = smallEntries.slice(offset, offset + UPLOAD_BATCH_SIZE);
      setUploadProgress(`正在上传图片 ${Math.min(offset + group.length, smallEntries.length)} / ${smallEntries.length}…`);
      const uploaded = await uploadAutomlFiles(group.map((entry) => entry.file));
      uploaded.forEach((item, position) => {
        results[group[position].index] = { file: group[position].file, fileId: item.fileId };
      });
    }
    for (const [index, entry] of largeEntries.entries()) {
      setUploadProgress(`正在分片上传大图 ${index + 1} / ${largeEntries.length}：${entry.file.name}`);
      results[entry.index] = { file: entry.file, fileId: (await uploadAutomlFileChunked(entry.file)).result.fileId };
    }
    return results.filter((entry): entry is { file: File; fileId: AutomlId } => entry !== null);
  }

  // 图片 + 标注（YOLO txt / VOC xml）混合导入：同名配对、缺失类别由后端自动创建、
  // 样本与标注一次性写入当前最新版本（无版本自动建 v1）。
  // YOLO 索引优先按数据库已有类别的 classIndex 映射；缺失索引以 class_{i} 占位并自动补建，
  // 导入完成后跳转「类别」页签并提示用户维护类别名称。
  async function importWithAnnotations(datasetId: string, files: File[]): Promise<number> {
    const currentClasses = await listAutomlDatasetClasses(datasetId);
    const missingClassIndices = new Set<number>();
    const pair = await pairAnnotationFiles(files, (classIndex) => {
      const known = currentClasses.find((entry) => entry.classIndex === classIndex)?.className;
      if (known) return known;
      missingClassIndices.add(classIndex);
      return `class_${classIndex}`;
    });
    const uploaded = await uploadDatasetImages([
      ...pair.pairs.map((entry) => entry.image),
      ...pair.unpairedImages,
    ]);
    const idByFile = new Map(uploaded.map((entry) => [entry.file, entry.fileId]));
    const payloadItems = [
      ...pair.pairs.map((entry) => ({
        dataFileId: idByFile.get(entry.image)!,
        width: entry.width,
        height: entry.height,
        annotations: entry.annotations,
      })),
      ...pair.unpairedImages.map((image) => ({
        dataFileId: idByFile.get(image)!,
        width: null,
        height: null,
        annotations: [],
      })),
    ];
    const version = await importAutomlItems(datasetId, payloadItems);
    const annotationTotal = payloadItems.reduce((sum, item) => sum + item.annotations.length, 0);
    const unmatchedHint = pair.unmatchedAnnotationFiles.length
      ? `；${pair.unmatchedAnnotationFiles.length} 个标注文件因找不到同名图片被跳过（${pair.unmatchedAnnotationFiles.join("、")}）`
      : "";
    const importedSummary = `已导入 ${payloadItems.length} 个样本、${annotationTotal} 条标注到 ${version.version}${unmatchedHint}`;
    if (missingClassIndices.size) {
      // 缺失类别已由后端自动补建：刷新类别列表、跳转「类别」页签，提示用户维护类别名称
      setClasses(await listAutomlDatasetClasses(datasetId));
      setActiveView("classes");
      const placeholderNames = [...missingClassIndices].sort((a, b) => a - b).map((index) => `class_${index}`).join("、");
      setNotice(`${importedSummary}；检测到缺失类别已自动补建（${placeholderNames}），请维护类别名称`);
      return payloadItems.length;
    }
    setNotice(importedSummary);
    return payloadItems.length;
  }

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []).filter(
      (file) => isImageFile(file) || isAnnotationFile(file) || isZipFile(file),
    );
    input.value = "";
    if (!datasetId) return;
    if (!files.length) {
      setError("请选择图片、YOLO txt / VOC xml 标注或单个 zip 包");
      return;
    }
    const zipFiles = files.filter(isZipFile);
    if (zipFiles.length) {
      if (files.length > 1) {
        setError("zip 包需单独上传，不能与其他文件混选");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await uploadAutomlFile(zipFiles[0]);
        setNotice("zip 包已上传；解压解析将在异步任务框架中提供");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "zip 上传失败");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const hasAnnotations = files.some(isAnnotationFile);
      if (hasAnnotations) {
        await importWithAnnotations(datasetId, files);
      } else {
        setNotice(`正在上传 ${files.length} 张图片…`);
        const uploaded = await uploadDatasetImages(files);
        const version = await appendAutomlDatasetFiles(datasetId, uploaded.map((entry) => entry.fileId));
        setNotice(`已导入 ${uploaded.length} 个素材到 ${version.version}`);
      }
      // 刷新以接口返回的目标版本为准，跳到「全部」最后一页展示新样本
      const detail = await getAutomlDatasetVersionDetails(datasetId);
      const latest = detail.versions.reduce((acc, cur) => (Number(cur.id) > Number(acc?.id ?? 0) ? cur : acc));
      const targetVersionId = String(latest.id);
      setVersionDetail(detail);
      setSelectedVersionId(targetVersionId);
      void loadSplitCounts(datasetId, targetVersionId);
      const lastPage = Math.max(1, Math.ceil(Number(latest.sampleCount) / ITEMS_PAGE_LIMIT));
      setSplitFilter("all");
      setItemsPage(lastPage);
      const refreshed = await listAutomlDatasetItems(datasetId, targetVersionId, { page: lastPage, limit: ITEMS_PAGE_LIMIT });
      setItems(refreshed.rows);
      setItemsTotal(refreshed.total);
      notifyAutomlDatasetsChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "素材导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function runAutoSplit() {
    if (!datasetId || !versionId) return;
    setBusy(true);
    setError(null);
    try {
      // 拉取当前版本全量样本（样本浏览页本身是分页的）
      const all: AutomlDatasetItem[] = [];
      for (let page = 1; ; page += 1) {
        const pageResult = await listAutomlDatasetItems(datasetId, versionId, { page, limit: 200 });
        all.push(...pageResult.rows);
        if (!pageResult.rows.length || all.length >= Number(pageResult.total)) break;
      }
      const counts = autoSplitCounts(all.length, splitRatios);
      const updates = shuffledIndexes(all.length).map((itemIndex, position) => ({
        itemId: all[itemIndex].itemId,
        splitType: position < counts.train
          ? "train" as const
          : position < counts.train + counts.val ? "val" as const : "test" as const,
      }));
      for (let offset = 0; offset < updates.length; offset += 200) {
        await updateAutomlDatasetItemSplits(datasetId, versionId, updates.slice(offset, offset + 200));
      }
      const refreshed = await listAutomlDatasetItems(datasetId, versionId, {
        page: itemsPage,
        limit: ITEMS_PAGE_LIMIT,
        splitType: splitFilter === "all" ? undefined : splitFilter,
      });
      setItems(refreshed.rows);
      setItemsTotal(refreshed.total);
      void loadSplitCounts(datasetId, versionId);
      setSplitDialogOpen(false);
      setNotice(`已自动划分：训练 ${counts.train} / 验证 ${counts.val} / 测试 ${counts.test}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "自动划分失败");
    } finally {
      setBusy(false);
    }
  }

  async function createAnnotationTask(event: FormEvent) {
    event.preventDefault();
    if (!datasetId || !versionId) return;
    setBusy(true);
    setError(null);
    try {
      await createAutomlStandardAnnotationTask({
        datasetId,
        datasetVersionId: versionId,
        name: taskName.trim() || "未命名标注任务",
      });
      const taskList = await listAutomlAnnotationTasks(datasetId, versionId);
      setTasks(taskList);
      setTaskDialogOpen(false);
      setTaskName("");
      setNotice("标注任务已创建");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "标注任务创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function releaseSelectedVersion() {
    if (!datasetId || !versionId || !selectedVersion) return;
    setBusy(true);
    setError(null);
    try {
      await releaseAutomlDatasetVersion(datasetId, versionId);
      setNotice(`${selectedVersion.version} 已发布`);
      setVersionDetail(await getAutomlDatasetVersionDetails(datasetId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMarketPublish(listed: boolean) {
    if (!datasetId || !versionId || !selectedVersion) return;
    setBusy(true);
    setError(null);
    try {
      if (listed) {
        await unpublishAutomlVersionFromMarket(datasetId, versionId);
        setNotice(`${selectedVersion.version} 已从数据市场下架`);
      } else {
        await publishAutomlVersionToMarket(datasetId, versionId);
        setNotice(`${selectedVersion.version} 已发布到数据市场`);
      }
      setVersionDetail(await getAutomlDatasetVersionDetails(datasetId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (listed ? "下架失败" : "上架失败"));
    } finally {
      setBusy(false);
    }
  }

  async function snapshotVersion(sourceVersionId: string) {
    if (!datasetId) return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = await createAutomlDatasetVersionSnapshot(datasetId, sourceVersionId);
      setNotice(`${snapshot.version} 已创建（未发布）。可继续导入素材与标注，完成后在「版本」页签发布。`);
      setVersionDetail(await getAutomlDatasetVersionDetails(datasetId));
      setSelectedVersionId(String(snapshot.id));
      setItemsPage(1);
      await loadDatasetContext(datasetId, String(snapshot.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "版本生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function addClassRow(event: FormEvent) {
    event.preventDefault();
    if (!datasetId || !classDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createAutomlDatasetClass(datasetId, {
        classCode: classDraft.trim().toLowerCase().replace(/\s+/g, "_"),
        className: classDraft.trim(),
      });
      setClassDraft("");
      setClasses(await listAutomlDatasetClasses(datasetId));
      setNotice("类别已添加");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "类别添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function renameClass(target: AutomlDatasetClass, className: string) {
    if (!datasetId || !className.trim() || className.trim() === target.className) return;
    setClassBusyId(target.id);
    setError(null);
    try {
      await updateAutomlDatasetClass(datasetId, target.id, {
        datasetId: target.datasetId,
        classCode: target.classCode,
        classIndex: target.classIndex,
        className: className.trim(),
        color: target.color ?? undefined,
        sortNo: target.sortNo,
        statusCd: target.statusCd === "DISABLED" ? "DISABLED" : "ENABLED",
      });
      setClasses(await listAutomlDatasetClasses(datasetId));
      setNotice("类别已更新");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "类别更新失败");
    } finally {
      setClassBusyId(null);
    }
  }

  async function removeClassRow(target: AutomlDatasetClass) {
    if (!datasetId) return;
    setClassBusyId(target.id);
    setError(null);
    try {
      await deleteAutomlDatasetClass(datasetId, target.id);
      setClasses(await listAutomlDatasetClasses(datasetId));
      setNotice("类别已删除");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "类别删除失败");
    } finally {
      setClassBusyId(null);
    }
  }

  const normalizedSearch = itemSearch.trim().toLowerCase();
  const visibleItems = normalizedSearch
    ? items.filter((item) => itemDisplayName(item).toLowerCase().includes(normalizedSearch))
    : items;
  const itemsTotalPage = Math.max(1, Math.ceil(Number(itemsTotal) / ITEMS_PAGE_LIMIT));

  // 标注概览开启后，补拉当前页样本的标注（逐样本缓存，翻页/筛选时按需增量加载）
  useEffect(() => {
    if (!annotationPreviewOn || !datasetId || !versionId) return;
    const missing = visibleItems.filter((item) => itemAnnotations[String(item.itemId)] === undefined);
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled(
        missing.map((item) => listAutomlAnnotations(datasetId, versionId, item.itemId)),
      );
      if (cancelled) return;
      setItemAnnotations((current) => {
        const next = { ...current };
        missing.forEach((item, index) => {
          const entry = results[index];
          next[String(item.itemId)] = entry.status === "fulfilled" ? entry.value : [];
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationPreviewOn, visibleItems, datasetId, versionId]);
  const totalSampleCount = selectedVersion?.sampleCount ?? 0;
  const activeTaskType = dataset?.taskType ?? "OBJECT_DETECTION";
  const taskTypeLabel = taskTypeLabels[activeTaskType] ?? activeTaskType;
  const trainingHref = "/studio/training";

  // 标注概览的标签章：按类别聚合（class × 数量）；itemAnnotations 无记录表示尚未加载
  function annotationChipsFor(item: AutomlDatasetItem): string[] {
    const annotations = itemAnnotations[String(item.itemId)];
    if (!annotations?.length) return [];
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      counts.set(annotation.labelName, (counts.get(annotation.labelName) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  }

  return (
    <section className="data-workbench" id="new-project">
      <div className="data-content">
        {error ? (
          <div className="workbench-message error-message" role="alert" key={`error-${errorShakeKey}`}>
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

        {connection === "offline" && !datasets.length ? (
          <article className="panel workbench-empty-state">
            <span className="empty-state-icon"><AlertCircle size={20} /></span>
            <span className="eyebrow">AutoML 数据服务</span>
            <h2>数据服务尚未连接</h2>
            <p>启动 sz-boot 后端（9992 端口）后，这里会显示真实数据集、样本与标注。</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => void loadDatasets(requestedDatasetId)}
            >
              <RefreshCw size={14} />
              重新连接
            </button>
          </article>
        ) : connection === "checking" && !datasets.length ? (
          <article className="panel workbench-loading" aria-live="polite">
            <LoaderCircle size={20} className="spinner" />
            <span>正在读取数据集…</span>
          </article>
        ) : !dataset || creationOpen ? (
          <article className="panel setup-card dataset-create-surface">
            <div className="dataset-create-header">
              <span className="setup-icon"><Database size={19} /></span>
              <div>
                <span className="eyebrow">数据与标注</span>
                <h2>新建数据集</h2>
                <p>数据集由上传的图片文件创建，创建时生成 v1 版本。</p>
              </div>
              {dataset ? (
                <button
                  className="dataset-create-close"
                  type="button"
                  onClick={() => setCreationOpen(false)}
                  aria-label="关闭新建数据集"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <form onSubmit={(event) => void createDataset(event)}>
              <label
                className={`dataset-source-dropzone${datasetSourceFiles.length ? " has-files" : ""}`}
                htmlFor="dataset-source-file-input"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  id="dataset-source-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.txt,.xml"
                  multiple
                  onChange={selectDatasetSourceFiles}
                  disabled={busy}
                />
                <span className="dataset-source-dropzone-icon"><UploadCloud size={21} /></span>
                <strong>{datasetSourceFiles.length ? "继续添加图片" : "拖放图片到这里"}</strong>
                <small>支持图片，或图片 + 同名 YOLO txt / VOC xml 标注（自动建类别与标注）；纯图片可直接创建，不选图片则创建空数据集</small>
              </label>
              {datasetSourceFiles.length ? (
                <div className="dataset-source-file-list" aria-live="polite">
                  <div className="dataset-source-file-summary">
                    <strong>已选择 {datasetSourceFiles.length} 个文件</strong>
                    <span>{uploadProgress ?? "创建后写入 v1 版本"}</span>
                  </div>
                  {datasetSourceFiles.slice(0, 4).map((file, index) => (
                    <div className="dataset-source-file" key={`${file.name}-${file.lastModified}-${index}`}>
                      {isAnnotationFile(file) ? <FileCheck2 size={14} /> : <FileImage size={14} />}
                      <span>{file.name}</span>
                      <small>{formatBytes(file.size)}</small>
                    </div>
                  ))}
                  {datasetSourceFiles.length > 4
                    ? <small className="dataset-source-more">还有 {datasetSourceFiles.length - 4} 个文件将在创建后导入</small>
                    : null}
                </div>
              ) : null}

              <div className="dataset-create-fields">
                <label className="dataset-create-field">
                  <span>数据集名称</span>
                  <input
                    value={datasetName}
                    onChange={(event) => setDatasetName(event.target.value)}
                    placeholder="例如：道路病害巡检"
                    required
                  />
                </label>
                <div className="dataset-create-field">
                  <span>任务类型</span>
                  <div className="project-task-type-grid">
                    {TASK_TYPES.map((type) => (
                      <button
                        type="button"
                        key={type.value}
                        className={newDatasetTaskType === type.value ? "is-active" : ""}
                        aria-pressed={newDatasetTaskType === type.value}
                        onClick={() => setNewDatasetTaskType(type.value)}
                        disabled={busy}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="dataset-create-field">
                <span>初始类别 <em>可选，逗号或换行分隔</em></span>
                <input
                  value={datasetClassNames}
                  onChange={(event) => setDatasetClassNames(event.target.value)}
                  placeholder="例如：helmet, person"
                />
                <small>类别编号按输入顺序生成；创建后也可在「类别」页维护。</small>
              </label>
              <label className="dataset-create-field">
                <span>描述 <em>可选</em></span>
                <textarea
                  value={datasetDescription}
                  onChange={(event) => setDatasetDescription(event.target.value)}
                  placeholder="补充数据来源、采集范围或使用限制"
                  rows={3}
                  maxLength={500}
                />
              </label>
              <div className="dataset-create-footer">
                {dataset ? (
                  <button className="secondary-button" type="button" onClick={() => setCreationOpen(false)}>取消</button>
                ) : <span />}
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle size={14} className="spinner" /> : <Plus size={14} />}
                  {busy ? "正在创建" : datasetSourceFiles.length ? "创建数据集" : "创建空数据集"}
                </button>
              </div>
            </form>
          </article>
        ) : (
          <>
            <div className="dataset-object-breadcrumbs">
              <Link href="/">工作台</Link>
              <ChevronRight size={12} aria-hidden="true" />
              <span>数据与标注</span>
              <ChevronRight size={12} aria-hidden="true" />
              <strong>{dataset.name}</strong>
            </div>

            <header className="dataset-object-header">
              <span className="dataset-object-mark"><Database size={20} strokeWidth={1.6} aria-hidden="true" /></span>
              <div className="dataset-object-copy">
                <div className="dataset-object-title-row">
                  <h1>{dataset.name}</h1>
                  <span className="dataset-task-type">
                    {activeTaskType === "OBJECT_DETECTION" ? <Layers3 size={13} /> : <Tag size={13} />}
                    {taskTypeLabel}
                  </span>
                  <span className={`dataset-object-state${versions.length ? " is-ready" : ""}`}>
                    <i />{versions.length ? "已就绪" : "草稿"}
                  </span>
                </div>
                <p>{dataset.description || `${taskTypeLabel}数据集（${dataset.datasetCode}）`}</p>
                <div className="dataset-object-meta" aria-label="数据集统计">
                  <span><FileImage size={13} />{totalSampleCount.toLocaleString("zh-CN")} 个样本</span>
                  <span><FileCheck2 size={13} />{(dataset.annotatedSampleCount ?? 0).toLocaleString("zh-CN")} 个已标注</span>
                  <span>{dataset.createTime ? `创建于 ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(dataset.createTime))}` : null}</span>
                  {selectedVersion ? <span> · 当前版本 {selectedVersion.version}（{versionStatusLabels[selectedVersion.statusCd] ?? selectedVersion.statusCd}{selectedVersion.marketStatusCd === "LISTED" ? " · 已上架" : ""}）</span> : null}
                </div>
              </div>
              <div className="dataset-object-actions">
                <button
                  className="secondary-button freeze-button"
                  type="button"
                  disabled={busy || !versionId}
                  onClick={() => { setSnapshotSourceId(versionId); setSnapshotDialogOpen(true); }}
                  title="将当前版本的样本与标注复制为新的不可变版本"
                >
                  <LockKeyhole size={14} aria-hidden="true" />
                  创建新版本
                </button>
                <Link className="primary-button" href={trainingHref}>
                  开始训练<ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </header>

            <nav className="dataset-view-tabs" aria-label="数据集视图">
              <button type="button" className={activeView === "assets" ? "is-active" : ""} onClick={() => setActiveView("assets")}>样本 <span>{Number(allTotal).toLocaleString("zh-CN")}</span></button>
              <button type="button" className={activeView === "annotation" ? "is-active" : ""} onClick={() => setActiveView("annotation")}>标注任务 <span>{tasks.length}</span></button>
              <button type="button" className={activeView === "classes" ? "is-active" : ""} onClick={() => setActiveView("classes")}>类别 <span>{classes.length}</span></button>
              <button type="button" className={activeView === "models" ? "is-active" : ""} onClick={() => setActiveView("models")}>模型 <span>{models.length}</span></button>
              <button type="button" className={activeView === "versions" ? "is-active" : ""} onClick={() => setActiveView("versions")}>版本 <span>{versions.length}</span></button>
            </nav>

            {activeView === "assets" ? (
              <article className="panel asset-table-card">
                <div className="asset-table-heading">
                  <div>
                    <h3>样本</h3>
                    <p>{versionId ? `${splitFilter === "all" ? Number(itemsTotal) : visibleItems.length} 项 · ${selectedVersion?.version ?? ""}${selectedVersion?.statusCd === "READY" ? " · 已发布" : ""}${selectedVersion?.marketStatusCd === "LISTED" ? " · 已上架数据市场" : ""}` : "当前数据集还没有版本"}</p>
                  </div>
                  <div className="asset-heading-actions">
                    <label className={`secondary-button compact dataset-upload-button${busy ? " is-busy" : ""}`}>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.txt,.xml,.zip"
                        multiple
                        disabled={busy || selectedVersion?.statusCd === "READY"}
                        onChange={(event) => void importFiles(event)}
                      />
                      {busy ? <LoaderCircle size={14} className="spinner" /> : <UploadCloud size={14} />}
                      导入素材
                    </label>
                    {versionId ? (
                      <button
                        className={`secondary-button compact${annotationPreviewOn ? " is-active" : ""}`}
                        type="button"
                        disabled={busy}
                        aria-pressed={annotationPreviewOn}
                        title="在样本卡片上粗略显示标注信息"
                        onClick={() => setAnnotationPreviewOn((on) => !on)}
                      >
                        <Tag size={14} />
                        标注概览
                      </button>
                    ) : null}
                    {versionId ? (
                      <button
                        className="secondary-button compact"
                        type="button"
                        disabled={busy || selectedVersion?.statusCd === "READY"}
                        title={selectedVersion?.statusCd === "READY" ? "已发布版本不可修改，请创建新版本后再调整" : undefined}
                        onClick={() => setSplitDialogOpen(true)}
                      >
                        <Shuffle size={14} />
                        自动划分
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="asset-browser-toolbar">
                  <div className="asset-split-tabs" role="tablist" aria-label="数据划分">
                    {([
                      ["all", "全部", Number(allTotal)],
                      ["train", "训练集", splitCounts.train],
                      ["val", "验证集", splitCounts.val],
                      ["test", "测试集", splitCounts.test],
                    ] as const).map(([value, label, count]) => (
                      <button
                        type="button"
                        role="tab"
                        key={value}
                        aria-selected={splitFilter === value}
                        className={splitFilter === value ? "is-active" : ""}
                        onClick={() => { setSplitFilter(value); setItemsPage(1); }}
                      >
                        {label}<span>{count.toLocaleString("zh-CN")}</span>
                      </button>
                    ))}
                  </div>
                  <div className="asset-browser-controls">
                    <select
                      className="asset-filter-select"
                      value={annotatedFilter}
                      aria-label="按标注状态筛选"
                      onChange={(event) => { setAnnotatedFilter(event.target.value as typeof annotatedFilter); setItemsPage(1); }}
                    >
                      <option value="all">全部标注</option>
                      <option value="annotated">已标注</option>
                      <option value="unannotated">未标注</option>
                    </select>
                    <select
                      className="asset-filter-select"
                      value={labelFilter}
                      aria-label="按类别筛选"
                      onChange={(event) => { setLabelFilter(event.target.value); setItemsPage(1); }}
                    >
                      <option value="all">全部类别</option>
                      {classes.map((entry) => (
                        <option key={String(entry.id)} value={entry.className}>{entry.className}</option>
                      ))}
                    </select>
                    <label className="asset-search">
                      <Search size={14} aria-label="搜索样本图标" />
                      <span className="sr-only">搜索样本</span>
                      <input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="搜索本页样本" />
                    </label>
                    <div className="asset-layout-switch" aria-label="样本视图">
                      <button type="button" className={itemLayout === "grid" ? "is-active" : ""} aria-label="网格视图" aria-pressed={itemLayout === "grid"} onClick={() => setItemLayout("grid")}><Grid2X2 size={14} /></button>
                      <button type="button" className={itemLayout === "list" ? "is-active" : ""} aria-label="列表视图" aria-pressed={itemLayout === "list"} onClick={() => setItemLayout("list")}><List size={14} /></button>
                    </div>
                  </div>
                </div>
                {visibleItems.length ? itemLayout === "grid" ? (
                  <div className="asset-grid">
                    {visibleItems.map((item) => (
                      <article className="asset-grid-card" key={item.itemId}>
                        <div className="asset-grid-preview">
                          <ItemThumbnail objectKey={item.sampleObjectKey} url={thumbnails[item.sampleObjectKey]} alt={itemDisplayName(item)} />
                          <span className={Number(item.annotatedItemCount) > 0 ? "is-ready" : ""}>{Number(item.annotatedItemCount) > 0 ? "已标注" : "未标注"}</span>
                          {annotationPreviewOn && itemAnnotations[String(item.itemId)] !== undefined ? (
                            <div className="asset-annotation-chips" aria-label="标注概览">
                              {annotationChipsFor(item).length
                                ? annotationChipsFor(item).map((chip) => <span key={chip} className="annotation-chip">{chip}</span>)
                                : <span className="annotation-chip is-empty">无标注</span>}
                            </div>
                          ) : null}
                        </div>
                        <div className="asset-grid-copy">
                          <strong title={itemDisplayName(item)}>{itemDisplayName(item)}</strong>
                          <small>{item.width && item.height ? `${item.width} × ${item.height}` : formatBytes(item.sizeBytes)}</small>
                        </div>
                        <div className="asset-grid-actions">
                          <select
                            className={`split-select ${item.splitType ?? "draft"}`}
                            value={item.splitType}
                            disabled={busy || selectedVersion?.statusCd === "READY"}
                            aria-label="数据划分"
                            onChange={(event) => {
                              const split = event.target.value as "train" | "val" | "test";
                              if (split) void updateSplit(item, split);
                            }}
                          >
                            <option value="train">训练集</option>
                            <option value="val">验证集</option>
                            <option value="test">测试集</option>
                          </select>
                          <Link
                            className="annotation-upload"
                            href={`/studio/automl/annotate?dataset=${encodeURIComponent(datasetId ?? "")}&version=${encodeURIComponent(versionId ?? "")}&item=${encodeURIComponent(String(item.itemId))}&from=data`}
                          >
                            {Number(item.annotatedItemCount) > 0 ? <FileCheck2 size={13} /> : <UploadCloud size={13} />}
                            <span>{Number(item.annotatedItemCount) > 0 ? "查看标注" : "标注"}</span>
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="asset-table">
                    {visibleItems.map((item) => (
                      <div className="asset-row" key={item.itemId}>
                        <span className="asset-preview">
                          <ItemThumbnail objectKey={item.sampleObjectKey} url={thumbnails[item.sampleObjectKey]} alt={itemDisplayName(item)} />
                        </span>
                        <span className="asset-identity">
                          <strong>{itemDisplayName(item)}</strong>
                          <small>{item.mediaType}</small>
                          {annotationPreviewOn && itemAnnotations[String(item.itemId)] !== undefined ? (
                            <span className="asset-annotation-chips is-inline">
                              {annotationChipsFor(item).length
                                ? annotationChipsFor(item).map((chip) => <span key={chip} className="annotation-chip">{chip}</span>)
                                : <span className="annotation-chip is-empty">无标注</span>}
                            </span>
                          ) : null}
                        </span>
                        <span>{item.width && item.height ? `${item.width} × ${item.height}` : "—"}</span>
                        <span>{formatBytes(item.sizeBytes)}</span>
                        <select
                          className={`split-select ${item.splitType ?? "draft"}`}
                          value={item.splitType}
                          disabled={busy}
                          aria-label="数据划分"
                          onChange={(event) => {
                            const split = event.target.value as "train" | "val" | "test";
                            if (split) void updateSplit(item, split);
                          }}
                        >
                          <option value="train">训练集</option>
                          <option value="val">验证集</option>
                          <option value="test">测试集</option>
                        </select>
                        <Link
                          className="annotation-upload"
                          href={`/studio/automl/annotate?dataset=${encodeURIComponent(datasetId ?? "")}&version=${encodeURIComponent(versionId ?? "")}&item=${encodeURIComponent(String(item.itemId))}&from=data`}
                        >
                          {Number(item.annotatedItemCount) > 0 ? <FileCheck2 size={13} /> : <UploadCloud size={13} />}
                          <span>{Number(item.annotatedItemCount) > 0 ? "查看标注" : "标注"}</span>
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : itemsTotal ? (
                  <div className="asset-empty"><Search size={19} /><p>没有符合当前筛选的样本。</p></div>
                ) : (
                  <div className="asset-empty"><FileImage size={19} /><p>当前版本还没有样本。</p></div>
                )}
                {itemsTotalPage > 1 ? (
                  <div className="asset-pagination" aria-label="样本分页">
                    <button type="button" className="secondary-button compact" disabled={itemsPage <= 1} onClick={() => setItemsPage((page) => Math.max(1, page - 1))}>
                      <ChevronLeft size={14} />上一页
                    </button>
                    <span>第 {itemsPage} / {itemsTotalPage} 页 · 共 {Number(itemsTotal).toLocaleString("zh-CN")} 项</span>
                    <button type="button" className="secondary-button compact" disabled={itemsPage >= itemsTotalPage} onClick={() => setItemsPage((page) => Math.min(itemsTotalPage, page + 1))}>
                      下一页<ChevronRight size={14} />
                    </button>
                  </div>
                ) : null}
              </article>
            ) : null}

            {activeView === "annotation" ? (
              <article className="panel annotation-tasks-card">
                <div className="annotation-tasks-heading">
                  <div>
                    <h3>标注任务</h3>
                    <p>任务基于当前版本（{selectedVersion?.version ?? "—"}）创建，入口在 AutoML 标注编辑器。</p>
                  </div>
                  <button className="primary-button" type="button" disabled={!versionId} onClick={() => setTaskDialogOpen(true)}>
                    <Plus size={14} />新建任务
                  </button>
                </div>
                <div className="annotation-summary-strip">
                  <div><span>待开始 / 标注中</span><strong>{tasks.filter((task) => task.statusCd !== "COMPLETED" && task.statusCd !== "CANCELLED").length}</strong></div>
                  <div><span>已完成</span><strong>{tasks.filter((task) => task.statusCd === "COMPLETED").length}</strong></div>
                  <div><span>样本总数</span><strong>{totalSampleCount.toLocaleString("zh-CN")}</strong></div>
                </div>
                <div className="annotation-task-list">
                  {tasks.length ? tasks.map((task) => {
                    const progress = Number(task.totalItemCount)
                      ? Math.round((Number(task.annotatedItemCount) / Number(task.totalItemCount)) * 100)
                      : 0;
                    return (
                      <div className="annotation-task-row" key={task.id}>
                        <span className="task-method-icon manual" aria-hidden="true"><FileCheck2 size={16} /></span>
                        <span className="task-main">
                          <strong>{task.name}</strong>
                          <small>{task.method === "MODEL_ASSISTED" ? "智能预标注" : "手动标注"}</small>
                        </span>
                        <span className="task-progress">
                          <i><b style={{ width: `${progress}%` }} /></i>
                          <small>{task.annotatedItemCount} / {task.totalItemCount}</small>
                        </span>
                        <span className={`task-status ${task.statusCd === "COMPLETED" ? "done" : task.statusCd === "ANNOTATING" ? "annotating" : "review"}`}>
                          {taskStatusLabels[task.statusCd] ?? task.statusCd}
                        </span>
                        <Link
                          href={`/studio/automl/annotate?dataset=${encodeURIComponent(datasetId ?? "")}&version=${encodeURIComponent(versionId ?? "")}&task=${encodeURIComponent(String(task.id))}`}
                          className="task-open-link"
                        >
                          {task.statusCd === "COMPLETED" ? "查看" : "继续"}<ChevronRight size={14} />
                        </Link>
                      </div>
                    );
                  }) : (
                    <div className="asset-empty"><ListChecks size={19} /><p>当前版本还没有标注任务。</p></div>
                  )}
                </div>
              </article>
            ) : null}

            {activeView === "classes" ? (
              <article className="panel dataset-insights-card">
                <div className="dataset-insights-heading">
                  <div>
                    <span className="dataset-insights-icon"><BarChart3 size={17} /></span>
                    <span><h3>类别定义</h3><p>类别编号（训练索引）创建后不可修改；已被标注引用的类别不能删除。</p></span>
                  </div>
                </div>
                <div className="dataset-class-editor is-structured">
                  <div className="dataset-class-editor-list">
                    {classes.length ? classes.map((datasetClass, index) => (
                      <div className="dataset-class-editor-row" key={datasetClass.id}>
                        <span className={`class-color color-${index % 3}`} aria-hidden="true" />
                        <span className="class-id">{datasetClass.classIndex}</span>
                        <input
                          defaultValue={datasetClass.className}
                          key={`${datasetClass.id}-${datasetClass.className}`}
                          aria-label={`类别 ${datasetClass.classIndex} 名称`}
                          disabled={classBusyId === datasetClass.id}
                          onBlur={(event) => void renameClass(datasetClass, event.target.value)}
                        />
                        <button
                          type="button"
                          aria-label={`删除类别 ${datasetClass.className}`}
                          disabled={classBusyId === datasetClass.id}
                          onClick={() => void removeClassRow(datasetClass)}
                        >
                          {classBusyId === datasetClass.id ? <LoaderCircle size={14} className="spinner" /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    )) : (
                      <div className="dataset-class-editor-empty">
                        <Tag size={16} />
                        <span>还没有类别。先添加业务中需要识别的对象。</span>
                      </div>
                    )}
                  </div>
                  <form className="dataset-class-editor-actions" onSubmit={(event) => void addClassRow(event)}>
                    <input
                      value={classDraft}
                      onChange={(event) => setClassDraft(event.target.value)}
                      placeholder="新类别名称，例如：安全帽"
                      aria-label="新类别名称"
                      disabled={busy}
                    />
                    <button className="secondary-button" type="submit" disabled={busy || !classDraft.trim()}>
                      <Plus size={13} />添加类别
                    </button>
                  </form>
                </div>
              </article>
            ) : null}

            {activeView === "models" ? (
              <article className="panel dataset-models-card">
                <div className="dataset-models-heading">
                  <div>
                    <span className="dataset-insights-icon"><Cpu size={17} /></span>
                    <span><h3>使用此数据集的模型</h3><p>由训练任务产生的模型与模型版本。</p></span>
                  </div>
                </div>
                {models.length ? (
                  <div className="dataset-model-list">
                    {models.map((model) => (
                      <div className="dataset-model-row" key={model.modelVersionId}>
                        <span className="dataset-model-mark"><Cpu size={15} /></span>
                        <span>
                          <strong>{model.modelName} · {model.modelVersion}</strong>
                          <small>{model.trainingTask ? `来自训练任务 ${model.trainingTask.name}` : "训练任务信息缺失"}</small>
                        </span>
                        <span>{model.trainingTask?.createTime ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="dataset-insights-empty">
                    <Cpu size={18} />
                    <p>尚无模型；生成已发布的版本后即可在训练页发起训练。</p>
                  </div>
                )}
              </article>
            ) : null}

            {activeView === "versions" ? (
              <>
                <aside className="panel versions-card versions-full-card">
                  <div className="versions-heading">
                    <div><h3>数据版本</h3><p>「创建新版本」会把当前版本的样本与标注复制为新的不可变版本。</p></div>
                    <span>{versions.length}</span>
                  </div>
                  {versions.length ? (
                    <div className="version-list">
                      {versions.map((version) => (
                        <button
                          className={`version-row${versionId === String(version.id) ? " is-active" : ""}`}
                          type="button"
                          key={version.id}
                          aria-pressed={versionId === String(version.id)}
                          onClick={() => { setSelectedVersionId(String(version.id)); setItemsPage(1); }}
                        >
                          <span className="version-lock"><LockKeyhole size={12} /></span>
                          <span>
                            <strong>{version.version}{version.marketStatusCd === "LISTED" ? " · 已上架" : ""}</strong>
                            <small>
                              {version.sampleCount} 个样本 · {versionStatusLabels[version.statusCd] ?? version.statusCd}
                              {version.releasedAt ? " · 已发布" : ""}
                            </small>
                          </span>
                          {version.statusCd === "READY" ? <Check size={13} aria-label="已发布" /> : <LoaderCircle size={13} className="spinner" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="versions-empty"><LockKeyhole size={17} /><p>当前数据集还没有版本。</p></div>
                  )}
                </aside>

                {selectedVersion ? (
                  <article className="panel dataset-quality-card">
                    <div className="dataset-quality-heading">
                      <div>
                        <h3>{selectedVersion.version} 版本统计</h3>
                        <p>统计来自版本快照，随版本固定。</p>
                      </div>
                      <span className="quality-version-state">
                        {selectedVersion.sampleCount} 个样本
                        {selectedVersion.marketStatusCd === "LISTED" ? " · 已上架数据市场" : ""}
                      </span>
                      {selectedVersion.statusCd !== "READY" ? (
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={busy}
                          title="校验全部样本已标注且划分完成后，将版本置为已发布"
                          onClick={() => void releaseSelectedVersion()}
                        >
                          <Check size={14} />
                          发布版本
                        </button>
                      ) : null}
                      {selectedVersion.statusCd === "READY" && selectedVersion.marketStatusCd !== "LISTED" ? (
                        <button
                          className="secondary-button compact market-publish-button"
                          type="button"
                          disabled={busy}
                          title="将已发布版本上架到数据市场，供其他人在数据市场查询使用"
                          onClick={() => void toggleMarketPublish(false)}
                        >
                          <UploadCloud size={14} />
                          发布到数据市场
                        </button>
                      ) : null}
                      {selectedVersion.marketStatusCd === "LISTED" ? (
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleMarketPublish(true)}
                        >
                          从数据市场下架
                        </button>
                      ) : null}
                    </div>
                    <div className="dataset-quality-body">
                      <div className="quality-summary-grid">
                        <div><span>样本总数</span><strong>{selectedVersion.sampleCount}</strong><small>版本内样本行数</small></div>
                        <div><span>图片样本</span><strong>{selectedVersion.imageCount}</strong><small>媒体类型为图片</small></div>
                        <div><span>类别</span><strong>{selectedVersion.classSampleStats.length}</strong><small>存在标注样本的类别</small></div>
                      </div>
                      <div className="quality-detail-grid">
                        <section className="quality-detail-section">
                          <div className="quality-section-heading"><FileCheck2 size={14} /><strong>数据划分</strong></div>
                          <div className="quality-split-list">
                            {(["train", "val", "test"] as const).map((splitType) => {
                              const count = splitType === "train" ? splitCounts.train : splitType === "val" ? splitCounts.val : splitCounts.test;
                              const percentage = selectedVersion.sampleCount ? Math.round((count / selectedVersion.sampleCount) * 100) : 0;
                              return (
                                <div key={splitType}>
                                  <span>{splitLabels[splitType]}</span>
                                  <strong>{count}</strong>
                                  <small>{percentage}%</small>
                                  <i aria-hidden="true"><b style={{ width: `${percentage}%` }} /></i>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                        <section className="quality-detail-section">
                          <div className="quality-section-heading"><ListChecks size={14} /><strong>类别样本分布</strong></div>
                          {selectedVersion.classSampleStats.length ? (
                            <div className="quality-class-list">
                              {selectedVersion.classSampleStats.map((stat) => (
                                <div key={stat.classId}>
                                  <span>{stat.className}</span>
                                  <small>索引 {stat.classIndex}</small>
                                  <strong>{stat.sampleCount} 个样本</strong>
                                </div>
                              ))}
                            </div>
                          ) : <p className="quality-empty">当前版本尚无类别标注分布。</p>}
                        </section>
                      </div>
                    </div>
                  </article>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>

      {splitDialogOpen ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <form
            className="workbench-dialog annotation-task-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="split-dialog-title"
            onSubmit={(event) => { event.preventDefault(); void runAutoSplit(); }}
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Shuffle size={18} /></span>
                <span>
                  <h2 id="split-dialog-title">自动划分数据集</h2>
                  <p>随机打乱当前版本（{selectedVersion?.version ?? "—"}）的全部 {Number(allTotal).toLocaleString("zh-CN")} 个样本，并覆盖现有划分。</p>
                </span>
              </div>
              <button type="button" onClick={() => setSplitDialogOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="dialog-fields">
              <label><span>训练集 %</span><input type="number" min={0} max={100} value={splitRatios.train} onChange={(event) => setSplitRatios((current) => ({ ...current, train: Number(event.target.value) || 0 }))} /></label>
              <label><span>验证集 %</span><input type="number" min={0} max={100} value={splitRatios.val} onChange={(event) => setSplitRatios((current) => ({ ...current, val: Number(event.target.value) || 0 }))} /></label>
              <label><span>测试集 %</span><input type="number" min={0} max={100} value={splitRatios.test} onChange={(event) => setSplitRatios((current) => ({ ...current, test: Number(event.target.value) || 0 }))} /></label>
            </div>
            {splitRatios.train + splitRatios.val + splitRatios.test !== 100 ? (
              <p className="resource-action-error" role="alert">三项比例之和必须等于 100（当前 {splitRatios.train + splitRatios.val + splitRatios.test}）。</p>
            ) : (
              <p className="automl-panel-hint">
                将分配为 训练 {autoSplitCounts(Number(allTotal), splitRatios).train} / 验证 {autoSplitCounts(Number(allTotal), splitRatios).val} / 测试 {autoSplitCounts(Number(allTotal), splitRatios).test}。每次执行都会重新随机洗牌，可在样本列表手动微调个别样本。
              </p>
            )}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setSplitDialogOpen(false)}>取消</button>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || splitRatios.train + splitRatios.val + splitRatios.test !== 100 || Number(allTotal) === 0}
              >
                {busy ? <LoaderCircle size={14} className="spinner" /> : <Shuffle size={14} />}
                {busy ? "正在划分" : "执行划分"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {snapshotDialogOpen ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <form
            className="workbench-dialog annotation-task-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="snapshot-dialog-title"
            onSubmit={(event) => { event.preventDefault(); setSnapshotDialogOpen(false); void snapshotVersion(snapshotSourceId ?? versionId ?? ""); }}
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><LockKeyhole size={18} /></span>
                <span>
                  <h2 id="snapshot-dialog-title">创建新版本</h2>
                  <p>把所选版本的样本与标注复制为新的不可变版本。新版本为「构建中」，可继续导入素材与标注。</p>
                </span>
              </div>
              <button type="button" onClick={() => setSnapshotDialogOpen(false)} aria-label="关闭">×</button>
            </div>
            <label className="snapshot-source-label" htmlFor="snapshot-source-select">基于版本创建</label>
            <select
              id="snapshot-source-select"
              className="asset-filter-select"
              value={snapshotSourceId ?? versionId ?? ""}
              onChange={(event) => setSnapshotSourceId(event.target.value)}
            >
              {versions.map((version) => (
                <option key={String(version.id)} value={String(version.id)}>
                  {version.version}（{version.sampleCount} 个样本，{version.statusCd === "READY" ? "已发布" : "构建中"}）
                </option>
              ))}
            </select>
            <div className="dataset-create-footer">
              <button type="button" className="secondary-button" onClick={() => setSnapshotDialogOpen(false)}>取消</button>
              <button type="submit" className="primary-button" disabled={busy || !snapshotSourceId}>创建新版本</button>
            </div>
          </form>
        </div>
      ) : null}

      {taskDialogOpen ? (
        <div className="workbench-dialog-backdrop" role="presentation">
          <form className="workbench-dialog annotation-task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" onSubmit={(event) => void createAnnotationTask(event)}>
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><FileCheck2 size={18} /></span>
                <span>
                  <h2 id="task-dialog-title">新建标注任务</h2>
                  <p>任务基于当前版本（{selectedVersion?.version ?? "—"}）的全部样本创建。</p>
                </span>
              </div>
              <button type="button" onClick={() => setTaskDialogOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="annotation-task-definition">
              <span className="dataset-task-type-icon">{activeTaskType === "OBJECT_DETECTION" ? <Layers3 /> : <Tag />}</span>
              <span>
                <strong>{taskTypeLabel}</strong>
                <small>{classes.length ? `${classes.length} 个类别：${classes.slice(0, 3).map((row) => row.className).join("、")}${classes.length > 3 ? "…" : ""}` : "尚未定义类别"}</small>
              </span>
              <button type="button" onClick={() => { setTaskDialogOpen(false); setActiveView("classes"); }}>管理类别</button>
            </div>
            <div className="dialog-fields">
              <label><span>任务名称</span><input value={taskName} onChange={(event) => setTaskName(event.target.value)} required /></label>
            </div>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setTaskDialogOpen(false)}>取消</button>
              <button className="primary-button" type="submit" disabled={busy}>创建任务</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
