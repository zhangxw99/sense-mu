"use client";

import {
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  LoaderCircle,
  MousePointer2,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Undo2,
  Redo2,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AutomlAnnotation,
  type AutomlDatasetClass,
  type AutomlDatasetItem,
  type AutomlId,
  getAutomlFileUrls,
  listAutomlAnnotationTasks,
  listAutomlAnnotations,
  listAutomlDatasetClasses,
  listAutomlDatasetItems,
  saveAutomlAnnotations,
} from "../../../../lib/automl-data-api";
import { containFramePercentages, type ContainFrame } from "../../../../lib/annotation-geometry";
import { samDetectionsToBoxDrafts } from "../../../../lib/sam-annotation";
import { fetchImageAsDataUrl, predictSamDetections } from "../../../../lib/sam-api";
import { DynamicAssetImage } from "../../../components/dynamic-asset-image";

type Tool = "select" | "box";

type EditorBox = {
  id: string;
  label: string;
  colorIndex: number;
  // 左上角坐标与宽高，单位为图片百分比 0-100；保存时归一化为 0-1。
  x: number;
  y: number;
  width: number;
  height: number;
  // MODEL_ASSISTED 为 AI 识别生成的框（画布上以紫色虚线区分），保存时随标注逐条上报。
  // IMPORT 为文件导入的标注（无任务归属），保存后并入当前任务并保留溯源。
  sourceCd?: "MANUAL" | "MODEL_ASSISTED" | "IMPORT";
  confidence?: number | null;
};

const PAGE_SIZE = 20;
const MAX_ITEM_LOOKUP_PAGES = 5;
const URL_TTL_SECONDS = 3600;

function bboxToBox(annotation: AutomlAnnotation, classIndexByName: Map<string, number>): EditorBox | null {
  const geometry = annotation.annotationJson ?? {};
  if (typeof geometry.x !== "number" || typeof geometry.y !== "number"
    || typeof geometry.w !== "number" || typeof geometry.h !== "number") {
    return null;
  }
  const label = annotation.labelName;
  return {
    id: `server-${annotation.id}`,
    label,
    colorIndex: classIndexByName.get(label) ?? Math.abs(hashLabel(label)) % 3,
    x: geometry.x * 100,
    y: geometry.y * 100,
    width: geometry.w * 100,
    height: geometry.h * 100,
    // 后端把 MODEL_ASSISTED 归一化存储为 MODEL，回读时还原成 AI 框样式；IMPORT（导入标注）保真透传。
    sourceCd: annotation.sourceCd === "MODEL" || annotation.sourceCd === "MODEL_ASSISTED"
      ? "MODEL_ASSISTED"
      : annotation.sourceCd === "IMPORT" ? "IMPORT" : "MANUAL",
    confidence: annotation.confidence,
  };
}

function hashLabel(label: string): number {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) | 0;
  }
  return hash;
}

// 模块层生成框 ID（时间戳 + 序列 + 随机段），避免在组件内调用不纯函数。
let boxIdSequence = 0;

