"use client";

import { AlertCircle, ArrowLeft, Cpu, LoaderCircle, Settings2, Zap } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AutomlDeviceDeployment,
  deploymentStatusLabel,
  deviceStatusLabel,
  getAutomlDeviceDeployment,
} from "../../../lib/automl-device-api";
import {
  getAutomlFileUrls,
  listAutomlAlgorithmMarketListings,
} from "../../../lib/automl-data-api";
import { type EdgeCurrentModel, detectWithEdgeModel, getEdgeCurrentModel } from "../../../lib/edge-inference-api";
import { type AlgorithmCatalogItem } from "../../../lib/catalog-mock-data";
import { AlgorithmLiveDemo, type DemoRealInference } from "../../components/algorithm-live-demo";

type ServiceTab = "inference" | "settings";

// 体验样例图（真实公开样本，作为默认推理输入；用户可上传替换）
const DEMO_SCENE = "traffic";

function stubListing(deployment: AutomlDeviceDeployment, sampleImageUrl: string | null): AlgorithmCatalogItem {
  return {
    id: `service-${String(deployment.deploymentId)}`,
    provider_workspace_id: "automl-edge",
    provider_name: "边缘部署",
    deployment_id: "—",
    capability_spec_id: null,
    capability_slug: null,
    capability_version_number: null,
    capability_display_name: null,
    capability_problem_definition: null,
    capability_output_contract: null,
    capability_verified_scenes: [],
    capability_unsupported_conditions: [],
    endpoint_url: "",
    model_name: deployment.modelName ?? "",
    model_version_number: 0,
    task_type: "object-detection",
    title: deployment.modelName ?? "运行中的推理服务",
    summary: "设备上正在运行的推理服务",
    category: "边缘部署",
    pricing_unit: "次",
    price_per_1000_cents: 0,
    monthly_quota_units: 0,
    status: "published",
    published_at: deployment.activatedAt,
    subscription_id: null,
    subscription_status: null,
    remaining_units: null,
    is_mock: false,
    preview: {
      scene: DEMO_SCENE,
      boxes: [],
      alt: deployment.modelName ?? "推理服务体验图",
      image_url: sampleImageUrl ?? undefined,
    },
    metrics: [],
    classes: [],
    model_architecture: deployment.serviceInfo?.modelCode ?? deployment.modelName ?? "",
    input_size: "—",
    latency_p95: "",
    evaluation_basis: "—",
    updated_label: deployment.activatedAt ?? "—",
  };
}

