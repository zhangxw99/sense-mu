"use client";

import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Bell,
  Boxes,
  ChevronDown,
  Cpu,
  Database,
  FolderKanban,
  Layers,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  ShieldAlert,
  Store,
  Tags,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { MorphIcon } from "./morph-icon";
import { Menu as MenuData, PanelLeft as PanelLeftData, PanelRight as PanelRightData, X as XData } from "lucide";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  catalogApi,
  CatalogApiError,
  type CurrentIdentity,
  type Project,
} from "../../lib/catalog-api";
import {
  AUTOML_DATASETS_CHANGED_EVENT,
  AUTOML_TOKEN_CHANGED_EVENT,
  type AutomlDataset,
  deleteAutomlDataset,
  listAutomlDatasets,
} from "../../lib/automl-data-api";
import {
  AUTOML_TRAINING_TASKS_CHANGED_EVENT,
  deleteAutomlTrainingTask,
  listAutomlTrainingTasks,
  type AutomlTrainingTask,
} from "../../lib/automl-training-api";
import { listAutomlDeployments } from "../../lib/automl-device-api";
import { getAuthLoginHref, getWebAuthConfig } from "../../lib/auth-config";
import { isHostedPreview } from "../../lib/preview-mock-api";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const SIDEBAR_COLLAPSED_WIDTH = 74;
const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 288;
const SIDEBAR_SNAP_WIDTH = 150;
const SIDEBAR_WIDTH_STORAGE_KEY = "sensemu-sidebar-width";

function normalizeSidebarWidth(width: number): number {
  if (width < SIDEBAR_SNAP_WIDTH) return SIDEBAR_COLLAPSED_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, width));
}

function syncSidebarPresentation(width: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--persisted-sidebar-width", `${width}px`);
  document.documentElement.dataset.sidebarCollapsed = String(
    width < SIDEBAR_MIN_EXPANDED_WIDTH,
  );
}

export type ProductArea =
  | "overview"
  | "studio"
  | "devices"
  | "training-platforms"
  | "constants"
  | "training-tasks"
  | "algorithm-market"
  | "data-market"
  | "services"
  | "providers"
  | "settings"
  | "me";

type NavigationItem = {
  label: string;
  icon: LucideIcon;
  area: ProductArea;
  href: string;
  badge?: string;
};

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "设备",
    items: [
      { label: "边缘设备", icon: Cpu, area: "devices", href: "/devices" },
    ],
  },
  {
    label: "市场",
    items: [
      { label: "算法市场", icon: Store, area: "algorithm-market", href: "/marketplace" },
      { label: "数据市场", icon: Boxes, area: "data-market", href: "/data-market" },
    ],
  },
  {
    label: "平台",
    items: [
      { label: "训练平台", icon: Layers, area: "training-platforms", href: "/training-platforms" },
      { label: "常量管理", icon: Tags, area: "constants", href: "/constants" },
    ],
  },
  {
    label: "账户",
    items: [{ label: "我的", icon: UserRound, area: "me", href: "/me" }],
  },
];

type WorkbenchGroupKey = "annotate" | "train" | "deploy";

type WorkbenchResources = {
  projects: Array<Project & { modelCount: number }>;
};

type WorkbenchResourceLoadError = "unavailable" | "permission_denied";

const emptyWorkbenchResources: WorkbenchResources = {
  projects: [],
};

type ResourceAction =
  | { kind: "dataset"; id: string; name: string }
  | { kind: "project"; id: string; name: string }
  | { kind: "training-task"; id: string; name: string };

function defaultWorkbenchGroups(pathname: string): Record<WorkbenchGroupKey, boolean> {
  if (pathname.startsWith("/studio/data")) {
    return { annotate: true, train: false, deploy: false };
  }
  if (pathname.startsWith("/services")) {
    return { annotate: false, train: false, deploy: true };
  }
  if (pathname.startsWith("/training-tasks")) {
    return { annotate: false, train: true, deploy: false };
  }
  if (pathname.startsWith("/studio")) {
    return { annotate: false, train: true, deploy: false };
  }
  return { annotate: false, train: false, deploy: false };
}

