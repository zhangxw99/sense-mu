"use client";

import { ArrowUpRight, BadgeCheck, Database, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CatalogFilterMenu } from "../components/catalog-filter-menu";
import { CatalogPreview } from "../components/catalog-preview";
import {
  mergeDataListings,
  MOCK_DATA_LISTINGS,
  type DataCatalogItem,
} from "../../lib/catalog-mock-data";
import { catalogApi, type DataMarketListing } from "../../lib/catalog-api";
import { getAutomlFileUrls, listAutomlMarketListings } from "../../lib/automl-data-api";

export const dataTaskLabels: Record<string, string> = {
  "object-detection": "目标检测",
  classification: "图像分类",
  segmentation: "图像分割",
  pose: "姿态估计",
  ocr: "文字识别",
};

export const licenseLabels: Record<string, string> = {
  "CC0-1.0": "自由使用",
  "CC-BY-4.0": "署名使用",
  "CC-BY-SA-4.0": "署名-相同方式共享",
  "ODC-BY-1.0": "开放数据",
  "CUSTOM-COMMERCIAL": "商业许可",
  "CUSTOM-RESEARCH": "研究用途",
};

export const automlTaskType = (taskType: string): string => {
  const labels: Record<string, string> = {
    OBJECT_DETECTION: "object-detection",
    IMAGE_CLASSIFICATION: "classification",
    SEGMENTATION: "segmentation",
    POSE_ESTIMATION: "pose",
    OCR: "ocr",
  };
  return labels[taskType] ?? "object-detection";
};

export type AutomlCoverBox = { labelName: string; x: number; y: number; w: number; h: number };

const dataScaleOptions = ["全部规模", "1 万张以下", "1–3 万张", "3 万张以上"];

export const toMarketListing = (entry: {
    versionId: string | number;
    datasetId: string | number;
    datasetName: string;
    description: string | null;
    taskType: string;
    version: string;
    sampleCount: number;
    annotatedSampleCount: number;
    classNames: string[] | null;
    releasedAt: string | null;
    createTime: string;
  }): DataMarketListing => ({
    id: `automl-${entry.versionId}`,
    provider_workspace_id: "automl",
    provider_name: "AutoML 数据集",
    dataset_version_id: String(entry.versionId),
    dataset_id: String(entry.datasetId),
    dataset_name: entry.datasetName,
    dataset_version_number: Number(String(entry.version).replace(/[^0-9]/g, "")) || 1,
    project_name: entry.datasetName,
    task_type: automlTaskType(entry.taskType),
    asset_count: entry.sampleCount,
    class_map: Object.fromEntries((entry.classNames ?? []).map((name) => [name, name])),
    quality_report: null,
    title: `${entry.datasetName} ${entry.version}`,
    summary: entry.description?.trim() || "AutoML 数据集已发布版本",
    source_summary: "AutoML 数据集版本快照（样本 + 标注）",
    collection_method: "自主采集",
    coverage_summary: `${entry.sampleCount} 个样本 · ${entry.annotatedSampleCount} 个已标注${entry.classNames?.length ? ` · 类别：${entry.classNames.join("、")}` : ""}`,
    known_limitations: "",
    license_code: "CUSTOM-RESEARCH",
    custom_license_terms: null,
    allow_commercial_use: false,
    allow_model_training: true,
    allow_derivative_models: true,
    allow_redistribution: false,
    contains_personal_data: false,
    privacy_treatment: "未声明",
    review_basis: "provider_attestation",
    status: "published",
    delivery_mode: "not_prepared",
    delivery_status: "not_open",
    delivery_spec_hash: null,
    published_at: entry.releasedAt ?? entry.createTime,
  });

export function getDatasetListingCounts(listing: DataCatalogItem) {
  return {
    images: listing.asset_count,
    annotatedImages: listing.quality_report?.annotated_asset_count ?? null,
    annotations: listing.quality_report
      ? listing.quality_report.class_distribution.reduce((total, item) => total + item.annotation_count, 0)
      : null,
  };
}

