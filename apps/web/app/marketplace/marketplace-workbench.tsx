"use client";

import { ArrowUpRight, BadgeCheck, LoaderCircle, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogFilterMenu } from "../components/catalog-filter-menu";
import { CatalogPreview } from "../components/catalog-preview";
import {
  mergeAlgorithmListings,
  MOCK_ALGORITHM_LISTINGS,
  type AlgorithmCatalogItem,
} from "../../lib/catalog-mock-data";
import {
  catalogApi,
  type MarketplaceSubscription,
  type Workspace,
} from "../../lib/catalog-api";
import {
  type AutomlAlgorithmMarketListing,
  getAutomlFileUrls,
  listAutomlAlgorithmMarketListings,
} from "../../lib/automl-data-api";
import { automlTaskType } from "../data-market/data-market-workbench";

export const taskLabels: Record<string, string> = {
  "object-detection": "目标检测",
  classification: "图像分类",
  segmentation: "图像分割",
  pose: "姿态估计",
  ocr: "文字识别",
};

export function formatAlgorithmPrice(cents: number): string {
  if (cents === 0) return "免费";
  return `${new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(cents / 100)} / 千次`;
}

function getListingEnvironments(listing: AlgorithmCatalogItem): string[] {
  const text = listing.capability_verified_scenes.join(" ");
  return [
    /固定|高位|俯拍|正面|机位/.test(text) ? "固定机位" : null,
    /室内|仓库|厂房|产线|货架|传送带|温室|圈舍/.test(text) ? "室内" : null,
    /工地|城市路口|道路|林区|林道|田间|果园|牧场/.test(text) ? "室外" : null,
    /夜景|夜间|白天与|自然光/.test(text) ? "昼夜" : null,
  ].filter((item): item is string => Boolean(item));
}

// 训练最终指标里挑展示项（键为 ultralytics 原始名）
export function pickAlgorithmMetrics(metrics: Record<string, number> | null): { label: string; value: string }[] {
  if (!metrics) return [];
  const pick = [
    { key: "metrics/mAP50(B)", label: "mAP50" },
    { key: "metrics/mAP50-95(B)", label: "mAP50-95" },
    { key: "metrics/precision(B)", label: "精确率" },
    { key: "metrics/recall(B)", label: "召回率" },
  ];
  return pick
    .filter((item) => typeof metrics[item.key] === "number")
    .map((item) => ({ label: item.label, value: `${Math.round(metrics[item.key] * 100)}%` }));
}

// AutoML 上架模型 → 市场卡片形状（id = automl-{modelId}，详情页按此前缀解析）
export const toAlgorithmListing = (entry: AutomlAlgorithmMarketListing): AlgorithmCatalogItem => ({
  id: `automl-${entry.modelId}`,
  provider_workspace_id: "automl",
  provider_name: "AutoML 训练发布",
  deployment_id: `automl-${entry.modelId}`,
  capability_spec_id: null,
  capability_slug: null,
  capability_version_number: entry.versionCount,
  capability_display_name: entry.name,
  capability_problem_definition: entry.taskType,
  capability_output_contract: "detections.v1",
  capability_verified_scenes: entry.classNames ?? [],
  capability_unsupported_conditions: [],
  endpoint_url: "/v1/detect",
  model_name: entry.name,
  model_version_number: Number(String(entry.version).replace(/[^0-9]/g, "")) || 1,
  task_type: automlTaskType(entry.taskType),
  title: entry.name,
  summary: entry.description?.trim() || `AutoML 发布模型 · ${entry.modelCode} · ${entry.version}`,
  category: entry.scene ?? "通用场景",
  pricing_unit: "免费",
  price_per_1000_cents: 0,
  monthly_quota_units: 0,
  status: "published",
  published_at: entry.listedAt,
  subscription_id: null,
  subscription_status: null,
  remaining_units: null,
  is_valid: entry.isValid,
  is_available: true,
  metrics: pickAlgorithmMetrics(entry.metrics),
  classes: entry.classNames ?? [],
  model_architecture: entry.modelCode,
  input_size: "以模型清单为准",
  latency_p95: "设备端实测",
  is_mock: false,
  // studio 非场景枚举值：getCatalogSceneImage 返回 null，组件回退无图占位；有封面时由 image_url 覆盖
  preview: { scene: "studio", alt: entry.name, boxes: [] } as unknown as AlgorithmCatalogItem["preview"],
  evaluation_basis: "训练任务最终 val 指标",
  updated_label: entry.listedAt ? entry.listedAt.slice(0, 10) : "近期发布",
});