function createBoxId(prefix: string): string {
  boxIdSequence += 1;
  return `${prefix}-${Date.now()}-${boxIdSequence}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AutomlAnnotationEditor() {
  const searchParams = useSearchParams();
  const requestedDatasetId = searchParams.get("dataset") ?? "";
  const requestedVersionId = searchParams.get("version") ?? "";
  const requestedTaskId = searchParams.get("task") ?? "";
  const requestedItemId = searchParams.get("item");

  const datasetId = requestedDatasetId;
  const versionId = requestedVersionId;
  const [taskId, setTaskId] = useState(requestedTaskId);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"info" | "success">("info");
  const [saving, setSaving] = useState(false);

  const [classes, setClasses] = useState<AutomlDatasetClass[] | null>(null);
  const [items, setItems] = useState<AutomlDatasetItem[]>([]);
  const [itemTotal, setItemTotal] = useState<AutomlId | null>(null);
  const [page, setPage] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [boxes, setBoxes] = useState<EditorBox[]>([]);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [selectedLabelIndex, setSelectedLabelIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
  const [imageLoading, setImageLoading] = useState(false);
  const [history, setHistory] = useState<EditorBox[][]>([]);
  const [future, setFuture] = useState<EditorBox[][]>([]);
  const [draftBox, setDraftBox] = useState<EditorBox | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // object-fit: contain 下图片实际显示区域（画布百分比），框层挂在其上以随画布缩放对齐。
  const [imageFrame, setImageFrame] = useState<ContainFrame | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const boxesRef = useRef<EditorBox[]>([]);
  const historyRef = useRef<EditorBox[][]>([]);
  const futureRef = useRef<EditorBox[][]>([]);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const urlCacheRef = useRef(new Map<string, { url: string; expiresAt: number }>());
  // 最近一次 batch-urls 发起时间：后端同 URL 防抖锁窗 1s，任何补发请求都必须避开该窗口。
  const lastBatchUrlsAtRef = useRef(0);
  // AI 标注运行期间用来识别「样本已切换」，避免过期结果叠加到新样本上。
  const currentItemIdRef = useRef<AutomlId | null>(null);
  // 样本图片 dataURL 缓存（SAM 只收 base64），按 objectKey 复用，避免重复拉取大图。
  const imageDataCacheRef = useRef(new Map<string, string>());

  const item = items[currentIndex] ?? null;
  const labelNames = useMemo(
    () => (classes ?? []).map((entry) => entry.className).filter(Boolean),
    [classes],
  );
  const classIndexByName = useMemo(
    () => new Map(labelNames.map((name, index) => [name, index])),
    [labelNames],
  );
  const currentLabelCounts = useMemo(
    () => labelNames.map((label) => boxes.filter((box) => box.label === label).length),
    [boxes, labelNames],
  );
  const contextReady = Boolean(datasetId.trim() && versionId.trim());

  // 操作反馈统一走 notify：默认灰色 info，保存/AI 等关键成功用绿色 success。
  function notify(message: string, tone: "info" | "success" = "info") {
    setNoticeTone(tone);
    setNotice(message);
  }

  function resetCanvasState() {
    boxesRef.current = [];
    setBoxes([]);
    historyRef.current = [];
    futureRef.current = [];
    setHistory([]);
    setFuture([]);
    setDraftBox(null);
    setSelectedId(null);
    setImageFrame(null);
  }

  async function loadItems(nextPage: number, selectItemId?: AutomlId | null): Promise<void> {
    if (!contextReady) {
      setError("缺少数据集 ID 或版本 ID，请从 AutoML 联调台进入");
      return;
    }
    setItemsLoading(true);
    setError(null);
    try {
      const result = await listAutomlDatasetItems(datasetId.trim(), versionId.trim(), {
        page: nextPage,
        limit: PAGE_SIZE,
      });
      setItems(result.rows);
      setItemTotal(result.total);
      setPage(nextPage);
      if (selectItemId != null) {
        const targetIndex = result.rows.findIndex((row) => String(row.itemId) === String(selectItemId));
        setCurrentIndex(targetIndex >= 0 ? targetIndex : 0);
      } else {
        setCurrentIndex(0);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "样本列表加载失败");
    } finally {
      setItemsLoading(false);
    }
  }

  // 定位 query 指定的样本：最多扫前几页，找到后停在所在页。
  useEffect(() => {
    if (!contextReady) return;
    let cancelled = false;
    async function locate() {
      if (!requestedItemId) {
        await loadItems(1);
        return;
      }
      for (let scanPage = 1; scanPage <= MAX_ITEM_LOOKUP_PAGES && !cancelled; scanPage += 1) {
        const result = await listAutomlDatasetItems(datasetId.trim(), versionId.trim(), {
          page: scanPage,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;
        const targetIndex = result.rows.findIndex((row) => String(row.itemId) === String(requestedItemId));
        if (targetIndex >= 0 || scanPage * PAGE_SIZE >= Number(result.total)) {
          setItems(result.rows);
          setItemTotal(result.total);
          setPage(scanPage);
          setCurrentIndex(targetIndex >= 0 ? targetIndex : 0);
          setItemsLoading(false);
          return;
        }
      }
      if (!cancelled) await loadItems(1);
    }
    setItemsLoading(true);
    void locate().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "样本列表加载失败");
    }).finally(() => {
      if (!cancelled) setItemsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // 仅在首次进入时按 query 定位；后续翻页由 loadItems 驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当页样本批量换取预签名缩略图 URL。
  // 本 effect 是页面上唯一的 batch-urls 调用方（主画布 URL 也从这里取）：
  // 后端对同 URL 有 1s 防抖锁，若主画布 effect 再单独发一次会被 400，导致主图加载失败。
  useEffect(() => {
    const candidates = items
      .map((entry) => entry.sampleObjectKey)
      .filter((objectKey) => objectKey && !thumbs[objectKey] && !thumbFailed[objectKey]);
    if (!candidates.length) return;
    let cancelled = false;
    const cached: Array<[string, string]> = [];
    const pending: string[] = [];
    for (const objectKey of candidates) {
      const hit = urlCacheRef.current.get(objectKey);
      if (hit && hit.expiresAt > Date.now() + 60_000) cached.push([objectKey, hit.url]);
      else pending.push(objectKey);
    }
    async function fetchThumbs(): Promise<Array<[string, string]>> {
      const collected = [...cached];
      for (let attempt = 0; attempt < 3 && pending.length && !cancelled; attempt += 1) {
        lastBatchUrlsAtRef.current = Date.now();
        try {
          const urls = await getAutomlFileUrls(pending, URL_TTL_SECONDS);
          for (const entry of urls) {
            collected.push([entry.objectKey, entry.url]);
            urlCacheRef.current.set(entry.objectKey, { url: entry.url, expiresAt: Date.parse(entry.expiresAt) });
          }
          break;
        } catch {
          // 重试间隔必须 > 1s 锁窗，否则三次重试全部撞锁。
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1100));
        }
      }
      return collected;
    }
    void fetchThumbs().then((entries) => {
      if (cancelled || !entries.length) return;
      setThumbs((current) => {
        const next = { ...current };
        for (const [objectKey, url] of entries) next[objectKey] = url;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!datasetId.trim()) {
      setClasses(null);
      return;
    }
    let cancelled = false;
    void listAutomlDatasetClasses(datasetId.trim())
      .then((result) => {
        if (!cancelled) setClasses(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "数据集类别加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  // URL 未带 task 参数时自动关联版本的标注任务，避免保存被空任务 ID 拦下而静默不发请求。
  useEffect(() => {
    if (!contextReady || taskId.trim()) return;
    let cancelled = false;
    void listAutomlAnnotationTasks(datasetId.trim(), versionId.trim())
      .then((tasks) => {
        if (cancelled) return;
        const first = tasks[0];
        if (!first) {
          notify("当前版本还没有标注任务，保存标注前请先在联调台创建");
          return;
        }
        setTaskId(String(first.id));
        notify(`已自动关联标注任务「${first.name}」，可在上方输入框更换`);
      })
      .catch(() => {
        if (!cancelled) notify("标注任务列表读取失败，请手动填写任务 ID 后保存");
      });
    return () => {
      cancelled = true;
    };
    // 仅在进入页面缺任务 ID 时兜底拉取一次；后续以输入框为准。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, versionId]);

  // 当前样本变化：取预签名图片 URL + 读取已有标注。
  useEffect(() => {
    resetCanvasState();
    currentItemIdRef.current = item?.itemId ?? null;
    setAiBusy(false);
    if (!item) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    const objectKey = item.sampleObjectKey;
    async function loadCurrent() {
      const cached = urlCacheRef.current.get(objectKey);
      if (cached && cached.expiresAt > Date.now() + 60_000) {
        setImageUrl(cached.url);
      } else {
        setImageLoading(true);
        setImageUrl(null);
        // 常规路径等待缩略图批量 effect（页面上唯一的 batch-urls 调用方）带回本样本 URL；
        // 仅当该 key 的缩略图已确认失败时才单独兜底，且必须避开 1s 防抖锁窗。
        if (thumbFailed[objectKey] && Date.now() - lastBatchUrlsAtRef.current > 1100) {
          try {
            const [first] = await getAutomlFileUrls([objectKey], URL_TTL_SECONDS);
            if (cancelled) return;
            if (!first) throw new Error("服务端未返回访问地址");
            urlCacheRef.current.set(objectKey, { url: first.url, expiresAt: Date.parse(first.expiresAt) });
            setThumbs((current) => ({ ...current, [objectKey]: first.url }));
            setImageUrl(first.url);
          } catch (reason) {
            if (!cancelled) notify(reason instanceof Error ? reason.message : "样本图片读取失败");
          } finally {
            if (!cancelled) setImageLoading(false);
          }
        }
      }
      if (!contextReady) return;
      try {
        // 不带任务过滤：展示样本全部标注（含无任务归属的导入标注），否则导入内容不可见。
        const annotations = await listAutomlAnnotations(
          datasetId.trim(),
          versionId.trim(),
          item.itemId,
        );
        if (cancelled) return;
        const nextBoxes = annotations
          .map((annotation) => bboxToBox(annotation, classIndexByName))
          .filter((box): box is EditorBox => box !== null);
        const skipped = annotations.length - nextBoxes.length;
        boxesRef.current = nextBoxes;
        setBoxes(nextBoxes);
        notify(skipped > 0 ? `已读取 ${nextBoxes.length} 条矩形框标注（${skipped} 条非矩形格式已忽略）` : `已读取 ${nextBoxes.length} 条标注`);
      } catch (reason) {
        if (!cancelled) notify(reason instanceof Error ? reason.message : "标注读取失败");
      }
    }
    void loadCurrent();
    return () => {
      cancelled = true;
    };
    // classIndexByName 随类别加载完成而变化，此时需要按新类别重新着色，但不必重取图片。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.itemId, classIndexByName]);

  // 主画布 URL 的派生填充：缩略图批量 effect 拉回当前样本 URL 后（含首次进入的等待路径），同步到主画布。
  // 声明在主画布 effect 之后，保证同一渲染周期内先重置、后填充。
  useEffect(() => {
    if (!item) return;
    const objectKey = item.sampleObjectKey;
    const thumbUrl = thumbs[objectKey];
    if (thumbUrl && !thumbFailed[objectKey]) {
      setImageUrl(thumbUrl);
      setImageLoading(false);
    }
  }, [thumbs, item, thumbFailed]);

  function getImageFrame() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image?.naturalWidth || !image.naturalHeight) return null;
    const bounds = canvas.getBoundingClientRect();
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const canvasRatio = bounds.width / bounds.height;
    const width = imageRatio >= canvasRatio ? bounds.width : bounds.height * imageRatio;
    const height = imageRatio >= canvasRatio ? bounds.width / imageRatio : bounds.height;
    return {
      left: bounds.left + (bounds.width - width) / 2,
      top: bounds.top + (bounds.height - height) / 2,
      width,
      height,
    };
  }

  function getImagePoint(clientX: number, clientY: number) {
    const frame = getImageFrame();
    if (!frame || frame.width <= 0 || frame.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(100, ((clientX - frame.left) / frame.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - frame.top) / frame.height) * 100)),
    };
  }

  // 重算图片实际显示区域（画布百分比）：图片加载完成与画布尺寸变化时调用。
  function updateImageFrame() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image?.naturalWidth || !image.naturalHeight) {
      setImageFrame(null);
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    setImageFrame(containFramePercentages(bounds.width, bounds.height, image.naturalWidth, image.naturalHeight));
  }

  // 画布随窗口/布局缩放时同步框层位置，保证标注框始终贴合图片。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateImageFrame());
    observer.observe(canvas);
    return () => observer.disconnect();
    // 画布尺寸由 flex/grid 决定，ResizeObserver 只在尺寸变化时触发回调。
  }, []);

  function applyBoxes(nextBoxes: EditorBox[], message: string) {
    historyRef.current = [...historyRef.current, boxesRef.current];
    futureRef.current = [];
    setHistory(historyRef.current);
    setFuture(futureRef.current);
    boxesRef.current = nextBoxes;
    setBoxes(nextBoxes);
    setNotice(message);
  }

  function deleteBox(boxId: string) {
    applyBoxes(boxesRef.current.filter((box) => box.id !== boxId), "已删除标注，可撤销恢复");
    if (selectedId === boxId) setSelectedId(null);
  }

  function undo() {
    const previous = historyRef.current[historyRef.current.length - 1];
    if (!previous) return;
    futureRef.current = [boxesRef.current, ...futureRef.current];
    historyRef.current = historyRef.current.slice(0, -1);
    setFuture(futureRef.current);
    setHistory(historyRef.current);
    boxesRef.current = previous;
    setBoxes(previous);
    setSelectedId(null);
    notify("已撤销上一步操作");
  }

  function redo() {
    const next = futureRef.current[0];
    if (!next) return;
    historyRef.current = [...historyRef.current, boxesRef.current];
    futureRef.current = futureRef.current.slice(1);
    setHistory(historyRef.current);
    setFuture(futureRef.current);
    boxesRef.current = next;
    setBoxes(next);
    setSelectedId(null);
    notify("已重做上一步操作");
  }

  function beginBox(event: React.PointerEvent<HTMLDivElement>) {
    if (activeTool !== "box" || dragRef.current) return;
    if (!labelNames.length) {
      notify("数据集还没有类别，请先在联调台「类别」页签维护");
      return;
    }
    const point = getImagePoint(event.clientX, event.clientY);
    if (!point) {
      notify("图片尚未加载完成");
      return;
    }
    dragRef.current = { pointerId: event.pointerId, startX: point.x, startY: point.y };
    setDraftBox({
      id: "draft",
      label: labelNames[selectedLabelIndex],
      colorIndex: selectedLabelIndex,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateBox(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = getImagePoint(event.clientX, event.clientY);
    if (!point) return;
    setDraftBox((current) => current ? {
      ...current,
      x: Math.min(drag.startX, point.x),
      y: Math.min(drag.startY, point.y),
      width: Math.abs(point.x - drag.startX),
      height: Math.abs(point.y - drag.startY),
    } : null);
  }

  function completeBox(clientX: number, clientY: number, cancelled = false) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = getImagePoint(clientX, clientY);
    const draft = point ? {
      x: Math.min(drag.startX, point.x),
      y: Math.min(drag.startY, point.y),
      width: Math.abs(point.x - drag.startX),
      height: Math.abs(point.y - drag.startY),
    } : null;
    dragRef.current = null;
    setDraftBox(null);
    if (cancelled || !draft || draft.width < 1 || draft.height < 1) {
      if (!cancelled) notify("框选范围太小，请重新拖拽");
      return;
    }
    const id = createBoxId("box");
    applyBoxes(
      [...boxesRef.current, { id, label: labelNames[selectedLabelIndex], colorIndex: selectedLabelIndex, ...draft }],
      "已添加矩形框，保存后写入数据集",
    );
    setSelectedId(id);
  }

  function finishBox(event: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    completeBox(event.clientX, event.clientY, cancelled);
    if (typeof event.pointerId === "number" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      // Delete/Backspace 删除当前选中的标注框，与「删除选中标注」按钮等效。
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        applyBoxes(boxesRef.current.filter((box) => box.id !== selectedId), "已删除选中标注，保存后同步到数据集");
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    function handleWindowPointerUp(event: MouseEvent) {
      if (dragRef.current) completeBox(event.clientX, event.clientY);
    }
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("mouseup", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("mouseup", handleWindowPointerUp);
    };
  });

  async function saveAnnotations() {
    if (!contextReady || !item) {
      notify("缺少数据集、版本或样本");
      return;
    }
    if (!taskId.trim()) {
      notify("缺少标注任务 ID，请先在联调台创建标注任务或在上方输入框填写");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAutomlAnnotations(datasetId.trim(), versionId.trim(), item.itemId, {
        annotationTaskId: taskId.trim(),
      annotations: boxesRef.current.map((box) => ({
        labelName: box.label,
        annotationJson: {
          type: "bbox",
          x: box.x / 100,
          y: box.y / 100,
          w: box.width / 100,
          h: box.height / 100,
        },
        ...(box.confidence != null ? { confidence: box.confidence } : {}),
        sourceCd: box.sourceCd ?? ("MANUAL" as const),
      })),
      });
      const nextBoxes = saved
        .map((annotation) => bboxToBox(annotation, classIndexByName))
        .filter((box): box is EditorBox => box !== null);
      boxesRef.current = nextBoxes;
      setBoxes(nextBoxes);
      historyRef.current = [];
      futureRef.current = [];
      setHistory([]);
      setFuture([]);
      notify(`已保存 ${nextBoxes.length} 条标注`, "success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "标注保存失败");
    } finally {
      setSaving(false);
    }
  }

  function moveItem(direction: -1 | 1) {
    setCurrentIndex((current) => Math.max(0, Math.min(Math.max(items.length - 1, 0), current + direction)));
    setSelectedId(null);
  }

  // AI 标注：把当前样本图交给 SAM 分割服务识别数据集类别目标，
  // 返回后叠加到画布（紫色虚线框）并复用保存链路自动落库。
  async function runAiAnnotate() {
    if (!item || aiBusy || saving) return;
    if (!imageUrl) {
      notify("样本图片尚未加载完成，请稍后再试");
      return;
    }
    if (!labelNames.length) {
      notify("数据集还没有类别，AI 标注需要先在联调台维护类别");
      return;
    }
    const runItemId = item.itemId;
    setAiBusy(true);
    setError(null);
    try {
      const objectKey = item.sampleObjectKey;
      let imageDataUrl = imageDataCacheRef.current.get(objectKey);
      if (!imageDataUrl) {
        imageDataUrl = await fetchImageAsDataUrl(imageUrl);
        imageDataCacheRef.current.set(objectKey, imageDataUrl);
      }
      const result = await predictSamDetections({ imageDataUrl, classes: labelNames });
      if (currentItemIdRef.current !== runItemId) return; // 等待期间已切换样本，丢弃过期结果
      const { drafts, skipped } = samDetectionsToBoxDrafts(result.detections, result.imageSize, labelNames);
      if (!drafts.length) {
        notify(skipped
          ? `AI 未识别出可标注目标（${skipped} 条结果与数据集类别不匹配，已忽略）`
          : "AI 未识别出目标，可调整数据集类别词后重试");
        return;
      }
      const aiBoxes: EditorBox[] = drafts.map((draft) => ({
        id: createBoxId("ai"),
        ...draft,
        sourceCd: "MODEL_ASSISTED" as const,
      }));
      const recognizedLabels = [...new Set(aiBoxes.map((box) => box.label))].join("、");
      applyBoxes(
        [...boxesRef.current, ...aiBoxes],
        `AI 识别出 ${aiBoxes.length} 个目标（${recognizedLabels}），正在自动保存…`,
      );
      await saveAnnotations();
    } catch (reason) {
      if (currentItemIdRef.current !== runItemId) return;
      if (reason instanceof TypeError) {
        setError("样本图片读取失败（可能被跨域策略拦截），请检查对象存储 CORS 配置");
      } else {
        setError(reason instanceof Error ? reason.message : "AI 标注失败，请稍后重试");
      }
    } finally {
      setAiBusy(false);
    }
  }

  async function changePage(direction: -1 | 1) {
    const nextPage = Math.max(1, page + direction);
    if (direction > 0 && itemTotal != null && nextPage * PAGE_SIZE > Number(itemTotal) + PAGE_SIZE) return;
    await loadItems(nextPage);
  }

  // 返回目标按来源区分：数据与标注页（from=data）回数据集详情，其余回联调台。
  const returnToDataPage = searchParams.get("from") === "data";
  const backHref = !datasetId
    ? "/studio/automl"
    : returnToDataPage
      ? `/studio/data?dataset=${encodeURIComponent(datasetId)}&version=${encodeURIComponent(versionId)}`
      : `/studio/automl?dataset=${encodeURIComponent(datasetId)}&version=${encodeURIComponent(versionId)}`;
  const backLabel = returnToDataPage ? "返回数据集" : "返回联调台";

  if (!requestedDatasetId || !requestedVersionId) {
    return (
      <main className="annotation-editor-page">
        <div className="annotation-editor-empty">
          <ListChecks size={20} />
          <p>请从 AutoML 联调台的样本列表进入标注。</p>
          <Link className="secondary-button" href="/studio/automl">返回联调台</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="annotation-editor-page">
      <header className="annotation-editor-header">
        <div className="editor-title-group">
          <Link href={backHref} className="editor-back-link"><ChevronLeft size={15} />{backLabel}</Link>
          <span className="editor-title-divider" />
          <div>
            <strong>{item?.originName ?? "样本标注"}</strong>
            <small>
              第 {page} 页 · 第 {(page - 1) * PAGE_SIZE + currentIndex + 1} / 共 {itemTotal ?? "-"} 个样本
            </small>
          </div>
        </div>
        <div className="editor-history-actions">
          <button type="button" aria-label="撤销" title="撤销" disabled={!history.length} onClick={undo}><Undo2 size={15} /></button>
          <button type="button" aria-label="重做" title="重做" disabled={!future.length} onClick={redo}><Redo2 size={15} /></button>
          <input
            className="automl-inline-input"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            placeholder="标注任务 ID（保存必填）"
            aria-label="标注任务 ID"
          />
        </div>
        <div className="editor-primary-actions">
          <button className="secondary-button" type="button" disabled={saving || itemsLoading} onClick={() => void loadItems(page)}>
            <RefreshCw size={14} className={itemsLoading ? "spinner" : undefined} />刷新
          </button>
          <button className="primary-button" type="button" disabled={saving || !item} onClick={() => void saveAnnotations()}>
            {saving ? <LoaderCircle size={14} className="spinner" /> : <Save size={14} />}
            保存标注
          </button>
        </div>
        {error ? (
          <p className="annotation-editor-notice" role="alert">{error}</p>
        ) : (
          <p className={`annotation-editor-notice${noticeTone === "success" ? " is-success" : ""}`} role="status" aria-live="polite">
            {notice ?? (itemsLoading ? "正在读取样本…" : "就绪")}
          </p>
        )}
      </header>
      <div className="annotation-editor-workspace">
        <aside className="annotation-tool-rail" aria-label="标注工具">
          <button type="button" className={activeTool === "select" ? "is-active" : ""} aria-label="选择" title="选择" onClick={() => setActiveTool("select")}><MousePointer2 size={18} /><span>选择</span></button>
          <button type="button" className={activeTool === "box" ? "is-active" : ""} aria-label="矩形框" title="矩形框" onClick={() => setActiveTool("box")}><Square size={18} /><span>矩形框</span></button>
          <div className="tool-rail-divider" aria-hidden="true" />
          <button
            type="button"
            className="ai-annotate-button"
            aria-label="AI 标注"
            title="AI 自动识别数据集类别并生成矩形框（SAM）"
            disabled={aiBusy || saving || !item || !imageUrl}
            onClick={() => void runAiAnnotate()}
          >
            {aiBusy ? <LoaderCircle size={18} className="spinner" /> : <WandSparkles size={18} />}
            <span>AI 标注</span>
          </button>
        </aside>
        <section className="annotation-canvas-column">
          <div className={`annotation-canvas tool-${activeTool}`} ref={canvasRef} aria-label="标注画布">
            {imageUrl ? (
              <DynamicAssetImage ref={imageRef} className="annotation-source-image" src={imageUrl} alt="当前样本" onLoad={() => updateImageFrame()} />
            ) : (
              <LoaderCircle className="spinner" size={24} />
            )}
            {imageLoading ? <span className="canvas-help">正在获取样本图片…</span> : null}
            {activeTool === "box" ? (
              <div
                className="canvas-drag-layer"
                role="presentation"
                aria-label={`添加「${labelNames[selectedLabelIndex] ?? "类别"}」矩形框`}
                onPointerDown={beginBox}
                onPointerMove={updateBox}
                onPointerUp={finishBox}
                onPointerCancel={(event) => finishBox(event, true)}
                onLostPointerCapture={finishBox}
                onMouseUp={(event) => completeBox(event.clientX, event.clientY)}
              />
            ) : null}
            {imageFrame ? (
              <div
                className="annotation-image-frame"
                style={{ left: `${imageFrame.left}%`, top: `${imageFrame.top}%`, width: `${imageFrame.width}%`, height: `${imageFrame.height}%` }}
              >
                {boxes.map((box) => (
                  <button
                    type="button"
                    key={box.id}
                    className={`canvas-box label-${box.colorIndex % 3}${box.sourceCd === "MODEL_ASSISTED" ? " is-suggested" : ""}${selectedId === box.id ? " is-selected" : ""}`}
                    style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(box.id);
                      setActiveTool("select");
                    }}
                    aria-label={`${box.label}标注`}
                  >
                    <span>{box.label}</span>
                  </button>
                ))}
                {draftBox ? (
                  <div
                    className={`canvas-box is-draft label-${draftBox.colorIndex % 3}`}
                    style={{ left: `${draftBox.x}%`, top: `${draftBox.y}%`, width: `${draftBox.width}%`, height: `${draftBox.height}%` }}
                    aria-hidden="true"
                  >
                    <span>{draftBox.label}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {aiBusy ? (
              <div className="annotation-ai-overlay" role="status" aria-live="polite">
                <LoaderCircle size={26} className="spinner" />
                <strong>AI 正在识别标注…</strong>
                <small>SAM 分割服务处理中，最长可能需要 1 分钟</small>
              </div>
            ) : null}
            {activeTool === "box" && labelNames.length ? (
              <span className="canvas-help">在图片上按住并拖拽，框选「{labelNames[selectedLabelIndex]}」</span>
            ) : null}
            {!labelNames.length && classes !== null ? (
              <span className="canvas-help">数据集还没有类别，请先在联调台维护类别</span>
            ) : null}
          </div>
          <footer className="annotation-filmstrip">
            <div className="filmstrip-main-row">
            <button type="button" onClick={() => moveItem(-1)} aria-label="上一张" disabled={currentIndex === 0}><ChevronLeft size={17} /></button>
            <div className="filmstrip-items">
              {items.map((entry, index) => {
                const thumb = thumbs[entry.sampleObjectKey];
                const failed = thumbFailed[entry.sampleObjectKey];
                return (
                  <button
                    type="button"
                    key={entry.itemId}
                    className={entry.itemId === item?.itemId ? "is-active" : ""}
                    onClick={() => {
                      setCurrentIndex(index);
                      setSelectedId(null);
                    }}
                  >
                    {thumb && !failed ? (
                      <img
                        className="filmstrip-thumb"
                        src={thumb}
                        alt=""
                        onError={() => setThumbFailed((current) => ({ ...current, [entry.sampleObjectKey]: true }))}
                      />
                    ) : (
                      <span className={`filmstrip-scene${Number(entry.annotatedItemCount) > 0 ? " is-annotated" : ""}`} />
                    )}
                    <small>{(page - 1) * PAGE_SIZE + index + 1}</small>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => moveItem(1)} aria-label="下一张" disabled={!items.length || currentIndex >= items.length - 1}><ChevronRight size={17} /></button>
            </div>
            <div className="filmstrip-controls-row">
              <span className="filmstrip-pagination">
                第 {page} / {itemTotal != null ? Math.max(1, Math.ceil(Number(itemTotal) / PAGE_SIZE)) : 1} 页 · 共 {itemTotal != null ? Number(itemTotal).toLocaleString("zh-CN") : "-"} 个样本
              </span>
              <div className="filmstrip-page-buttons">
                <button type="button" className="secondary-button compact" onClick={() => void changePage(-1)} disabled={page <= 1 || itemsLoading}>上一页</button>
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => void changePage(1)}
                  disabled={itemsLoading || (itemTotal != null && page * PAGE_SIZE >= Number(itemTotal))}
                >
                  下一页
                </button>
              </div>
            </div>
          </footer>
        </section>
        <aside className="annotation-inspector">
          <section>
            <div className="inspector-heading">
              <div><strong>类别</strong><small>来自数据集类别定义</small></div>
              <span>{labelNames.length}</span>
            </div>
            <div className="annotation-class-list">
              {labelNames.map((name, index) => (
                <button
                  type="button"
                  className={selectedLabelIndex === index ? "is-active" : ""}
                  key={`${name}-${index}`}
                  onClick={() => setSelectedLabelIndex(index)}
                >
                  <i className={`class-color color-${index % 3}`} />
                  <span>{name}</span>
                  <small>{currentLabelCounts[index] ?? 0}</small>
                </button>
              ))}
              {!labelNames.length ? <p className="annotation-editor-notice">暂无类别。矩形框标注需要先维护类别。</p> : null}
            </div>
          </section>
          <section>
            <div className="inspector-heading">
              <div><strong>本张标注</strong><small>{boxes.length} 个矩形框 · 保存时全量覆盖</small></div>
            </div>
            <div className="instance-list">
              {boxes.map((box, index) => (
                <div className="instance-row" key={box.id}>
                  <button
                    type="button"
                    className={`instance-row-main${selectedId === box.id ? " is-active" : ""}`}
                    onClick={() => setSelectedId(box.id)}
                  >
                    <i className={`class-color color-${box.colorIndex % 3}`} />
                    <span>{box.label} {index + 1}</span>
                  </button>
                  <button
                    type="button"
                    className="instance-row-delete"
                    aria-label={`删除 ${box.label} ${index + 1}`}
                    title="删除此标注"
                    onClick={() => deleteBox(box.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {!boxes.length ? <p className="annotation-editor-notice">暂无标注。</p> : null}
            </div>
            <button
              className="delete-annotation-button"
              type="button"
              disabled={!selectedId}
              onClick={() => {
                if (!selectedId) return;
                deleteBox(selectedId);
              }}
            >
              <Trash2 size={14} />删除选中标注
            </button>
          </section>
          <section className="smart-label-panel">
            <div className="inspector-heading">
              <div><strong>任务信息</strong><small>保存前请确认</small></div>
              <BookmarkPlus size={15} />
            </div>
            <p>数据集 {datasetId} · 版本 {versionId}{taskId ? ` · 任务 ${taskId.trim()}` : " · 未填任务 ID"}</p>
            <p><Check size={12} aria-hidden="true" /> 标注几何使用归一化坐标（0-1）全量覆盖保存。</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
