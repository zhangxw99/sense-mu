"use client";

import { AlertCircle, ArrowLeft, BadgeCheck, Boxes, Check, LoaderCircle, Rocket } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAlgorithmPrice, toAlgorithmListing } from "../marketplace-workbench";
import {
  decorateAlgorithmListing,
  findMockAlgorithm,
  type AlgorithmCatalogItem,
} from "../../../lib/catalog-mock-data";
import { catalogApi, type Workspace } from "../../../lib/catalog-api";
import {
  type AutomlAlgorithmMarketDetail,
  getAutomlAlgorithmMarketDetail,
  getAutomlFileUrls,
} from "../../../lib/automl-data-api";
import {
  type AutomlDevice,
  type AutomlDeviceDeployment,
  createAutomlDeviceDeployment,
  deviceStatusLabel,
  listAutomlDeployments,
  listAutomlDevices,
} from "../../../lib/automl-device-api";
import { type EdgeCurrentModel, detectWithEdgeModel, getEdgeCurrentModel } from "../../../lib/edge-inference-api";
import { AlgorithmLiveDemo, type DemoRealInference } from "../../components/algorithm-live-demo";

const automlListingId = (id: string): string | null =>
  id.startsWith("automl-") ? id.slice("automl-".length) : null;

function formatPackageSize(size: unknown): string {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

export function AlgorithmDetailWorkbench({ listingId, previewMode }: { listingId: string; previewMode: boolean }) {
  const automlModelId = automlListingId(listingId);
  const initialListing = previewMode ? findMockAlgorithm(listingId) : null;
  const [listing, setListing] = useState<AlgorithmCatalogItem | null>(initialListing);
  const [realDetail, setRealDetail] = useState<AutomlAlgorithmMarketDetail | null>(null);
  const [edgeModel, setEdgeModel] = useState<EdgeCurrentModel | null>(null);
  // 部署：在线设备单选 + 提交状态
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployDevices, setDeployDevices] = useState<AutomlDevice[] | null>(null);
  const [deployDeviceId, setDeployDeviceId] = useState("");
  const [deployVersionId, setDeployVersionId] = useState<string | null>(null);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  // 该算法在设备上的运行中部署（§6.11.2 ACTIVE 口径，已按每设备最新激活去重）
  const [activeDeployments, setActiveDeployments] = useState<AutomlDeviceDeployment[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const [loading, setLoading] = useState(!initialListing);
  const [error, setError] = useState<string | null>(null);

  const isAutomlListing = Boolean(automlModelId) && !previewMode;

  useEffect(() => {
    if (initialListing) {
      setLoading(false);
      return;
    }
    if (automlModelId) {
      // AutoML 上架模型：market 详情接口 → 市场卡片形状（含真实指标/类别/版本）
      void getAutomlAlgorithmMarketDetail(automlModelId)
        .then((detail) => {
          const mapped = toAlgorithmListing(detail);
          const coverKey = detail.coverObjectKey;
          if (coverKey) {
            void getAutomlFileUrls([coverKey]).then((urls) => {
              const url = urls[0]?.url;
              if (url) setListing((current) => current
                ? { ...current, preview: { ...current.preview, image_url: url } }
                : current);
            });
          }
          setRealDetail(detail);
          setListing(mapped);
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : "算法详情加载失败"))
        .finally(() => setLoading(false));
      return;
    }
    void Promise.all([
      catalogApi.getPublicMarketplaceListing(listingId),
      catalogApi.listWorkspaces().catch(() => [] as Workspace[]),
    ])
      .then(([detail, nextWorkspaces]) => {
        setWorkspaces(nextWorkspaces);
        setWorkspaceId(nextWorkspaces[0]?.id ?? "");
        setListing(detail ? decorateAlgorithmListing(detail) : null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "算法详情加载失败"))
      .finally(() => setLoading(false));
  }, [automlModelId, initialListing, listingId]);

  // 在线体验可用性：设备常驻推理服务的激活模型 = 该算法时才可真实体验
  useEffect(() => {
    if (!isAutomlListing) return;
    void getEdgeCurrentModel().then(setEdgeModel).catch(() => setEdgeModel(null));
  }, [isAutomlListing]);

  const refreshActiveDeployments = useCallback(async (detail: AutomlAlgorithmMarketDetail) => {
    const versionIds = new Set(detail.versions.map((version) => String(version.versionId)));
    if (!versionIds.size) {
      setActiveDeployments([]);
      return;
    }
    try {
      // ACTIVE 口径后端已按每设备最新一次激活去重；接口暂不支持按模型过滤，前端按版本收敛
      const page = await listAutomlDeployments({ statusCd: "ACTIVE", limit: 100 });
      setActiveDeployments(page.rows.filter((row) => versionIds.has(String(row.modelVersionId))));
    } catch {
      setActiveDeployments(null);
    }
  }, []);

  useEffect(() => {
    if (!isAutomlListing || !realDetail) return;
    void refreshActiveDeployments(realDetail);
  }, [isAutomlListing, realDetail, refreshActiveDeployments]);

  const deployed = Boolean(
    isAutomlListing && realDetail && edgeModel && edgeModel.modelId === realDetail.modelCode,
  );

  const realInference = useMemo<DemoRealInference | null>(
    () => (deployed && edgeModel
      ? {
        modelName: `edge 常驻 · ${edgeModel.modelId} · ${edgeModel.version}`,
        detect: async (image, threshold) => (await detectWithEdgeModel(image, threshold)).detections,
      }
      : null),
    [deployed, edgeModel],
  );

  // 部署对话框：拉在线设备
  const openDeployDialog = useCallback((versionId: string) => {
    setDeployVersionId(versionId);
    setDeployError(null);
    setDeployDeviceId("");
    setDeployOpen(true);
    void (async () => {
      try {
        const page = await listAutomlDevices({ page: 1, limit: 50, statusCd: "ONLINE" });
        setDeployDevices(page.rows);
      } catch (reason) {
        setDeployDevices([]);
        setDeployError(reason instanceof Error ? reason.message : "设备列表加载失败");
      }
    })();
  }, []);

  const confirmDeploy = useCallback(async () => {
    if (!deployDeviceId || !deployVersionId) {
      setDeployError("请选择一台在线设备");
      return;
    }
    setDeployBusy(true);
    setDeployError(null);
    try {
      const deployment = await createAutomlDeviceDeployment(deployDeviceId, deployVersionId);
      setDeployOpen(false);
      setNotice(`部署任务 ${deployment.deploymentCode} 已下发，设备将在心跳后自动拉取安装并激活。`);
      if (realDetail) void refreshActiveDeployments(realDetail);
    } catch (reason) {
      setDeployError(reason instanceof Error ? reason.message : "部署下发失败，请稍后重试");
    } finally {
      setDeployBusy(false);
    }
  }, [deployDeviceId, deployVersionId, realDetail, refreshActiveDeployments]);

  async function buy() {
    if (!listing || !workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      if (listing.is_mock && previewMode) {
        setPurchased(true);
        setNotice("示例购买流程已完成；接入支付后将创建真实 API 授权。");
      } else if (!listing.is_mock && !isAutomlListing) {
        const checkout = await catalogApi.subscribeMarketplaceListing(workspaceId, listing.id);
        setPurchased(checkout.status === "active");
        setNotice(checkout.status === "active" ? "购买成功，请到“我的”领取 API 密钥。" : "订单已创建，请到“我的”查看。");
      } else {
        throw new Error("演示商品不能在正式环境购买");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "购买失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="product-page"><div className="storefront-empty"><LoaderCircle className="spinner" size={20} />正在加载算法详情</div></main>;
  }

  if (!listing) {
    return (
      <main className="product-page catalog-detail-page">
        <Link className="catalog-back-link" href="/marketplace"><ArrowLeft size={15} />返回算法市场</Link>
        <div className="catalog-detail-empty"><h1>没有找到这个算法</h1><p>商品可能已下架或链接无效。</p></div>
      </main>
    );
  }

  const versions = realDetail?.versions ?? [];
  const latestVersion = versions[0] ?? null;
  const runDisabledHint = isAutomlListing && !deployed
    ? "该算法尚未部署到设备（或设备当前激活的是其他模型）；在右侧部署并激活后即可真实体验。"
    : null;
  const codeSample = isAutomlListing
    ? `# 部署激活后，在设备上直接调用推理服务\ncurl -X POST "http://<设备IP>:8100/v1/detect" \\\n  -F "image=@sample.jpg" \\\n  -F "threshold=0.25"`
    : `curl -X POST "https://api.sensemu.cn${listing.endpoint_url}" \\\n  -H "Authorization: Bearer $SENSEMU_API_KEY" \\\n  -F "image=@sample.jpg"`;

  return (
    <main className="product-page catalog-detail-page">
      <Link className="catalog-back-link" href="/marketplace"><ArrowLeft size={15} />算法市场</Link>

      <section className="catalog-detail-hero is-copy-only">
        <div className="catalog-detail-intro">
          <div className="catalog-detail-kicker">
            <span>{realDetail ? `${realDetail.modelCode} · ${realDetail.version}` : (listing.task_type === "object-detection" ? "目标检测" : listing.category)}</span>
            <span className={listing.is_valid === false ? "unverified-label" : "verified-label"}>
              <BadgeCheck size={14} /> {listing.is_valid === false ? "待验证" : "已验证"}
            </span>
          </div>
          <h1>{listing.title}</h1>
          <p>{listing.summary}</p>
          <div className="storefront-tags">
            {(listing.classes.length ? listing.classes : ["类别以版本为准"]).slice(0, 6).map((item) => <span key={item}>{item}</span>)}
          </div>
          <div className="catalog-detail-provider">
            <span>提供方</span><strong>{listing.provider_name}</strong>
            <small>
              {realDetail
                ? `${realDetail.versionCount} 个上架版本 · 上架于 ${realDetail.listedAt ?? "—"}`
                : `更新于 ${listing.updated_label}`}
            </small>
          </div>
        </div>
      </section>

      {error ? <p className="inline-notice is-error" role="alert">{error}</p> : null}
      {notice ? <p className="inline-notice" role="status">{notice}</p> : null}

      <AlgorithmLiveDemo listing={listing} realInference={realInference ?? undefined} runDisabled={runDisabledHint ?? undefined} />

      <div className="catalog-detail-layout">
        <div className="catalog-detail-main">
          <section className="catalog-detail-section">
            <h2>效果与规格</h2>
            <div className="catalog-metric-grid">
              {(listing.metrics.length
                ? listing.metrics
                : [{ label: "指标", value: "待训练产出" }]).map((metric) => (
                  <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>
              ))}
              <div><span>运行时</span><strong>{realDetail?.runtime ?? "ONNX"}</strong></div>
              <div><span>上架版本</span><strong>{realDetail ? `${realDetail.versionCount} 个` : "—"}</strong></div>
              <div><span>响应 P95</span><strong>{listing.latency_p95}</strong></div>
            </div>
            <dl className="catalog-fact-list">
              <div><dt>模型编码</dt><dd>{realDetail?.modelCode ?? listing.model_architecture}</dd></div>
              <div><dt>任务类型</dt><dd>{realDetail?.taskType ?? listing.capability_problem_definition ?? "—"}</dd></div>
              <div><dt>框架</dt><dd>{realDetail?.framework ?? "—"}</dd></div>
              {realDetail?.trainingTaskName ? (
                <div>
                  <dt>训练任务</dt>
                  <dd>
                    {realDetail.trainingTaskId
                      ? <Link href={`/training-tasks/${encodeURIComponent(realDetail.trainingTaskId)}`}>{realDetail.trainingTaskName}</Link>
                      : realDetail.trainingTaskName}
                  </dd>
                </div>
              ) : null}
              {realDetail?.datasetVersionId ? (
                <div><dt>训练数据</dt><dd>数据集版本 {realDetail.datasetVersionId}</dd></div>
              ) : null}
            </dl>
          </section>

          {versions.length ? (
            <section className="catalog-detail-section">
              <h2>版本列表</h2>
              <div className="catalog-version-list">
                {versions.map((version, index) => (
                  <div className="catalog-version-row" key={String(version.versionId)}>
                    <div className="catalog-version-main">
                      <strong>{version.version}{index === 0 ? " · 最新" : ""}</strong>
                      <small>
                        {version.runtime} · {(version.classNames?.length ?? 0)} 类
                        {" · "}{formatPackageSize(version.packageSize)}
                        {" · "}注册于 {version.registeredAt ?? "—"}
                      </small>
                    </div>
                    <div className="catalog-version-metrics">
                      {(version.metrics ? Object.entries(version.metrics)
                        .filter(([key]) => key.startsWith("metrics/"))
                        .slice(0, 2) : []).map(([key, value]) => (
                          <span key={key}>{key.replace("metrics/", "").replace("(B)", "")} {Math.round(Number(value) * 100)}%</span>
                      ))}
                    </div>
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => openDeployDialog(String(version.versionId))}
                    >
                      <Rocket size={12} />
                      部署此版本
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {isAutomlListing ? (
            <section className="catalog-detail-section">
              <h2>部署设备</h2>
              <p className="catalog-section-lead">
                {activeDeployments === null
                  ? "正在读取部署信息…"
                  : activeDeployments.length
                    ? `已部署到 ${activeDeployments.length} 台设备，运行中。`
                    : "尚未部署到任何设备。"}
              </p>
              {activeDeployments?.length ? (
                <div className="market-deploy-list">
                  {activeDeployments.map((row) => (
                    <div className="market-deploy-row" key={String(row.deploymentId)}>
                      <Link
                        className="market-deploy-device"
                        href={`/devices?device=${encodeURIComponent(String(row.deviceId))}`}
                        title={`${row.deviceName ?? "设备"} · 查看设备详情`}
                      >
                        {row.deviceName ?? `设备 ${String(row.deviceId)}`}
                      </Link>
                      {row.deviceStatusCd ? (
                        <span className="device-status-chip" data-status={row.deviceStatusCd}>
                          {deviceStatusLabel[row.deviceStatusCd] ?? row.deviceStatusCd}
                        </span>
                      ) : null}
                      <span className="market-deploy-meta">
                        {row.modelVersion ? `版本 ${row.modelVersion}` : ""}
                        {row.activatedAt ? ` · 激活于 ${row.activatedAt}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="catalog-detail-section">
            <h2>识别类别</h2>
            <div className="catalog-class-list">
              {(listing.classes.length ? listing.classes : ["以接口返回为准"]).map((item) => <span key={item}>{item}</span>)}
            </div>
          </section>

          <section className="catalog-detail-section">
            <h2>接入方式</h2>
            <p className="catalog-section-lead">
              {isAutomlListing
                ? "部署到边缘设备后，由设备上的推理服务提供识别能力；上传图片即时返回检测框，默认不留存输入图片。"
                : "购买后领取 API 密钥，使用图片文件发起请求。默认不留存输入图片。"}
            </p>
            <pre className="catalog-code"><code>{codeSample}</code></pre>
          </section>
        </div>

        <aside className="catalog-purchase-card">
          {isAutomlListing ? (
            <>
              <span><Boxes size={14} style={{ verticalAlign: "-2px" }} /> 边缘部署</span>
              <strong>免费</strong>
              <small>部署到你的设备，按设备调用，无 API 计费</small>
              <ul>
                <li><Check size={15} />下发后设备自动下载安装</li>
                <li><Check size={15} />健康检查通过才激活</li>
                <li><Check size={15} />失败自动回退旧模型</li>
              </ul>
              <p className="market-deploy-count">
                {activeDeployments === null
                  ? "正在读取部署信息…"
                  : activeDeployments.length
                    ? `已部署 ${activeDeployments.length} 台设备`
                    : "尚未部署到任何设备"}
              </p>
              <button className="primary-button" type="button" disabled={!latestVersion} onClick={() => openDeployDialog(String(latestVersion!.versionId))}>
                <Rocket size={14} style={{ verticalAlign: "-2px" }} /> 部署最新版本
              </button>
              <p>部署需一台在线边缘设备；同一设备同时只允许一个进行中的部署任务。</p>
            </>
          ) : (
            <>
              <span>API 调用</span>
              <strong>{formatAlgorithmPrice(listing.price_per_1000_cents)}</strong>
              <small>每月包含 {listing.monthly_quota_units.toLocaleString("zh-CN")} 次调用</small>
              <ul>
                <li><Check size={15} />共享 API 服务</li>
                <li><Check size={15} />输入图片默认不留存</li>
                <li><Check size={15} />按成功调用计费</li>
              </ul>
              {workspaces.length > 1 ? (
                <label><span>购买到</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
              ) : null}
              {purchased ? (
                <Link className="primary-button" href="/me?view=consumer">打开我的 API</Link>
              ) : workspaces.length ? (
                <button className="primary-button" type="button" disabled={busy} onClick={() => void buy()}>{busy ? "处理中" : "购买 API"}</button>
              ) : (
                <Link className="primary-button" href="/settings">先创建工作区</Link>
              )}
              <p>{listing.is_mock ? "示例商品用于敲定页面与购买流程，不产生真实费用。" : "购买即表示同意商品调用与计费规则。"}</p>
            </>
          )}
        </aside>
      </div>

      {deployOpen ? (
        <div className="workbench-dialog-backdrop" role="presentation" onClick={() => !deployBusy && setDeployOpen(false)}>
          <section
            className="workbench-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="market-deploy-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><Rocket size={18} /></span>
                <span>
                  <h2 id="market-deploy-title">部署到设备</h2>
                  <p>版本 {deployVersionId ? versions.find((version) => String(version.versionId) === deployVersionId)?.version ?? "" : ""} → 选择一台在线设备下发。</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={deployBusy} onClick={() => setDeployOpen(false)}>×</button>
            </div>
            <div className="task-deploy-device-list" role="radiogroup" aria-label="选择目标设备">
              {deployDevices === null ? (
                <p className="device-detail-hint"><LoaderCircle size={12} className="spinner" /> 正在加载在线设备…</p>
              ) : deployDevices.length ? deployDevices.map((device) => (
                <label
                  key={String(device.deviceId)}
                  className={`task-deploy-device${deployDeviceId === String(device.deviceId) ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="market-deploy-device"
                    value={String(device.deviceId)}
                    checked={deployDeviceId === String(device.deviceId)}
                    onChange={() => setDeployDeviceId(String(device.deviceId))}
                  />
                  <span className="task-deploy-device-name">{device.name}</span>
                  <small>{device.deviceCode} · {device.deviceType}</small>
                </label>
              )) : (
                <p className="device-detail-hint">没有在线设备，请先在边缘设备页确认设备在线。</p>
              )}
            </div>
            {deployError ? (
              <p className="resource-action-error" role="alert"><AlertCircle size={13} /> {deployError}</p>
            ) : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={deployBusy} onClick={() => setDeployOpen(false)}>取消</button>
              <button className="primary-button" type="button" disabled={deployBusy || !deployDeviceId} onClick={() => void confirmDeploy()}>
                {deployBusy ? "正在下发" : "确认部署"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