export function ServiceDetailWorkbench({ deploymentId }: { deploymentId: string }) {
  const searchParams = useSearchParams();
  const activeTab: ServiceTab = searchParams.get("tab") === "settings" ? "settings" : "inference";

  const [deployment, setDeployment] = useState<AutomlDeviceDeployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edgeModel, setEdgeModel] = useState<EdgeCurrentModel | null>(null);
  // 样例图 = 模型市场条目的封面（后端回退训练数据集样本），与被测模型同类才好体验
  const [sampleImageUrl, setSampleImageUrl] = useState<string | null>(null);
  const [sampleFromDataset, setSampleFromDataset] = useState(false);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const detail = await getAutomlDeviceDeployment(deploymentId);
      setDeployment(detail);
    } catch (reason) {
      if (!options.silent) {
        setError(reason instanceof Error ? reason.message : "部署任务加载失败");
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [deploymentId]);

  useEffect(() => {
    void load();
    void getEdgeCurrentModel().then(setEdgeModel).catch(() => setEdgeModel(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId]);

  useEffect(() => {
    const modelCode = deployment?.serviceInfo?.modelCode;
    if (!modelCode) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await listAutomlAlgorithmMarketListings();
        const entry = entries.find((item) => item.modelCode === modelCode);
        if (cancelled || !entry?.coverObjectKey) return;
        const urls = await getAutomlFileUrls([entry.coverObjectKey]);
        const url = urls[0]?.url;
        if (!cancelled && url) {
          setSampleImageUrl(url);
          setSampleFromDataset(true);
        }
      } catch {
        // 市场封面不可用时回退通用公开样本图
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deployment?.serviceInfo?.modelCode]);

  // 实时推理依赖服务在跑；运行中时随刷新静默同步状态
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load({ silent: true });
      void getEdgeCurrentModel().then(setEdgeModel).catch(() => setEdgeModel(null));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const serviceInfo = deployment?.serviceInfo ?? null;
  const running = deployment?.statusCd === "ACTIVE" && Boolean(serviceInfo);

  const realInference = useMemo<DemoRealInference | null>(() => {
    if (!running || !edgeModel || !serviceInfo) return null;
    // 设备激活模型与本服务一致时才可真实识别（与算法市场在线体验同一约束）
    if (serviceInfo.modelCode && edgeModel.modelId !== serviceInfo.modelCode) return null;
    return {
      modelName: `${serviceInfo.modelCode ?? deployment?.modelName ?? "model"} · ${serviceInfo.modelVersion ?? ""}`,
      detect: async (image, threshold) => (await detectWithEdgeModel(image, threshold)).detections,
    };
  }, [running, edgeModel, serviceInfo, deployment?.modelName]);

  const runDisabledHint = running && !realInference
    ? "当前推理服务的激活模型与该部署不一致（或推理服务尚未就绪），暂不可真实识别。"
    : null;

  if (loading) {
    return (
      <main className="services-main">
        <article className="panel workbench-loading" aria-live="polite">
          <LoaderCircle size={20} className="spinner" />
          <span>正在读取运行服务…</span>
        </article>
      </main>
    );
  }

  if (error || !deployment) {
    return (
      <main className="services-main">
        <Link className="catalog-back-link" href="/services"><ArrowLeft size={15} />返回运行服务</Link>
        <article className="panel workbench-empty-state">
          <span className="empty-state-icon"><AlertCircle size={20} /></span>
          <span className="eyebrow">运行服务</span>
          <h2>无法打开该服务</h2>
          <p>{error ?? "部署任务不存在或已被删除。"}</p>
          <Link className="secondary-button" href="/services">返回列表</Link>
        </article>
      </main>
    );
  }

  const classes = serviceInfo?.classes ?? [];
  const deviceLabel = deployment.deviceName || `设备 ${String(deployment.deviceId)}`;
  // 接口地址：按服务别名寻址（POST /{别名}/detect），与服务器 IP:端口解耦；未设别名回退通用接口 /v1/detect
  const detectPath = deployment.apiAlias ? `/${deployment.apiAlias}/detect` : "/v1/detect";
  const detectUrl = serviceInfo?.baseUrl
    ? `${String(serviceInfo.baseUrl).replace(/\/+$/, "")}${detectPath}`
    : detectPath;

  return (
    <main className="services-main">
      <div className="service-detail-header">
        <div>
          <Link className="device-back-link" href="/services">
            <ArrowLeft size={13} aria-hidden="true" />
            运行服务
          </Link>
          <h1>
            {deployment.modelName ?? "运行中的推理服务"}
            {deployment.modelVersion ? <small> {deployment.modelVersion}</small> : null}
          </h1>
          <p className="device-header-meta">
            <span className="device-status-chip" data-status={running ? "ONLINE" : "OFFLINE"}>
              {deploymentStatusLabel[deployment.statusCd] ?? deployment.statusCd}
            </span>
            <span>
              {deployment.deploymentCode} · 激活于 {deployment.activatedAt ?? "—"}
            </span>
          </p>
        </div>
        <div className="devices-header-actions">
          <Link
            className="secondary-button"
            href={`/devices?device=${encodeURIComponent(String(deployment.deviceId))}`}
            title={`${deviceLabel} · 查看设备详情`}
          >
            <Cpu size={14} />
            {deviceLabel}
          </Link>
        </div>
      </div>

      <nav className="service-detail-tabs" aria-label="运行服务详情">
        <Link
          className={`service-detail-tab${activeTab === "inference" ? " is-active" : ""}`}
          href={`/services/${encodeURIComponent(deploymentId)}?tab=inference`}
          aria-current={activeTab === "inference" ? "page" : undefined}
        >
          <Zap size={14} aria-hidden="true" />
          实时推理
        </Link>
        <Link
          className={`service-detail-tab${activeTab === "settings" ? " is-active" : ""}`}
          href={`/services/${encodeURIComponent(deploymentId)}?tab=settings`}
          aria-current={activeTab === "settings" ? "page" : undefined}
        >
          <Settings2 size={14} aria-hidden="true" />
          服务设置
        </Link>
      </nav>

      {activeTab === "inference" ? (
        running ? (
          <>
            <AlgorithmLiveDemo
              listing={stubListing(deployment, sampleImageUrl)}
              realInference={realInference ?? undefined}
              runDisabled={runDisabledHint ?? undefined}
              sampleOrigin={sampleFromDataset ? { label: "训练数据集样本" } : undefined}
            />
            <p className="service-detail-note">推理结果来自该部署所在设备的推理服务真实调用；输入图片仅用于本次体验，不留存。</p>
          </>
        ) : (
          <article className="panel workbench-empty-state">
            <span className="empty-state-icon"><AlertCircle size={20} /></span>
            <span className="eyebrow">实时推理</span>
            <h2>服务当前未在运行</h2>
            <p>该部署任务未处于 ACTIVE 状态（端侧未激活或已回退）；部署激活后可在这里直接体验真实识别。</p>
            <Link className="secondary-button" href="/services?view=records">查看部署记录</Link>
          </article>
        )
      ) : (
        <article className="panel deployment-form service-settings-panel">
          <div className="services-card-heading">
            <span><Settings2 size={17} /></span>
            <div>
              <span className="eyebrow">运行配置 · 端侧推理服务随部署激活上报</span>
              <h2>服务设置</h2>
            </div>
            <span className="device-status-chip service-settings-status" data-status={running ? "ONLINE" : "OFFLINE"}>
              {deploymentStatusLabel[deployment.statusCd] ?? deployment.statusCd}
            </span>
          </div>
          {serviceInfo ? (
            <div className="deployment-form-grid">
              <label><span>服务名称</span><input readOnly value={serviceInfo.serviceName ?? "—"} /></label>
              <label><span>服务端口</span><input readOnly value={serviceInfo.port != null ? String(serviceInfo.port) : "—"} /></label>
              <label className="capability-wide-field"><span>服务器地址</span><input readOnly value={serviceInfo.baseUrl ?? "—"} /></label>
              <label className="capability-wide-field">
                <span>接口地址（POST）</span>
                <div className="endpoint-input service-endpoint-static" title={detectUrl}>
                  <span>{serviceInfo.baseUrl ? `${String(serviceInfo.baseUrl).replace(/\/+$/, "")}/` : "/"}</span>
                  <input readOnly value={detectPath.replace(/^\//, "")} />
                </div>
                <small className="service-endpoint-hint">
                  {deployment.apiAlias
                    ? `按服务别名 /${deployment.apiAlias} 寻址，与服务器 IP:端口解耦`
                    : "通用接口（未设置服务别名）"}
                </small>
              </label>
              <label><span>运行时</span><input readOnly value={serviceInfo.runtime ?? "—"} /></label>
              <label><span>模型版本</span><input readOnly value={serviceInfo.modelVersion ?? deployment.modelVersion ?? "—"} /></label>
              <label className="capability-wide-field"><span>运行模型</span><input readOnly value={serviceInfo.modelCode ?? deployment.modelName ?? "—"} /></label>
              <label><span>所在设备</span>
                <div className="form-static">
                  <Link className="service-device-link" href={`/devices?device=${encodeURIComponent(String(deployment.deviceId))}`}>
                    {deviceLabel}
                  </Link>
                </div>
              </label>
              <label><span>设备状态</span>
                <div className="form-static">
                  <span className="device-status-chip" data-status={deployment.deviceStatusCd ?? "OFFLINE"}>
                    {deployment.deviceStatusCd ? deviceStatusLabel[deployment.deviceStatusCd] ?? deployment.deviceStatusCd : "—"}
                  </span>
                </div>
              </label>
              <label className="capability-wide-field"><span>识别类别</span>
                <div className="form-static">{classes.length ? classes.join("、") : "—"}</div>
              </label>
            </div>
          ) : (
            <p className="device-detail-hint">暂无服务设置：端侧激活部署后才会上报推理服务信息。</p>
          )}
          <p className="service-detail-note">
            端口与地址由设备侧推理服务配置决定，如需调整请在设备上修改推理服务配置并重载模型。
          </p>
        </article>
      )}
    </main>
  );
}
