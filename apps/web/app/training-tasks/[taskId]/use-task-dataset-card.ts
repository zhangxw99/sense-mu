"use client";

import { useEffect, useState } from "react";
import {
  type AutomlId,
  getAutomlDatasetVersionDetails,
  getAutomlFileUrls,
  listAutomlAnnotations,
  listAutomlDatasetMaterials,
} from "../../../lib/automl-data-api";

export type TaskDatasetCard = {
  name: string;
  version: string;
  imageCount: number;
  classCount: number;
  coverUrl: string | null;
  coverItemId: AutomlId | null;
  coverBoxes: { labelName: string; x: number; y: number; w: number; h: number }[];
};

// 标注几何 → 封面演示框：bbox 直接用；polygon 取顶点包围盒（分割标注的封面退化为外接框）
function annotationToCoverBox(
  labelName: string,
  json: Record<string, unknown>,
): { labelName: string; x: number; y: number; w: number; h: number } | null {
  if (String(json.type ?? "").toLowerCase() === "polygon") {
    const rawPoints = Array.isArray(json.points) ? json.points : [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const point of rawPoints) {
      if (!Array.isArray(point) || point.length < 2
        || typeof point[0] !== "number" || typeof point[1] !== "number") {
        return null;
      }
      xs.push(point[0]);
      ys.push(point[1]);
    }
    if (xs.length < 3) return null;
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { labelName, x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }
  if (typeof json.x !== "number" || typeof json.y !== "number"
    || typeof json.w !== "number" || typeof json.h !== "number"
    || ![json.x, json.y, json.w, json.h].every((value) => Number.isFinite(value))) {
    return null;
  }
  return { labelName, x: json.x, y: json.y, w: json.w, h: json.h };
}

// 数据集摘要卡 + 演示封面（第一个有标注的样本）：任务详情页与测试验证页共用
export function useTaskDatasetCard(
  task: { datasetId: AutomlId | null; datasetVersionId: AutomlId | null } | null,
): TaskDatasetCard | null {
  const [card, setCard] = useState<TaskDatasetCard | null>(null);
  const datasetId = task?.datasetId ?? null;
  const datasetVersionId = task?.datasetVersionId ?? null;

  useEffect(() => {
    // 摘要卡不参与轮询：数据集版本不可变，加载一次即可
    if (!datasetId || !datasetVersionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [detail, materials] = await Promise.all([
          getAutomlDatasetVersionDetails(datasetId),
          listAutomlDatasetMaterials(datasetId),
        ]);
        const version = detail.versions.find((v) => String(v.id) === String(datasetVersionId));
        const annotatedMaterials = materials.filter((material) => material.samples.length > 0);
        let firstSample = annotatedMaterials[0]?.samples[0];
        let coverUrl: string | null = null;
        let coverItemId: AutomlId | null = null;
        // 封面标注框：从前往后找第一个有标注的样本（最多试 5 个），供「测试验证」演示
        const coverBoxes: { labelName: string; x: number; y: number; w: number; h: number }[] = [];
        const candidates = annotatedMaterials.flatMap((material) => material.samples).slice(0, 5);
        for (const sample of candidates) {
          try {
            const annotations = await listAutomlAnnotations(datasetId, datasetVersionId, sample.id);
            const boxes = annotations
              .map((annotation) => annotationToCoverBox(
                annotation.labelName,
                (annotation.annotationJson ?? {}) as Record<string, unknown>,
              ))
              .filter((box): box is { labelName: string; x: number; y: number; w: number; h: number } => box !== null);
            if (boxes.length) {
              firstSample = sample;
              coverBoxes.push(...boxes);
              break;
            }
          } catch {
            // 单个样本标注读取失败不阻塞封面
          }
        }
        if (firstSample?.sampleObjectKey) {
          const urls = await getAutomlFileUrls([firstSample.sampleObjectKey]);
          coverUrl = urls[0]?.url ?? null;
          coverItemId = firstSample.id;
        }
        if (!cancelled) {
          setCard({
            name: detail.datasetName,
            version: version?.version ?? String(datasetVersionId),
            imageCount: Number(version?.sampleCount ?? detail.totalImageCount ?? 0),
            classCount: version?.classSampleStats?.length ?? 0,
            coverUrl,
            coverItemId,
            coverBoxes,
          });
        }
      } catch {
        // 摘要卡加载失败不阻塞页面主体
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [datasetId, datasetVersionId]);

  return card;
}