function Navigation({
  active,
  collapsed,
  dragging,
  width,
  onToggle,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerEnd,
  onResizeKeyDown,
  onMobileClose,
  identity,
  resources,
  automlDatasets,
  trainingTasks,
  onRefreshTrainingTasks,
  deploymentCount,
  resourceLoadError,
  onRefreshResources,
  onRefreshAutomlDatasets,
  expandedGroups,
  onToggleGroup,
  onDeleteDataset,
  onDeleteTrainingTask,
  onArchiveProject,
}: {
  active: ProductArea;
  collapsed: boolean;
  dragging: boolean;
  width: number;
  onToggle: () => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onMobileClose: () => void;
  identity: CurrentIdentity | null;
  resources: WorkbenchResources;
  automlDatasets: AutomlDataset[];
  trainingTasks: AutomlTrainingTask[];
  onRefreshTrainingTasks: () => void;
  /** 运行中的部署服务数（§6.11.2 ACTIVE 口径，每设备最新激活去重） */
  deploymentCount: number | null;
  resourceLoadError: WorkbenchResourceLoadError | null;
  onRefreshResources: () => void;
  onRefreshAutomlDatasets: () => void;
  expandedGroups: Record<WorkbenchGroupKey, boolean>;
  onToggleGroup: (group: WorkbenchGroupKey) => void;
  onDeleteDataset: (dataset: AutomlDataset) => void;
  onDeleteTrainingTask: (task: AutomlTrainingTask) => void;
  onArchiveProject: (project: Project) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedProjectId = searchParams.get("project");
  const selectedDatasetId = searchParams.get("dataset");
  const currentProject = resources.projects.find((project) => project.id === selectedProjectId)
    ?? resources.projects[0]
    ?? null;
  const addDatasetHref = "/studio/data?createDataset=1";
  const addTrainingHref = currentProject
    ? `/studio/training?project=${encodeURIComponent(currentProject.id)}&compose=1#new-training`
    : "/studio/data?createProject=1";
  const roleLabels = {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
    viewer: "查看者",
  };
  const primaryRole = identity?.memberships[0]?.role;
  const profileName = identity?.display_name ?? identity?.email ?? "未登录";
  const initials = profileName.trim().slice(0, 2).toUpperCase() || "SM";
  const resourceAlert = resourceLoadError === "permission_denied"
    ? { label: "工作台访问权限已变更", retryLabel: "重新检查工作台权限", emptyLabel: "无法访问" }
    : { label: "资源暂不可用", retryLabel: "重新加载工作台资源", emptyLabel: "暂不可用" };
  return (
    <aside className="sidebar" id="primary-sidebar">
      <Link className="brand-row" href="/" aria-label="SenseMu 首页">
        <span className="brand-logo" aria-hidden="true">
          <Image
            className="brand-logo-wide"
            src="/sensemu-logo-wide.svg"
            alt=""
            width={317}
            height={86}
            priority
          />
          <Image
            className="brand-logo-mark"
            src="/sensemu-logo-mark.svg"
            alt=""
            width={76}
            height={86}
            priority
          />
        </span>
      </Link>

      <button
        className="mobile-sidebar-close"
        type="button"
        aria-label="关闭主菜单"
        onClick={onMobileClose}
      >
        <X size={17} aria-hidden="true" />
      </button>

      <div
        className="sidebar-resize-handle"
        role="slider"
        aria-label="调整侧栏宽度"
        aria-orientation="horizontal"
        aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        aria-valuetext={collapsed ? "已收起" : `${Math.round(width)} 像素`}
        tabIndex={0}
        title="拖动调整侧栏宽度"
        onDoubleClick={onToggle}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerEnd}
        onPointerCancel={onResizePointerEnd}
      >
        <span className={dragging ? "is-active" : ""} aria-hidden="true" />
      </div>

      <nav className="primary-navigation" aria-label="主导航">
        <div className="navigation-group workbench-navigation-group">
          <div className="workbench-navigation-label-row">
            <span className="navigation-label">工作台</span>
            <button
              className="workbench-resource-refresh"
              type="button"
              aria-label="刷新工作台资源"
              title="刷新工作台资源"
              onClick={onRefreshResources}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>
          <Link
            className={`workbench-home-link${active === "overview" ? " is-current" : ""}`}
            href="/"
            aria-current={active === "overview" ? "page" : undefined}
            title={collapsed ? "概览" : undefined}
            onClick={onMobileClose}
          >
            <LayoutDashboard size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>概览</span>
          </Link>

          {resourceLoadError ? (
            <div className="workbench-resource-alert" role="status" aria-live="polite">
              <span>{resourceAlert.label}</span>
              <button
                type="button"
                aria-label={resourceAlert.retryLabel}
                title={resourceAlert.retryLabel}
                onClick={onRefreshResources}
              >
                <RefreshCw size={13} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <div className="workbench-navigation" aria-label="工作台对象">
            <WorkbenchNavigationGroup
              group="annotate"
              label="数据与标注"
              icon={Database}
              count={automlDatasets.length}
              expanded={expandedGroups.annotate}
              onToggle={onToggleGroup}
              addHref={addDatasetHref}
              addLabel="新建数据集"
              onMobileClose={onMobileClose}
            >
              {automlDatasets.length ? automlDatasets.map((dataset) => {
                const selected = pathname.startsWith("/studio/data") && selectedDatasetId === String(dataset.id);
                return (
                  <div className={`workbench-resource-row${selected ? " is-current" : ""}`} key={dataset.id}>
                    <Link
                      className="workbench-resource-link"
                      href={`/studio/data?dataset=${encodeURIComponent(String(dataset.id))}`}
                      title={dataset.name}
                      onClick={onMobileClose}
                    >
                      <span className="workbench-resource-mark">{dataset.name.slice(0, 1).toUpperCase()}</span>
                      <span>{dataset.name}</span>
                      <small>{dataset.sampleCount ?? ""}</small>
                    </Link>
                    <button
                      className="workbench-resource-action is-danger"
                      type="button"
                      aria-label={`删除数据集 ${dataset.name}`}
                      title="删除数据集"
                      onClick={() => { onMobileClose(); onDeleteDataset(dataset); }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                );
              }) : (
                <span className="workbench-resource-empty">
                  暂无数据集
                  <button type="button" onClick={onRefreshAutomlDatasets} aria-label="重新加载数据集">↻</button>
                </span>
              )}
            </WorkbenchNavigationGroup>

            <WorkbenchNavigationGroup
              group="train"
              label="训练"
              icon={FolderKanban}
              count={trainingTasks.length || resources.projects.length}
              expanded={expandedGroups.train}
              onToggle={onToggleGroup}
              addHref={addTrainingHref}
              addLabel={currentProject ? "新建训练" : "新建项目"}
              onMobileClose={onMobileClose}
            >
              {/* 动态训练任务：进行中优先，点开直达详情；「训练任务」入口进完整列表 */}
              {trainingTasks.length ? [...trainingTasks]
                .sort((left, right) => {
                  const activeStatuses = new Set(["QUEUED", "SCHEDULED", "RUNNING"]);
                  const leftActive = activeStatuses.has(left.statusCd) ? 0 : 1;
                  const rightActive = activeStatuses.has(right.statusCd) ? 0 : 1;
                  return leftActive - rightActive
                    || (Number(right.progress) || 0) - (Number(left.progress) || 0);
                })
                .slice(0, 6)
                .map((task) => {
                  const selected = pathname === `/training-tasks/${task.id}`;
                  return (
                    <div className={`workbench-resource-row${selected ? " is-current" : ""}`} key={`task-${task.id}`}>
                      <Link
                        className="workbench-resource-link"
                        href={`/training-tasks/${task.id}`}
                        title={`${task.name}（${task.statusCd}）`}
                        onClick={onMobileClose}
                      >
                        <span
                          className="workbench-task-dot"
                          data-status={task.statusCd}
                          aria-hidden="true"
                        />
                        <span>{task.name}</span>
                        <small>{Number(task.progress) || 0}%</small>
                      </Link>
                      {task.statusCd !== "RUNNING" && task.statusCd !== "SCHEDULED" ? (
                        <button
                          className="workbench-resource-action is-danger"
                          type="button"
                          aria-label={`删除训练任务 ${task.name}`}
                          title="删除训练任务"
                          onClick={() => { onMobileClose(); onDeleteTrainingTask(task); }}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  );
                }) : null}
              <div className={`workbench-resource-row${active === "training-tasks" ? " is-current" : ""}`}>
                <Link
                  className="workbench-resource-link"
                  href="/training-tasks"
                  title="训练任务"
                  onClick={onMobileClose}
                >
                  <span className="workbench-resource-mark is-project">训</span>
                  <span>全部训练任务</span>
                  <small>{trainingTasks.length || ""}</small>
                </Link>
              </div>
              {resourceLoadError && !resources.projects.length ? <span className="workbench-resource-empty">{resourceAlert.emptyLabel}</span> : resources.projects.length ? resources.projects.map((project) => {
                const selected = (pathname === "/studio" || pathname.startsWith("/studio/training"))
                  && selectedProjectId === project.id;
                return (
                  <div className={`workbench-resource-row${selected ? " is-current" : ""}`} key={project.id}>
                    <Link
                      className="workbench-resource-link"
                      href={`/studio?project=${encodeURIComponent(project.id)}`}
                      title={project.name}
                      onClick={onMobileClose}
                    >
                      <span className="workbench-resource-mark is-project">{project.name.slice(0, 1).toUpperCase()}</span>
                      <span>{project.name}</span>
                      <small>{project.status === "paused" ? "暂停" : project.modelCount || ""}</small>
                    </Link>
                    <button
                      className="workbench-resource-action"
                      type="button"
                      aria-label={`归档项目 ${project.name}`}
                      title="归档项目"
                      onClick={() => { onMobileClose(); onArchiveProject(project); }}
                    >
                      <Archive size={13} aria-hidden="true" />
                    </button>
                  </div>
                );
              }) : <span className="workbench-resource-empty">暂无训练项目</span>}
            </WorkbenchNavigationGroup>

            <WorkbenchNavigationGroup
              group="deploy"
              label="部署"
              icon={Rocket}
              count={deploymentCount ?? 0}
              expanded={expandedGroups.deploy}
              onToggle={onToggleGroup}
              onMobileClose={onMobileClose}
            >
              <div className="workbench-resource-row">
                <Link
                  className="workbench-resource-link"
                  href="/services"
                  title="运行服务"
                  onClick={onMobileClose}
                >
                  <span className="workbench-resource-mark is-project">运</span>
                  <span>运行服务</span>
                </Link>
              </div>
            </WorkbenchNavigationGroup>
          </div>
          <div className="workbench-collapsed-shortcuts" aria-label="工作台快捷入口">
            <button
              type="button"
              aria-label="数据与标注"
              title="数据与标注"
              onClick={() => onToggleGroup("annotate")}
            >
              <Database size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="训练"
              title="训练"
              onClick={() => onToggleGroup("train")}
            >
              <FolderKanban size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="部署"
              title="部署"
              onClick={() => onToggleGroup("deploy")}
            >
              <Rocket size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </div>

        {navigationGroups.map((group) => (
          <div className="navigation-group" key={group.label}>
            <span className="navigation-label">{group.label}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.area
                || (item.area === "overview" && (active === "studio" || active === "services"))
                || (item.area === "me" && (active === "providers" || active === "settings"));
              return (
                <Link
                  className={`navigation-item${isActive ? " is-active" : ""}`}
                  href={item.href}
                  key={item.label}
                  aria-current={isActive ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  onClick={onMobileClose}
                >
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <Link
          className="profile-row"
          href="/me"
          aria-label="打开我的"
          onClick={onMobileClose}
        >
          <span className="avatar">{initials}</span>
          <span className="profile-copy">
            <strong>{profileName}</strong>
            <small>{identity ? (primaryRole ? roleLabels[primaryRole] : "尚无工作区") : "需要登录"}</small>
          </span>
          <MoreHorizontal size={17} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

function WorkbenchNavigationGroup({
  group,
  label,
  icon: Icon,
  count,
  expanded,
  onToggle,
  addHref,
  addLabel,
  onMobileClose,
  children,
}: {
  group: WorkbenchGroupKey;
  label: string;
  icon: LucideIcon;
  // 单入口分组（如部署）没有计数，缺省时隐藏数字
  count?: number;
  expanded: boolean;
  onToggle: (group: WorkbenchGroupKey) => void;
  // 设备等自注册资源没有「新建」动作，addHref 缺省时隐藏 + 按钮
  addHref?: string;
  addLabel?: string;
  onMobileClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`workbench-navigation-section${expanded ? " is-expanded" : ""}`}>
      <div className="workbench-navigation-heading-row">
        <button
          className="workbench-navigation-heading"
          type="button"
          aria-expanded={expanded}
          aria-controls={`workbench-navigation-${group}`}
          onClick={() => onToggle(group)}
        >
          <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
          {count != null ? <small>{count}</small> : null}
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {addHref ? (
          <Link
            className="workbench-navigation-add"
            href={addHref}
            aria-label={addLabel}
            title={addLabel}
            onClick={onMobileClose}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <div className="workbench-resource-list" id={`workbench-navigation-${group}`} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

function Topbar({
  sidebarCollapsed,
  onSidebarToggle,
  mobileNavigationOpen,
  onMobileNavigationOpen,
  previewMode,
}: {
  sidebarCollapsed: boolean;
  onSidebarToggle: () => void;
  mobileNavigationOpen: boolean;
  onMobileNavigationOpen: () => void;
  previewMode: boolean;
}) {
  return (
    <header className="topbar">
      <button
        className="mobile-menu-button"
        type="button"
        aria-label={mobileNavigationOpen ? "关闭主菜单" : "打开主菜单"}
        aria-expanded={mobileNavigationOpen}
        aria-controls="primary-sidebar"
        onClick={onMobileNavigationOpen}
      >
        <MorphIcon icon={mobileNavigationOpen ? XData : MenuData} size={18} aria-hidden="true" />
      </button>
      <button
        className="desktop-sidebar-toggle"
        type="button"
        aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        aria-expanded={!sidebarCollapsed}
        aria-controls="primary-sidebar"
        onClick={onSidebarToggle}
      >
        <MorphIcon icon={sidebarCollapsed ? PanelRightData : PanelLeftData} size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <label className="global-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">搜索项目、数据集和模型</span>
        <input placeholder="搜索项目、数据集和模型" />
        <kbd>⌘ K</kbd>
      </label>

      <div className="topbar-actions">
        {previewMode ? <span className="preview-mode-badge">演示数据</span> : null}
        <button className="icon-button" type="button" aria-label="通知">
          <Bell size={17} />
          <span className="notification-dot" />
        </button>
      </div>
    </header>
  );
}

export function ProductShell({
  active,
  children,
}: {
  active: ProductArea;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedProjectId = searchParams.get("project");
  const selectedDatasetId = searchParams.get("dataset");
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [identity, setIdentity] = useState<CurrentIdentity | null>(null);
  const [identityStatus, setIdentityStatus] = useState<
    "loading" | "authenticated" | "unauthenticated" | "unavailable"
  >("loading");
  const [previewMode, setPreviewMode] = useState(false);
  const [workbenchResources, setWorkbenchResources] = useState<WorkbenchResources>(emptyWorkbenchResources);
  const [automlDatasets, setAutomlDatasets] = useState<AutomlDataset[]>([]);
  const [deploymentCount, setDeploymentCount] = useState<number | null>(null);
  const [trainingTasks, setTrainingTasks] = useState<AutomlTrainingTask[]>([]);
  const [workbenchWorkspaceId, setWorkbenchWorkspaceId] = useState<string | null>(null);
  const [resourceLoadError, setResourceLoadError] = useState<WorkbenchResourceLoadError | null>(null);
  const [expandedWorkbenchGroups, setExpandedWorkbenchGroups] = useState<Record<WorkbenchGroupKey, boolean>>(
    () => defaultWorkbenchGroups(pathname),
  );
  const [pendingResourceAction, setPendingResourceAction] = useState<ResourceAction | null>(null);
  const [resourceActionBusy, setResourceActionBusy] = useState(false);
  const [resourceActionError, setResourceActionError] = useState<string | null>(null);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const lastExpandedWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const workbenchRefreshRequestRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const resolvedSidebarWidth = sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH;
  const sidebarCollapsed = resolvedSidebarWidth < SIDEBAR_MIN_EXPANDED_WIDTH;
  // /training-tasks 前缀（含 [taskId] 详情页）统一高亮「训练任务」入口
  const activeArea: ProductArea = pathname.startsWith("/training-tasks")
    ? "training-tasks"
    : active;
  const webAuthConfig = getWebAuthConfig();
  const authLoginHref = getAuthLoginHref(
    webAuthConfig.loginUrl,
    `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
  );

  function updateSidebarWidth(width: number) {
    sidebarWidthRef.current = width;
    syncSidebarPresentation(width);
    setSidebarWidth(width);
  }

  function persistSidebarWidth(width: number) {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
      window.localStorage.removeItem("sensemu-sidebar-collapsed");
    } catch {
      // The resize interaction remains usable when browser storage is unavailable.
    }
  }

  useEffect(() => {
    const restorePreference = window.setTimeout(() => {
      let restoredWidth = window.matchMedia("(max-width: 820px)").matches
        ? SIDEBAR_COLLAPSED_WIDTH
        : SIDEBAR_DEFAULT_WIDTH;
      try {
        const savedWidth = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
        const legacyCollapsed = window.localStorage.getItem("sensemu-sidebar-collapsed");
        if (savedWidth !== null && Number.isFinite(Number(savedWidth))) {
          restoredWidth = normalizeSidebarWidth(Number(savedWidth));
        } else if (legacyCollapsed !== null) {
          restoredWidth = legacyCollapsed === "true"
            ? SIDEBAR_COLLAPSED_WIDTH
            : SIDEBAR_DEFAULT_WIDTH;
        }
      } catch {
        // Use the responsive default when browser storage is unavailable.
      }
      if (restoredWidth >= SIDEBAR_MIN_EXPANDED_WIDTH) {
        lastExpandedWidthRef.current = restoredWidth;
      }
      updateSidebarWidth(restoredWidth);
    }, 0);
    return () => window.clearTimeout(restorePreference);
  }, []);

  useEffect(() => {
    setPreviewMode(isHostedPreview());
  }, []);

  const refreshIdentity = useCallback(async () => {
    setIdentityStatus("loading");
    try {
      const currentIdentity = await catalogApi.getCurrentIdentity();
      setIdentity(currentIdentity);
      setIdentityStatus("authenticated");
    } catch (reason) {
      setIdentity(null);
      setIdentityStatus(
        reason instanceof CatalogApiError && reason.code === "service_unavailable"
          ? "unavailable"
          : "unauthenticated",
      );
    }
  }, []);

  useEffect(() => {
    void refreshIdentity();
    function handleSessionExpired() {
      setIdentity(null);
      setIdentityStatus("unauthenticated");
    }
    window.addEventListener("sensemu:session-expired", handleSessionExpired);
    return () => window.removeEventListener("sensemu:session-expired", handleSessionExpired);
  }, [refreshIdentity]);

  const refreshWorkbenchResources = useCallback(async () => {
    const requestId = ++workbenchRefreshRequestRef.current;
    const isCurrentRequest = () => requestId === workbenchRefreshRequestRef.current;
    try {
      const workspaces = await catalogApi.listWorkspaces();
      if (!isCurrentRequest()) return;
      const workspace = workspaces[0];
      if (!workspace) {
        setWorkbenchWorkspaceId(null);
        setWorkbenchResources(emptyWorkbenchResources);
        setResourceLoadError(null);
        return;
      }
      const projects = await catalogApi.listProjects(workspace.id);
      const groups = await Promise.all(projects.map(async (project) => {
        const models = await catalogApi.listModelVersions(workspace.id, project.id);
        return { project: { ...project, modelCount: models.length } };
      }));
      if (!isCurrentRequest()) return;
      setWorkbenchResources({
        projects: groups.map((group) => group.project),
      });
      setWorkbenchWorkspaceId(workspace.id);
      setResourceLoadError(null);
    } catch (reason) {
      if (!isCurrentRequest()) return;
      if (reason instanceof CatalogApiError && reason.code === "permission_denied") {
        setWorkbenchWorkspaceId(null);
        setWorkbenchResources(emptyWorkbenchResources);
        setResourceLoadError("permission_denied");
        return;
      }
      if (reason instanceof CatalogApiError && reason.code === "session_expired") {
        setWorkbenchWorkspaceId(null);
        setWorkbenchResources(emptyWorkbenchResources);
        setResourceLoadError(null);
        return;
      }
      setResourceLoadError("unavailable");
    }
  }, []);

  const refreshAutomlDatasets = useCallback(async () => {
    try {
      const page = await listAutomlDatasets({ page: 1, limit: 50 });
      setAutomlDatasets(page.rows);
    } catch {
      setAutomlDatasets([]);
    }
  }, []);

  const refreshTrainingTasks = useCallback(async () => {
    try {
      const page = await listAutomlTrainingTasks({ page: 1, limit: 8 });
      setTrainingTasks(page.rows);
    } catch {
      setTrainingTasks([]);
    }
  }, []);

  useEffect(() => {
    void refreshWorkbenchResources();
  }, [refreshWorkbenchResources]);

  useEffect(() => {
    void refreshAutomlDatasets();
    void refreshTrainingTasks();
    window.addEventListener(AUTOML_TOKEN_CHANGED_EVENT, refreshAutomlDatasets);
    window.addEventListener(AUTOML_DATASETS_CHANGED_EVENT, refreshAutomlDatasets);
    window.addEventListener(AUTOML_TRAINING_TASKS_CHANGED_EVENT, refreshTrainingTasks);
    return () => {
      window.removeEventListener(AUTOML_TOKEN_CHANGED_EVENT, refreshAutomlDatasets);
      window.removeEventListener(AUTOML_DATASETS_CHANGED_EVENT, refreshAutomlDatasets);
      window.removeEventListener(AUTOML_TRAINING_TASKS_CHANGED_EVENT, refreshTrainingTasks);
    };
  }, [refreshAutomlDatasets, refreshTrainingTasks]);

  const refreshDeploymentCount = useCallback(async () => {
    try {
      // 运行中口径：ACTIVE 且每设备最新一次激活去重，total 即运行服务数
      const page = await listAutomlDeployments({ page: 1, limit: 1, statusCd: "ACTIVE" });
      setDeploymentCount(Number(page.total) || 0);
    } catch {
      // 后端不可用时保持上次值
    }
  }, []);

  useEffect(() => {
    void refreshDeploymentCount();
    window.addEventListener(AUTOML_TOKEN_CHANGED_EVENT, refreshDeploymentCount);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshDeploymentCount();
    }, 30_000);
    return () => {
      window.removeEventListener(AUTOML_TOKEN_CHANGED_EVENT, refreshDeploymentCount);
      window.clearInterval(timer);
    };
  }, [refreshDeploymentCount]);

  useEffect(() => {
    setExpandedWorkbenchGroups(defaultWorkbenchGroups(pathname));
  }, [pathname]);

  function toggleWorkbenchGroup(group: WorkbenchGroupKey) {
    if (sidebarCollapsed) {
      const nextWidth = lastExpandedWidthRef.current;
      updateSidebarWidth(nextWidth);
      persistSidebarWidth(nextWidth);
      setExpandedWorkbenchGroups((current) => ({ ...current, [group]: true }));
      return;
    }
    setExpandedWorkbenchGroups((current) => ({ ...current, [group]: !current[group] }));
  }

  function requestResourceAction(action: ResourceAction) {
    setResourceActionError(null);
    setPendingResourceAction(action);
  }

  function dismissResourceAction() {
    if (resourceActionBusy) return;
    setResourceActionError(null);
    setPendingResourceAction(null);
  }

  async function confirmResourceAction() {
    const action = pendingResourceAction;
    if (!action) return;
    if (action.kind !== "dataset" && action.kind !== "training-task" && !workbenchWorkspaceId) {
      setResourceActionError("未找到当前工作区，请刷新后重试");
      return;
    }

    setResourceActionBusy(true);
    setResourceActionError(null);
    try {
      if (action.kind === "dataset") {
        await deleteAutomlDataset(action.id);
        if (selectedDatasetId === action.id) {
          router.replace("/studio/data");
        }
      } else if (action.kind === "training-task") {
        // deleteAutomlTrainingTask 内部派发联动事件：侧栏与打开中的任务列表页都会刷新
        await deleteAutomlTrainingTask(action.id);
        if (pathname === `/training-tasks/${action.id}`) {
          router.replace("/training-tasks");
        }
      } else if (action.kind === "project") {
        await catalogApi.archiveProject(workbenchWorkspaceId!, action.id);
        if (selectedProjectId === action.id) {
          router.replace("/");
        }
      }
      await refreshWorkbenchResources();
      if (action.kind === "dataset") {
        await refreshAutomlDatasets();
      }
      router.refresh();
      setPendingResourceAction(null);
    } catch (reason) {
      setResourceActionError(reason instanceof Error ? reason.message : "操作未完成，请稍后重试");
    } finally {
      setResourceActionBusy(false);
    }
  }

  const resourceActionCopy = pendingResourceAction ? {
    dataset: {
      title: "删除数据集",
      confirm: "删除数据集",
      detail: "删除后数据集的版本、样本、标注和标注任务一并移除，无法恢复。已被训练任务引用的数据集不能删除。",
      Icon: Trash2,
    },
    "training-task": {
      title: "删除训练任务",
      confirm: "删除训练任务",
      detail: "删除后任务的指标、事件与产物清单一并清除，且不可恢复；已发布为模型版本的任务不可删除。",
      Icon: Trash2,
    },
    project: {
      title: "归档项目",
      confirm: "归档项目",
      detail: "归档后项目会从工作台列表移除。仍在运行的任务或在线服务需要先处理。",
      Icon: Archive,
    },
  }[pendingResourceAction.kind] : null;

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    const mobileViewport = window.matchMedia("(max-width: 620px)");
    document.body.style.overflow = "hidden";
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavigationOpen(false);
    }
    function closeOutsideMobile(event: MediaQueryListEvent) {
      if (!event.matches) setMobileNavigationOpen(false);
    }
    window.addEventListener("keydown", closeWithEscape);
    mobileViewport.addEventListener("change", closeOutsideMobile);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeWithEscape);
      mobileViewport.removeEventListener("change", closeOutsideMobile);
    };
  }, [mobileNavigationOpen]);

  function toggleSidebar() {
    const nextWidth = sidebarCollapsed
      ? lastExpandedWidthRef.current
      : SIDEBAR_COLLAPSED_WIDTH;
    updateSidebarWidth(nextWidth);
    persistSidebarWidth(nextWidth);
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidthRef.current,
    };
    setSidebarDragging(true);
  }

  function moveSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const nextWidth = Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(
        SIDEBAR_COLLAPSED_WIDTH,
        dragState.startWidth + event.clientX - dragState.startX,
      ),
    );
    updateSidebarWidth(nextWidth);
  }

  function finishSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setSidebarDragging(false);
    const nextWidth = normalizeSidebarWidth(sidebarWidthRef.current);
    if (nextWidth >= SIDEBAR_MIN_EXPANDED_WIDTH) {
      lastExpandedWidthRef.current = nextWidth;
    }
    updateSidebarWidth(nextWidth);
    persistSidebarWidth(nextWidth);
  }

  function resizeSidebarWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") {
      nextWidth = sidebarCollapsed || resolvedSidebarWidth <= SIDEBAR_MIN_EXPANDED_WIDTH
        ? SIDEBAR_COLLAPSED_WIDTH
        : Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, resolvedSidebarWidth - 16);
    } else if (event.key === "ArrowRight") {
      nextWidth = sidebarCollapsed
        ? lastExpandedWidthRef.current
        : Math.min(SIDEBAR_MAX_WIDTH, resolvedSidebarWidth + 16);
    } else if (event.key === "Home") {
      nextWidth = SIDEBAR_COLLAPSED_WIDTH;
    } else if (event.key === "End") {
      nextWidth = lastExpandedWidthRef.current;
    }
    if (nextWidth === null) return;
    event.preventDefault();
    if (nextWidth >= SIDEBAR_MIN_EXPANDED_WIDTH) {
      lastExpandedWidthRef.current = nextWidth;
    }
    updateSidebarWidth(nextWidth);
    persistSidebarWidth(nextWidth);
  }

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${sidebarDragging ? " is-sidebar-dragging" : ""}${mobileNavigationOpen ? " is-mobile-navigation-open" : ""}`}
      style={
        sidebarWidth === null
          ? undefined
          : ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties)
      }
    >
      <div className="ambient-glow" aria-hidden="true" />
      <Navigation
        active={activeArea}
        collapsed={sidebarCollapsed}
        dragging={sidebarDragging}
        width={resolvedSidebarWidth}
        onToggle={toggleSidebar}
        onResizePointerDown={startSidebarResize}
        onResizePointerMove={moveSidebarResize}
        onResizePointerEnd={finishSidebarResize}
        onResizeKeyDown={resizeSidebarWithKeyboard}
        onMobileClose={() => setMobileNavigationOpen(false)}
        identity={identity}
        resources={workbenchResources}
        automlDatasets={automlDatasets}
        deploymentCount={deploymentCount}
          trainingTasks={trainingTasks}
          onRefreshTrainingTasks={refreshTrainingTasks}
        resourceLoadError={resourceLoadError}
        onRefreshResources={() => {
          void refreshWorkbenchResources();
          void refreshTrainingTasks();
          void refreshAutomlDatasets();
        }}
        onRefreshAutomlDatasets={() => void refreshAutomlDatasets()}
        expandedGroups={expandedWorkbenchGroups}
        onToggleGroup={toggleWorkbenchGroup}
        onDeleteDataset={(dataset) => requestResourceAction({
          kind: "dataset",
          id: String(dataset.id),
          name: dataset.name,
        })}
        onDeleteTrainingTask={(task) => requestResourceAction({
          kind: "training-task",
          id: String(task.id),
          name: task.name || task.taskCode,
        })}
        onArchiveProject={(project) => requestResourceAction({
          kind: "project",
          id: project.id,
          name: project.name,
        })}
      />
      <button
        className="mobile-navigation-scrim"
        type="button"
        aria-label="关闭主菜单"
        tabIndex={mobileNavigationOpen ? 0 : -1}
        onClick={() => setMobileNavigationOpen(false)}
      />
      <div className="application-column">
        <Topbar
          sidebarCollapsed={sidebarCollapsed}
          onSidebarToggle={toggleSidebar}
          mobileNavigationOpen={mobileNavigationOpen}
          onMobileNavigationOpen={() => setMobileNavigationOpen(true)}
          previewMode={previewMode}
        />
        {identityStatus === "unauthenticated" || identityStatus === "unavailable" ? (
          <section
            className={`auth-status-banner${identityStatus === "unavailable" ? " is-unavailable" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span className="auth-status-icon" aria-hidden="true"><ShieldAlert size={16} /></span>
            <span className="auth-status-copy">
              <strong>{identityStatus === "unavailable" ? "身份服务暂不可用" : "需要登录"}</strong>
              <small>
                {identityStatus === "unavailable"
                  ? "请稍后重试；如果问题持续，请检查 Core API 的 OIDC 配置。"
                  : webAuthConfig.configured && webAuthConfig.loginUrl
                    ? "当前会话已失效，请重新登录后继续操作。"
                    : "当前 API 已启用 OIDC，但 Web 登录尚未配置完成。"}
              </small>
            </span>
            {identityStatus === "unauthenticated" && authLoginHref ? (
              <a className="auth-status-login" href={authLoginHref}>
                登录
              </a>
            ) : null}
            <button className="auth-status-retry" type="button" onClick={() => void refreshIdentity()}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>重新检查</span>
            </button>
          </section>
        ) : null}
        {children}
      </div>
      {pendingResourceAction && resourceActionCopy ? (
        <div className="workbench-dialog-backdrop resource-action-backdrop" role="presentation">
          <section
            className="workbench-dialog resource-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resource-action-title"
            aria-describedby="resource-action-detail"
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><resourceActionCopy.Icon size={18} /></span>
                <span>
                  <h2 id="resource-action-title">{resourceActionCopy.title}</h2>
                  <p>确定要处理“{pendingResourceAction.name}”吗？</p>
                </span>
              </div>
              <button type="button" aria-label="关闭" disabled={resourceActionBusy} onClick={dismissResourceAction}>×</button>
            </div>
            <p className="resource-action-detail" id="resource-action-detail">{resourceActionCopy.detail}</p>
            {resourceActionError ? <p className="resource-action-error" role="alert">{resourceActionError}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={resourceActionBusy} onClick={dismissResourceAction}>取消</button>
              <button className="primary-button resource-action-confirm" type="button" disabled={resourceActionBusy} onClick={() => void confirmResourceAction()}>
                {resourceActionBusy ? "正在处理" : resourceActionCopy.confirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
