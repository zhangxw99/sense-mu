"use client";

/* eslint-disable @next/next/no-img-element -- The demo supports local data URL uploads that cannot use the optimized image pipeline. */

import {
  Check,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { type ChangeEvent, type CSSProperties, type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCatalogSceneImage, getCoverBoxStyle } from "./catalog-preview";
import type { AlgorithmCatalogItem } from "../../lib/catalog-mock-data";

type DemoSource = "sample" | "upload";
type DemoCanvasStyle = CSSProperties & { "--algorithm-demo-image"?: string };

function directBoxStyle(box: AlgorithmCatalogItem["preview"]["boxes"][number]): CSSProperties {
  return { left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` };
}

export type DemoRealBox = {
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DemoRealInference = {
  modelName: string;
  detect: (image: Blob, threshold: number) => Promise<DemoRealBox[]>;
};

export type DemoSampleOrigin = {
  label: string;
  source?: string | null;
};

export function AlgorithmLiveDemo({ listing, realInference, runDisabled, sampleOrigin }: { listing: AlgorithmCatalogItem; realInference?: DemoRealInference; runDisabled?: string; sampleOrigin?: DemoSampleOrigin }) {
  const [source, setSource] = useState<DemoSource>("sample");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState("");
  const [confidence, setConfidence] = useState(0.25);
  const [running, setRunning] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [realBoxes, setRealBoxes] = useState<DemoRealBox[] | null>(null);
  const [realModelLabel, setRealModelLabel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [uploadedAspectRatio, setUploadedAspectRatio] = useState<number | null>(null);
  // 样例图真实宽高比：img onLoad 时捕获，避免 frame 比例与图片不符导致检测框错位
  const [sampleAspectRatio, setSampleAspectRatio] = useState<number | null>(null);
  // 画布实测尺寸：frame 用像素级 contain 计算，不随响应式宽度失真（百分比方案在宽屏下比例错误）
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setCanvasSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const visibleBoxes = useMemo(
    () => {
      if (realBoxes) {
        // 真实推理框是归一化 0-1，directBoxStyle 按百分比定位，这里统一 ×100
        return realBoxes
          .filter((box) => box.confidence >= confidence)
          .map((box) => ({
            ...box,
            x: box.x * 100,
            y: box.y * 100,
            width: box.width * 100,
            height: box.height * 100,
            confidence: box.confidence.toFixed(2),
          }));
      }
      return listing.preview.boxes.filter((box) => Number(box.confidence ?? 1) >= confidence);
    },
    [confidence, listing.preview.boxes, realBoxes],
  );
  const sceneImage = getCatalogSceneImage(listing.preview.scene);
  const sampleSourceRatio = Math.min(4, Math.max(0.25, sampleAspectRatio
    ?? listing.preview.aspect_ratio ?? sceneImage?.aspectRatio ?? 1));
  const demoFrameRatio = 16 / 10;
  const directSampleImage = listing.preview.image_url ?? sceneImage?.url;
  const activeImage = uploadedImage ?? directSampleImage;
  const activeSourceRatio = uploadedImage ? (uploadedAspectRatio ?? sampleSourceRatio) : sampleSourceRatio;
  const canvasStyle: DemoCanvasStyle | undefined = activeImage
    ? { "--algorithm-demo-image": `url("${activeImage}")` }
    : undefined;

  // frame 尺寸：按画布实测像素做 contain（图片完整放进画布），检测框百分比相对 frame 才与图片对齐。
  // 旧的百分比宽高方案（宽随画布宽、高随画布高）在非 16:10 画布上比例失真——宽屏下框整体错位。
  const containedFrameStyle = useMemo<CSSProperties>(() => {
    const boundedZoom = Math.min(1.4, Math.max(1, zoom));
    if (!canvasSize.width || !canvasSize.height) {
      return { visibility: "hidden" };
    }
    const canvasRatio = canvasSize.width / canvasSize.height;
    let width: number;
    let height: number;
    if (activeSourceRatio < canvasRatio) {
      height = canvasSize.height;
      width = canvasSize.height * activeSourceRatio;
    } else {
      width = canvasSize.width;
      height = canvasSize.width / activeSourceRatio;
    }
    return {
      width: `${Math.round(width * boundedZoom)}px`,
      height: `${Math.round(height * boundedZoom)}px`,
      transform: "translate(-50%, -50%)",
    };
  }, [activeSourceRatio, canvasSize, zoom]);

  function chooseSample() {
    setSource("sample");
    setUploadedImage(null);
    setUploadedFile(null);
    setUploadedName("");
    setRealBoxes(null);
    setHasResult(false);
    setMessage(null);
    setZoom(1);
  }

  function chooseUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("请选择图片文件");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage("图片不能超过 10 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSource("upload");
      setUploadedImage(String(reader.result));
      setUploadedFile(file);
      setUploadedName(file.name);
      setRealBoxes(null);
      setUploadedAspectRatio(null);
      setHasResult(false);
      setMessage(null);
      setZoom(1);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function runDemo() {
    setRunning(true);
    setHasResult(false);
    setMessage(null);
    if (!realInference) {
      window.setTimeout(() => {
        setRunning(false);
        setHasResult(true);
        setMessage(listing.is_mock ? "已生成体验结果；当前为商品效果演示。" : "识别完成");
      }, 620);
      return;
    }
    void (async () => {
      try {
        let blob: Blob;
        if (source === "upload" && uploadedFile) {
          blob = uploadedFile;
        } else if (activeImage) {
          const response = await fetch(activeImage);
          if (!response.ok) throw new Error("样例图片读取失败");
          blob = await response.blob();
        } else {
          throw new Error("请先选择图片");
        }
        const boxes = await realInference.detect(blob, confidence);
        setRealBoxes(boxes);
        setRealModelLabel(realInference.modelName);
        setHasResult(true);
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : "推理失败，请稍后重试");
      } finally {
        setRunning(false);
      }
    })();
  }

  function resetDemo() {
    setHasResult(false);
    setMessage(null);
  }

  // img 加载完成记录真实宽高比：上传图与样例图都走这里，
  // frame（getContainedFrameStyle）必须贴合图片比例，否则百分比定位的检测框会错位
  function captureImageRatio(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    if (!image.naturalWidth || !image.naturalHeight) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    if (uploadedImage) {
      setUploadedAspectRatio(ratio);
    } else {
      setSampleAspectRatio(ratio);
    }
  }

  return (
    <section className="algorithm-live-demo" aria-labelledby="algorithm-live-demo-title">
      <div className="algorithm-demo-heading">
        <div>
          <span>购买前体验</span>
          <h2 id="algorithm-live-demo-title">在线体验</h2>
          <p>选择示例或上传一张图片，直接查看识别结果。</p>
        </div>
        <span className="algorithm-demo-model"><i aria-hidden="true" />{realBoxes ? (realModelLabel ?? realInference?.modelName) ?? listing.model_architecture : listing.model_architecture}</span>
      </div>

      <div className="algorithm-demo-layout">
        <div className="algorithm-demo-stage">
          <div className="algorithm-demo-stagebar">
            <span><ImageIcon size={14} />{source === "sample" ? "商品示例" : uploadedName}</span>
            {hasResult ? <button type="button" onClick={resetDemo}><RotateCcw size={13} />重置结果</button> : <small>输入图片仅用于本次体验</small>}
          </div>

          <div
            ref={canvasRef}
            className={`algorithm-demo-canvas scene-${listing.preview.scene}${source === "upload" ? " is-upload" : ""}${activeImage ? " has-image" : ""}`}
            style={canvasStyle}
            role="img"
            aria-label={source === "sample" ? listing.preview.alt : `待识别图片 ${uploadedName}`}
          >
            {activeImage ? (
              <>
                <span className="algorithm-demo-backdrop" aria-hidden="true" />
                <div className="algorithm-demo-image-frame" style={containedFrameStyle} aria-hidden="true">
                  <img src={activeImage} alt="" onLoad={captureImageRatio} />
                  {hasResult ? visibleBoxes.map((box, index) => (
                    <span className="algorithm-demo-box" key={`${box.label}-${index}`} style={directBoxStyle(box)}>
                      <small>{box.label} {box.confidence != null ? Number(box.confidence).toFixed(2) : ""}</small>
                    </span>
                  )) : null}
                </div>
              </>
            ) : (
              <div
                className={`algorithm-demo-image-frame is-legacy scene-${listing.preview.scene}`}
                style={containedFrameStyle}
                aria-hidden="true"
              >
                {hasResult ? visibleBoxes.map((box, index) => (
                  <span
                    className="algorithm-demo-box"
                    key={`${box.label}-${index}`}
                    style={getCoverBoxStyle(box, sampleSourceRatio, demoFrameRatio)}
                  >
                    <small>{box.label} {box.confidence}</small>
                  </span>
                )) : null}
              </div>
            )}
            {running ? (
              <span className="algorithm-demo-running"><LoaderCircle size={21} className="spinner" />正在识别</span>
            ) : null}
            {!hasResult && !running ? <span className="algorithm-demo-ready">点击“运行识别”查看效果</span> : null}
          </div>

          <div className="algorithm-demo-resultbar" aria-live="polite">
            {hasResult ? (
              <>
                <span><Check size={14} />识别完成</span>
                <strong>{visibleBoxes.length} 个目标</strong>
                <small>{realBoxes ? `真实推理 · ${realModelLabel ?? "模型"} · ` : listing.latency_p95 ? `${listing.latency_p95.replace("P95", "")} · ` : ""}置信度 ≥ {confidence.toFixed(2)}</small>
              </>
            ) : <small>{message ?? "支持 JPEG、PNG、WebP，最大 10 MB"}</small>}
          </div>
          {source === "sample" && (sampleOrigin || sceneImage) ? (
            <p className="algorithm-demo-sample-origin">
              <span>{sampleOrigin ? sampleOrigin.label : (sceneImage?.assetKind === "dataset-preview" ? "数据集官方预览图" : "真实公开样本")}</span>
              {sampleOrigin
                ? (sampleOrigin.source ? <span>{sampleOrigin.source}</span> : null)
                : (sceneImage ? <a href={sceneImage.sourceUrl} target="_blank" rel="noreferrer">{sceneImage.dataset} · {sceneImage.license}</a> : null)}
              {sampleOrigin ? null : <small>识别框仅为 Mock 演示。</small>}
            </p>
          ) : null}
        </div>

        <aside className="algorithm-demo-controls">
          <div className="algorithm-demo-control-heading"><strong>输入图片</strong><small>选择一种方式</small></div>
          <div className="algorithm-demo-source-grid">
            <button type="button" className={source === "sample" ? "is-active" : ""} onClick={chooseSample}>
              <span
                className={`algorithm-demo-thumb scene-${listing.preview.scene}`}
                style={{ backgroundImage: `url(${listing.preview.image_url ?? sceneImage?.url ?? "/catalog-vision-samples.png"})`, backgroundPosition: "center", backgroundSize: "cover" }}
              />
              <span><strong>商品示例</strong><small>立即体验</small></span>
              {source === "sample" ? <Check size={13} /> : null}
            </button>
            <label className={source === "upload" ? "is-active" : ""}>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseUpload} />
              <UploadCloud size={17} />
              <span><strong>上传图片</strong><small>仅在本地预览</small></span>
            </label>
          </div>

          <label className="algorithm-demo-confidence">
            <span><strong>图像缩放</strong><b>{Math.round(zoom * 100)}%</b></span>
            <input aria-label="体验图片缩放" type="range" min="1" max="1.4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            <small>100% 完整显示；放大时可查看局部细节。</small>
          </label>

          <label className="algorithm-demo-confidence">
            <span><strong>置信度</strong><b>{confidence.toFixed(2)}</b></span>
            <input type="range" min="0.05" max="0.95" step="0.05" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
            <small>数值越高，结果越严格。</small>
          </label>

          <div className="algorithm-demo-privacy"><ShieldCheck size={15} /><span><strong>体验图片不留存</strong><small>当前页面不会把上传图片保存到素材库。</small></span></div>

          {message ? <p className="algorithm-demo-message" role="status">{message}</p> : null}
          <button
            className="primary-button algorithm-demo-run"
            type="button"
            disabled={running || Boolean(runDisabled)}
            title={runDisabled}
            onClick={runDemo}
          >
            {running ? <LoaderCircle size={15} className="spinner" /> : <Play size={15} />}
            {running ? "正在识别" : "运行识别"}
          </button>
          {runDisabled ? <p className="algorithm-demo-disclaimer">{runDisabled}</p> : null}
          {realBoxes ? (
            <p className="algorithm-demo-disclaimer">结果来自 edge 推理服务真实调用（当前激活模型）。</p>
          ) : listing.is_mock ? <p className="algorithm-demo-disclaimer">当前为商品效果演示；真实调用结果以正式 API 为准。</p> : null}
        </aside>
      </div>
    </section>
  );
}