function formatDatasetCount(value: number | null): string {
  return value === null ? "待公布" : value.toLocaleString("zh-CN");
}

export function DataMarketWorkbench({ previewMode }: { previewMode: boolean }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listings, setListings] = useState<(DataCatalogItem & { automl_cover?: { objectKey: string; boxes: AutomlCoverBox[]; url: string | null } })[]>(previewMode ? MOCK_DATA_LISTINGS : []);
  const [query, setQuery] = useState("");
  const [task, setTask] = useState("全部");
  const [scene, setScene] = useState("全部场景");
  const [annotation, setAnnotation] = useState("全部标注");
  const [scale, setScale] = useState("全部规模");
  const [license, setLicense] = useState("全部授权");


  useEffect(() => {
    if (previewMode) {
      void catalogApi.listPublicDataMarketListings()
        .then((nextListings) => setListings(mergeDataListings(nextListings, previewMode)))
        .catch(() => {
          setListings(MOCK_DATA_LISTINGS);
          setError("服务暂不可用；当前显示示例数据集。");
        })
        .finally(() => setLoading(false));
      return;
    }
    // 数据市场数据源：AutoML 已上架（LISTED）的数据集版本
    void listAutomlMarketListings()
      .then((entries) => {
        const items = mergeDataListings(entries.map(toMarketListing), false).map((item) => ({
          ...item,
          automl_cover: {
            objectKey: entries.find((candidate) => `automl-${candidate.versionId}` === item.id)?.coverObjectKey ?? "",
            boxes: entries.find((candidate) => `automl-${candidate.versionId}` === item.id)?.coverBoxes ?? [],
            url: null as string | null,
          },
        }));
        setListings(items);
        // 封面预签名 URL（第一个有标注样本的真实图片）
        const coverKeys = [...new Set(items.map((item) => item.automl_cover.objectKey).filter(Boolean))];
        if (!coverKeys.length) return;
        return getAutomlFileUrls(coverKeys).then((urls) => {
          const urlByKey = new Map(urls.map((entry) => [entry.objectKey, entry.url]));
          setListings((current) => current.map((item) => {
            const cover = item.automl_cover;
            return cover ? { ...item, automl_cover: { ...cover, url: urlByKey.get(cover.objectKey) ?? null } } : item;
          }));
        });
      })
      .catch((reason) => {
        setListings([]);
        setError(reason instanceof Error ? reason.message : "服务暂不可用");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode]);

  const tasks = useMemo(
    () => ["全部", ...Array.from(new Set(listings.map((listing) => dataTaskLabels[listing.task_type] ?? listing.task_type)))],
    [listings],
  );
  const annotationTypes = useMemo(
    () => ["全部标注", ...Array.from(new Set(listings.map((listing) => listing.annotation_type)))],
    [listings],
  );
  const sceneTypes = useMemo(
    () => ["全部场景", ...Array.from(new Set(listings.map((listing) => listing.scene_category)))],
    [listings],
  );
  const licenseTypes = useMemo(
    () => ["全部授权", ...Array.from(new Set(listings.map((listing) => licenseLabels[listing.license_code] ?? listing.license_code)))],
    [listings],
  );
  const filteredListings = listings.filter((listing) => {
    const normalized = query.trim().toLowerCase();
    const listingTask = dataTaskLabels[listing.task_type] ?? listing.task_type;
    const listingLicense = licenseLabels[listing.license_code] ?? listing.license_code;
    const scaleMatches = scale === "全部规模"
      || (scale === "1 万张以下" && listing.asset_count < 10000)
      || (scale === "1–3 万张" && listing.asset_count >= 10000 && listing.asset_count < 30000)
      || (scale === "3 万张以上" && listing.asset_count >= 30000);
    return (task === "全部" || task === listingTask)
      && (scene === "全部场景" || scene === listing.scene_category)
      && (annotation === "全部标注" || annotation === listing.annotation_type)
      && (license === "全部授权" || license === listingLicense)
      && scaleMatches
      && (!normalized || `${listing.title} ${listing.summary} ${listing.provider_name} ${listing.scene_category} ${listing.annotation_type} ${listing.image_size_summary} ${licenseLabels[listing.license_code] ?? listing.license_code} ${Object.values(listing.class_map).join(" ")}`.toLowerCase().includes(normalized));
  });

  return (
    <main className="product-page storefront-page">
      <header className="product-page-header">
        <h1>数据市场</h1>
      </header>

      <div className="storefront-tools">
        <label className="storefront-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索数据集或类别" />
        </label>
        <div className="storefront-filters" aria-label="数据类型">
          {tasks.map((item) => <button className={task === item ? "is-active" : ""} type="button" key={item} onClick={() => setTask(item)}>{item}</button>)}
        </div>
        <CatalogFilterMenu
          title="筛选数据集"
          defaultLabel="全部筛选"
          groups={[
            { id: "scene", label: "应用场景", value: scene, allValue: "全部场景", options: sceneTypes, onChange: setScene },
            { id: "annotation", label: "标注形式", value: annotation, allValue: "全部标注", options: annotationTypes, onChange: setAnnotation },
            { id: "scale", label: "数据规模", value: scale, allValue: "全部规模", options: dataScaleOptions, onChange: setScale },
            { id: "license", label: "授权方式", value: license, allValue: "全部授权", options: licenseTypes, onChange: setLicense },
          ]}
        />
      </div>

      {error ? <p className="inline-notice is-error" role="alert">{error}</p> : null}

      {loading && listings.length === 0 ? (
        <div className="storefront-empty"><LoaderCircle className="spinner" size={20} /><span>正在加载</span></div>
      ) : filteredListings.length ? (
        <section className="storefront-grid" aria-label="数据商品">
          {filteredListings.map((listing) => {
            const classCount = Object.keys(listing.class_map).length;
            const counts = getDatasetListingCounts(listing);
            return (
              <article className="storefront-card" key={listing.id}>
                <Link className="storefront-card-link" href={`/data-market/${listing.id}`} aria-label={`查看${listing.title}`}>
                  {listing.automl_cover?.url ? (
                    <div className="market-cover" role="img" aria-label={`${listing.title} 标注样例`}>
                      <img src={listing.automl_cover.url} alt="" />
                      {listing.automl_cover.boxes.map((box, index) => (
                        <span key={index} className="market-cover-box" style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}>
                          <small>{box.labelName}</small>
                        </span>
                      ))}
                      <span className="market-cover-kind">标注样例</span>
                    </div>
                  ) : (
                    <CatalogPreview preview={listing.preview} kind="data" />
                  )}
                  <div className="storefront-card-topline">
                    <span>{dataTaskLabels[listing.task_type] ?? listing.task_type}</span>
                    <span className="verified-label"><BadgeCheck size={14} /> 信息完整</span>
                  </div>
                  <h2>{listing.title}</h2>
                  <p>{listing.summary}</p>
                  <div className="storefront-card-tags" aria-label="数据集标签">
                    <span>{listing.annotation_type}</span>
                    <span>{classCount} 个类别</span>
                  </div>
                  <div className="storefront-card-evidence">
                    <span><small>图片</small><strong>{formatDatasetCount(counts.images)}</strong></span>
                    <span><small>标注实例</small><strong>{formatDatasetCount(counts.annotations)}</strong></span>
                    <span><small>标注覆盖</small><strong>{listing.quality_report ? `${listing.quality_report.annotation_coverage_percent}%` : "待公布"}</strong></span>
                  </div>
                </Link>
                <div className="storefront-card-footer">
                  <div><strong>{listing.price_label}</strong><small>{listing.provider_name}</small></div>
                  <div className="storefront-card-actions">
                    <Link className="text-button compact" href={`/data-market/${listing.id}`}>详情 <ArrowUpRight size={14} /></Link>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="storefront-empty"><Database size={20} /><span>没有找到符合条件的数据集</span></div>
      )}
    </main>
  );
}
