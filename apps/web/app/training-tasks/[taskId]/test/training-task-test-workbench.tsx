"use client";

import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  LoaderCircle,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AutomlTrainingTask,
  getAutomlTrainingTask,
  listAutomlTrainingTaskDeployments,
} from "../../../../lib/automl-training-api";
import {
  type EdgeInferenceSession,
  createEdgeInferenceSession,
  renewEdgeInferenceSession,
  stopEdgeInferenceSession,
} from "../../../../lib/edge-session-api";
import { AlgorithmLiveDemo, type DemoRealInference } from "../../../components/algorithm-live-demo";
import { detectWithSessionModel } from "../../../../lib/edge-session-api";
import type { AlgorithmCatalogItem } from "../../../../lib/catalog-mock-data";
import { useTaskDatasetCard } from "../use-task-dataset-card";

// 测试验证页：整页承载「在线体验」，推理走临时会话实例（独立端口、与常驻服务隔离）。
// 进入页面创建会话，离开页面销毁；edge-service 侧另有空闲 TTL 兜底。
const SESSION_RENEW_INTERVAL_MS = 60_000;

export function TrainingTaskTestWorkbench({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AutomlTrainingTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<EdgeInferenceSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const datasetCard = useTaskDatasetCard(task);
  const sessionRef = useRef<EdgeInferenceSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextTask, deployments] = await Promise.all([
        getAutomlTrainingTask(taskId),
        listAutomlTrainingTaskDeployments(taskId).catch(() => []),
      ]);
      setTask(nextTask);
      setError(null);
      const activeDeployment = deployments.find((deployment) => deployment.statusCd === "ACTIVE");
      const serviceInfo = activeDeployment?.serviceInfo;
      if (activeDeployment && serviceInfo?.modelCode && serviceInfo.modelVersion) {
        try {
          const nextSession = await createEdgeInferenceSession({
            deploymentId: String(activeDeployment.deploymentId),
            modelId: serviceInfo.modelCode,
            version: serviceInfo.modelVersion,
          });
          sessionRef.current = nextSession;
          setSession(nextSession);
          setSessionError(null);
        } catch (reason) {
          setSession(null);
          setSessionError(reason instanceof Error ? reason.message : "临时推理会话创建失败");
        }
      } else {
        setSession(null);
        setSessionError(activeDeployment
          ? "部署信息缺少模型标识（可能是旧版本部署），请重新部署后再测试验证。"
          : null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "训练任务详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
    return () => {
      // 离开页面销毁临时会话（TTL 兜底 + edge-service 重启清理）
      const current = sessionRef.current;
      sessionRef.current = null;
      if (current) void stopEdgeInferenceSession(current.sessionId);
    };
  }, [load]);

  // 会话续期：测试页停留期间每分钟 ping 一次，避免被空闲 TTL 回收
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      void renewEdgeInferenceSession().then((renewed) => {
        if (!renewed) setSession(null);
      });
    }, SESSION_RENEW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [session]);

  // 演示 listing：封面样本真实标注 + 训练的基础模型名（与算法市场「在线体验」同组件）
  const demoListing = useMemo(() => {
    if (!datasetCard?.coverUrl || !task) return null;
    return {
      id: `task-${String(taskId)}-test`,
      name: task.name,
      model_architecture: task.baseModelName || "已训练模型",
      is_mock: false,
      latency_p95: null,
      preview: {
        image_url: datasetCard.coverUrl,
        aspect_ratio: null,
        scene: "studio",
        boxes: datasetCard.coverBoxes.map((box) => ({
          label: box.labelName,
          confidence: null,
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
        })),
      },
    } as unknown as AlgorithmCatalogItem;
  }, [datasetCard, task, taskId]);

  // 真实推理：打临时会话实例（当前任务部署的模型），与常驻激活模型无关
  const realInference = useMemo<DemoRealInference | null>(() => {
    if (!session) return null;
    return {
      modelName: `临时会话 · ${session.modelId} · ${session.modelVersion}`,
      detect: async (image, threshold) => {
        const result = await detectWithSessionModel(image, threshold);
        return result.detections;
      },
    };
  }, [session]);

  if (loading && !task) {
    return (
      <section className="task-detail-page">
        <article className="panel workbench-loading" aria-live="polite">
          <LoaderCircle size={20} className="spinner" />
          <span>正在读取任务详情…</span>
        </article>
      </section>
    );
  }

  if (error && !task) {
    return (
      <section className="task-detail-page">
        <div className="workbench-message error-message" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>重试</button>
        </div>
      </section>
    );
  }

  if (!task) return null;

  const notDeployed = task.statusCd !== "SUCCEEDED" || !session;
  const demoReady = Boolean(demoListing && session && realInference);

  return (
    <section className="task-detail-page">
      <div className="devices-header">
        <div>
          <Link className="device-back-link" href={`/training-tasks/${encodeURIComponent(String(taskId))}`}>
            <ArrowLeft size={13} aria-hidden="true" />
            任务 / {task.name || task.taskCode}
          </Link>
          <h1>测试验证</h1>
          <p className="device-header-meta">
            <span className="task-header-model-chip" title={`基础模型 ${task.baseModelName || "未选"}（平台 ${task.platformName || "—"}）`}>
              <Boxes size={12} aria-hidden="true" />
              {task.baseModelName || "未选基础模型"}
            </span>
            <span>{task.taskCode} · 数据集 {datasetCard?.name || "—"}</span>
          </p>
        </div>
      </div>

      {session ? (
        <p className="device-detail-hint task-session-line" role="status">
          <Radio size={12} aria-hidden="true" /> 临时推理服务已就绪 · {session.modelId} · {session.modelVersion}
          {" · "}端口 {session.port} · 离开本页或空闲 {Math.round((session.idleTtlSeconds ?? 600) / 60)} 分钟后自动销毁
        </p>
      ) : null}
      {sessionError ? (
        <div className="workbench-message error-message" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{sessionError}</span>
          <button type="button" onClick={() => void load()}>重试</button>
        </div>
      ) : null}

      {demoReady && demoListing && realInference ? (
        // 组件自带「在线体验」标题卡，与算法市场详情页同构，不再额外包一层
        <AlgorithmLiveDemo listing={demoListing} realInference={realInference} />
      ) : notDeployed && !sessionError ? (
        <div className="workbench-message notice-message" role="status">
          <AlertCircle size={15} aria-hidden="true" />
          <span>
            {task.statusCd !== "SUCCEEDED"
              ? "任务训练完成后才能进行测试验证。"
              : "该任务尚未部署到设备：先在任务详情页点「部署」，部署激活后即可测试验证。"}
          </span>
          <Link className="secondary-button compact" href={`/training-tasks/${encodeURIComponent(String(taskId))}`}>
            返回任务详情
          </Link>
        </div>
      ) : null}
    </section>
  );
}
