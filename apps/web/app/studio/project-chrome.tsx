"use client";

import { ArrowLeft, ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { catalogApi, type Project } from "../../lib/catalog-api";

type ProjectView = "overview" | "data" | "training" | "publish";

const projectViewLabels: Record<ProjectView, string> = {
  overview: "概览",
  data: "数据与标注",
  training: "训练",
  publish: "发布",
};

const taskTypeLabels: Record<string, string> = {
  "object-detection": "目标检测",
  classification: "图像分类",
  segmentation: "图像分割",
  pose: "姿态估计",
  ocr: "文字识别",
};

export function ProjectChrome({ active }: { active: ProjectView }) {
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project");
  // 「新建训练」专注模式（compose=1）：页头按钮隐藏，页面只保留新建训练卡片
  const composing = active === "training" && searchParams.get("compose") === "1";
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    void catalogApi.listWorkspaces()
      .then(async (workspaces) => {
        const workspace = workspaces[0];
        if (!workspace) return;
        const projects = await catalogApi.listProjects(workspace.id);
        setProject(projects.find((item) => item.id === requestedProjectId) ?? projects[0] ?? null);
      })
      .catch(() => setProject(null));
  }, [requestedProjectId]);

  const projectId = project?.id ?? requestedProjectId;
  const projectName = project?.name ?? "项目详情";
  const paused = project?.status === "paused";
  // 头部按钮始终指向训练页签的新建训练表单，在模型页签下点击会切回训练页签
  const newTrainingHref = projectId
    ? `/studio/training?project=${projectId}&compose=1#new-training`
    : "/studio/training?compose=1#new-training";

  return (
    <div className="project-chrome">
      <div className="studio-breadcrumbs">
        <Link href="/"><ArrowLeft size={13} aria-hidden="true" />工作台</Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span>{projectViewLabels[active]}</span>
        <ChevronRight size={12} aria-hidden="true" />
        <span>{projectName}</span>
      </div>

      {!composing ? (
      <header className="project-header">
        <div className="project-identity">
          <span className="project-mark">{project ? project.name.slice(0, 2).toUpperCase() : "—"}</span>
          <div>
            <div className="project-title-row">
              <h1>{projectName}</h1>
              <span className={`project-state${paused ? " is-paused" : ""}`}>
                <span aria-hidden="true" />{paused ? "已暂停" : "进行中"}
              </span>
            </div>
            <p>
              {project?.description || "视觉算法项目"}
              <span aria-hidden="true"> · </span>
              {project ? taskTypeLabels[project.task_type] ?? project.task_type : "正在读取"}
            </p>
          </div>
        </div>
        <div className="project-actions">
          {!composing ? (
            <Link className="primary-button" href={newTrainingHref}>
              <Play size={14} fill="currentColor" aria-hidden="true" />新建训练
            </Link>
          ) : null}
        </div>
      </header>
      ) : null}
    </div>
  );
}