export function MarketplaceWorkbench({ previewMode }: { previewMode: boolean }) {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [listings, setListings] = useState<AlgorithmCatalogItem[]>(previewMode ? MOCK_ALGORITHM_LISTINGS : []);
  const [subscriptions, setSubscriptions] = useState<MarketplaceSubscription[]>([]);
  const [mockPurchasedIds, setMockPurchasedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [scene, setScene] = useState("全部场景");
  const [environment, setEnvironment] = useState("全部环境");
  const [checkoutListing, setCheckoutListing] = useState<AlgorithmCatalogItem | null>(null);

  const loadWorkspace = useCallback(async (nextWorkspaceId: string) => {
    setSubscriptions(await catalogApi.listMarketplaceSubscriptions(nextWorkspaceId));
  }, []);

  useEffect(() => {
    if (previewMode) {
      void catalogApi.listPublicMarketplaceListings()
        .then((nextListings) => setListings(mergeAlgorithmListings(nextListings, previewMode)))
        .catch(() => {
          setListings(MOCK_ALGORITHM_LISTINGS);
          setError("服务暂不可用；当前显示示例商品。");
        })
        .finally(() => setLoading(false));
      return;
    }
    // 算法市场数据源：AutoML 已上架模型（版本 APPROVED 即上架）
    void listAutomlAlgorithmMarketListings()
      .then(async (entries) => {
        const items = mergeAlgorithmListings(entries.map(toAlgorithmListing), false);
        setListings(items);
        // 推理封面（训练任务产出）预签名 URL；无封面回退 CatalogPreview 场景图
        const coverKeys = entries
          .map((entry) => ({ id: `automl-${entry.modelId}`, key: entry.coverObjectKey }))
          .filter((cover) => cover.key);
        if (!coverKeys.length) return;
        return getAutomlFileUrls(coverKeys.map((cover) => cover.key as string)).then((urls) => {
          const urlByKey = new Map(urls.map((entry) => [entry.objectKey, entry.url]));
          setListings((current) => current.map((item) => {
            const cover = coverKeys.find((candidate) => candidate.id === item.id);
            const url = cover ? urlByKey.get(cover.key as string) : null;
            return url ? { ...item, preview: { ...item.preview, image_url: url } } : item;
          }));
        });
      })
      .catch((reason) => {
        setListings([]);
        setError(reason instanceof Error ? reason.message : "服务暂不可用");
      })
      .finally(() => setLoading(false));
  }, [previewMode]);

  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(listings.map((listing) => taskLabels[listing.task_type] ?? listing.category)))],
    [listings],
  );
  const scenes = useMemo(
    () => ["全部场景", ...Array.from(new Set(listings.map((listing) => listing.category)))],
    [listings],
  );
  const environments = useMemo(
    () => ["全部环境", ...Array.from(new Set(listings.flatMap(getListingEnvironments)))],
    [listings],
  );
  const subscriptionByListingId = useMemo(
    () => new Map(subscriptions.map((subscription) => [subscription.listing_id, subscription])),
    [subscriptions],
  );
  const filteredListings = listings.filter((listing) => {
    const normalized = query.trim().toLowerCase();
    const listingCategory = taskLabels[listing.task_type] ?? listing.category;
    return (category === "全部" || category === listingCategory)
      && (scene === "全部场景" || scene === listing.category)
      && (environment === "全部环境" || getListingEnvironments(listing).includes(environment))
      && (!normalized || `${listing.title} ${listing.summary} ${listing.provider_name} ${listing.category} ${listing.model_architecture} ${listing.input_size} ${listing.capability_verified_scenes.join(" ")} ${listing.classes.join(" ")}`.toLowerCase().includes(normalized));
  });

  async function selectPurchaseWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setError(null);
    try {
      await loadWorkspace(nextWorkspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工作区切换失败");
    }
  }

  async function buy(listing: AlgorithmCatalogItem) {
    if (!workspaceId) return;
    setBusyId(listing.id);
    setError(null);
    setNotice(null);
    try {
      if (listing.is_mock && previewMode) {
        setMockPurchasedIds((current) => [...new Set([...current, listing.id])]);
        setCheckoutListing(null);
        setNotice("示例购买流程已完成；接入支付后将创建真实 API 授权。");
        return;
      }
      if (listing.is_mock) throw new Error("演示商品不能在正式环境购买");
      const checkout = await catalogApi.subscribeMarketplaceListing(workspaceId, listing.id);
      await loadWorkspace(workspaceId);
      setCheckoutListing(null);
      setNotice(checkout.status === "active"
        ? "购买成功，请到“我的”领取 API 密钥。"
        : "订单已创建，请到“我的”查看。"
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "购买失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="product-page storefront-page">
      <header className="product-page-header">
        <h1>算法市场</h1>
      </header>

      <div className="storefront-tools">
        <label className="storefront-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索算法或使用场景" />
        </label>
        <div className="storefront-filters" aria-label="算法类型">
          {categories.map((item) => (
            <button className={category === item ? "is-active" : ""} type="button" key={item} onClick={() => setCategory(item)}>{item}</button>
          ))}
        </div>
        <CatalogFilterMenu
          title="筛选应用场景"
          defaultLabel="全部场景"
          groups={[
            { id: "industry", label: "行业场景", value: scene, allValue: "全部场景", options: scenes, onChange: setScene },
            { id: "environment", label: "采集环境", value: environment, allValue: "全部环境", options: environments, onChange: setEnvironment },
          ]}
        />
      </div>

      {error ? <p className="inline-notice is-error" role="alert">{error}</p> : null}
      {notice ? <p className="inline-notice" role="status">{notice}</p> : null}

      {checkoutListing ? (
        <div className="purchase-dialog-backdrop">
          <button className="purchase-dialog-dismiss" type="button" aria-label="关闭购买窗口" onClick={() => setCheckoutListing(null)} />
          <section className="purchase-dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-dialog-title">
            <h2 id="purchase-dialog-title">购买 {checkoutListing.title}</h2>
            <label>
              <span>购买到工作区</span>
              <select value={workspaceId} onChange={(event) => void selectPurchaseWorkspace(event.target.value)}>
                {workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
              </select>
            </label>
            <p className="purchase-dialog-note">每月 {checkoutListing.monthly_quota_units.toLocaleString("zh-CN")} 次调用，{formatAlgorithmPrice(checkoutListing.price_per_1000_cents)}。</p>
            <div>
              <button className="text-button compact" type="button" onClick={() => setCheckoutListing(null)}>取消</button>
              <button className="primary-button compact" type="button" disabled={busyId === checkoutListing.id} onClick={() => void buy(checkoutListing)}>
                {busyId === checkoutListing.id ? "处理中" : "确认购买"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {loading && listings.length === 0 ? (
        <div className="storefront-empty"><LoaderCircle className="spinner" size={20} /><span>正在加载</span></div>
      ) : filteredListings.length ? (
        <section className="storefront-grid" aria-label="算法商品">
          {filteredListings.map((listing) => {
            const subscription = subscriptionByListingId.get(listing.id);
            const purchased = subscription?.status === "active" || mockPurchasedIds.includes(listing.id);
            const pending = subscription?.status === "pending_payment";
            const primaryMetric = listing.metrics[0] ?? { label: "调用状态", value: listing.is_available === false ? "不可用" : "可用" };
            const secondaryMetric = listing.metrics.find((metric) => metric.label === "召回率" || metric.label === "精确率") ?? listing.metrics[1] ?? { label: "模型版本", value: `v${listing.model_version_number}` };
            return (
              <article className="storefront-card" key={listing.id}>
                <Link className="storefront-card-link" href={`/marketplace/${listing.id}`} aria-label={`查看${listing.title}`}>
                  <CatalogPreview preview={listing.preview} kind="algorithm" />
                  <div className="storefront-card-topline">
                    <span>{taskLabels[listing.task_type] ?? listing.category}</span>
                    <span className={listing.is_valid === false ? "unverified-label" : "verified-label"}>
                      <BadgeCheck size={14} /> {listing.is_valid === false ? "待验证" : "已验证"}
                    </span>
                  </div>
                  <h2>{listing.title}</h2>
                  <p>{listing.summary}</p>
                  <div className="storefront-card-tags" aria-label="算法标签">
                    <span>{listing.category}</span>
                    <span>{listing.model_architecture}</span>
                  </div>
                  <div className="storefront-card-evidence">
                    <span><small>{primaryMetric.label}</small><strong>{primaryMetric.value}</strong></span>
                    <span><small>{secondaryMetric.label}</small><strong>{secondaryMetric.value}</strong></span>
                    <span><small>响应 P95</small><strong>{listing.latency_p95}</strong></span>
                  </div>
                </Link>
                <div className="storefront-card-footer">
                  <div><strong>{formatAlgorithmPrice(listing.price_per_1000_cents)}</strong><small>{listing.provider_name}</small></div>
                  <div className="storefront-card-actions">
                    <Link className="text-button compact" href={`/marketplace/${listing.id}`}>详情 <ArrowUpRight size={14} /></Link>
                    {listing.id.startsWith("automl-") ? (
                      <Link className="primary-button compact" href={`/marketplace/${listing.id}`}>部署</Link>
                    ) : purchased || pending ? (
                      <Link className="secondary-button compact" href="/me?view=consumer">{purchased ? "已购买" : "查看订单"}</Link>
                    ) : !workspaces.length ? (
                      <Link className="secondary-button compact" href="/settings">创建工作区</Link>
                    ) : (
                      listing.is_available === false ? (
                        <span className="disabled-button compact">暂不可用</span>
                      ) : (
                        <button className="primary-button compact" type="button" disabled={busyId === listing.id} onClick={() => workspaces.length > 1 ? setCheckoutListing(listing) : void buy(listing)}>
                          {busyId === listing.id ? "处理中" : "购买 API"}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="storefront-empty"><ShoppingBag size={20} /><span>没有找到符合条件的算法</span></div>
      )}
    </main>
  );
}
