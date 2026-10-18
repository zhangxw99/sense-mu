import assert from "node:assert/strict";
import test from "node:test";

const lib = await import("../lib/workbench-overview.ts");

const DATASET = (overrides = {}) => ({
  id: 910001,
  datasetCode: "DS001",
  name: "路面病害数据集",
  taskType: "OBJECT_DETECTION",
  mediaType: "IMAGE",
  sourceType: "UPLOAD",
  classNames: ["坑槽", "裂缝"],
  visibilityCd: "PRIVATE",
  description: null,
  statusCd: "ENABLED",
  createTime: "2026-10-10 09:30:00",
  latestVersionId: 920001,
  sampleCount: 120,
  imageCount: 120,
  annotatedSampleCount: 100,
  ...overrides,
});

const TASK = (overrides = {}) => ({
  id: 930001,
  taskCode: "TT001",
  name: "坑槽检测训练",
  statusCd: "RUNNING",
  platformId: 1,
  platformCode: "local",
  platformName: "本地平台",
  baseModelId: 2,
  baseModelCode: "yolo26n",
  baseModelName: "yolo26n",
  taskType: "OBJECT_DETECTION",
  datasetVersionId: 920001,
  datasetId: 910001,
  deviceId: 960001,
  deviceName: "dev1",
  hyperParamsJson: {},
  progress: 68,
  currentEpoch: 34,
  totalEpochs: 50,
  queuedAt: "2026-10-10 08:00:00",
  startedAt: "2026-10-10 08:01:00",
  finishedAt: null,
  deviceReportedAt: "2026-10-10 09:00:00",
  errorMessage: null,
  createTime: "2026-10-09 20:00:00",
  ...overrides,
});

const DEPLOYMENT = (overrides = {}) => ({
  deploymentId: 970001,
  deploymentCode: "DP001",
  deviceId: 960001,
  modelVersionId: 940001,
  statusCd: "ACTIVE",
  issuedAt: "2026-10-10 07:00:00",
  activatedAt: "2026-10-10 07:05:00",
  finishedAt: null,
  errorMessage: null,
  serviceInfo: null,
  deviceName: "dev1",
  modelName: "坑槽检测",
  modelVersion: "v3",
  ...overrides,
});

test("countActiveTrainingTasks 只统计 QUEUED/SCHEDULED/RUNNING", () => {
  const tasks = [
    TASK({ id: 1, statusCd: "RUNNING" }),
    TASK({ id: 2, statusCd: "QUEUED" }),
    TASK({ id: 3, statusCd: "SCHEDULED" }),
    TASK({ id: 4, statusCd: "SUCCEEDED" }),
    TASK({ id: 5, statusCd: "FAILED" }),
    TASK({ id: 6, statusCd: "CREATED" }),
  ];
  assert.equal(lib.countActiveTrainingTasks(tasks), 3);
  assert.equal(lib.countActiveTrainingTasks([]), 0);
});

test("workbenchTaskTypeLabel 认识检测/分割，未知值原样透出", () => {
  assert.equal(lib.workbenchTaskTypeLabel("OBJECT_DETECTION"), "目标检测");
  assert.equal(lib.workbenchTaskTypeLabel("INSTANCE_SEGMENTATION"), "实例分割");
  assert.equal(lib.workbenchTaskTypeLabel("CLASSIFICATION"), "CLASSIFICATION");
  assert.equal(lib.workbenchTaskTypeLabel(null), "—");
});

test("workbenchTaskStatusLabel / workbenchTaskTone 覆盖训练状态", () => {
  assert.equal(lib.workbenchTaskStatusLabel("RUNNING"), "训练中");
  assert.equal(lib.workbenchTaskStatusLabel("COMPLETED"), "已完成");
  assert.equal(lib.workbenchTaskTone("RUNNING"), "run");
  assert.equal(lib.workbenchTaskTone("SUCCEEDED"), "ok");
  assert.equal(lib.workbenchTaskTone("FAILED"), "bad");
  assert.equal(lib.workbenchTaskTone("QUEUED"), "idle");
  assert.equal(lib.workbenchTaskTone("SOMETHING_NEW"), "idle");
});

test("workbenchPresent 把空字符串按缺失处理", () => {
  assert.equal(lib.workbenchPresent("", "未分配设备"), "未分配设备");
  assert.equal(lib.workbenchPresent("  ", "—"), "—");
  assert.equal(lib.workbenchPresent(null, "—"), "—");
  assert.equal(lib.workbenchPresent("dev1", "—"), "dev1");
});

test("buildWorkbenchActivity 对历史空字段任务给兜底文案", () => {
  const items = lib.buildWorkbenchActivity({
    datasets: null,
    trainingTasks: [TASK({
      name: "",
      taskType: null,
      baseModelName: "",
      deviceName: "",
      statusCd: "COMPLETED",
    })],
    runningDeployments: null,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "TT001");
  assert.equal(items[0].detail, "— · 未分配设备");
  assert.equal(items[0].status, "已完成");
});

test("parseWorkbenchTime 兼容 yyyy-MM-dd HH:mm:ss 与 ISO", () => {
  assert.equal(lib.parseWorkbenchTime("2026-10-10 09:30:00"), Date.parse("2026-10-10T09:30:00"));
  assert.equal(lib.parseWorkbenchTime("2026-10-10T09:30:00Z"), Date.parse("2026-10-10T09:30:00Z"));
  assert.ok(Number.isNaN(lib.parseWorkbenchTime(null)));
  assert.ok(Number.isNaN(lib.parseWorkbenchTime("not-a-date")));
});

test("buildWorkbenchActivity 合并三类来源并按时间倒序", () => {
  const items = lib.buildWorkbenchActivity({
    datasets: [DATASET()],
    trainingTasks: [TASK()],
    runningDeployments: [DEPLOYMENT()],
  });
  assert.deepEqual(items.map((item) => item.typeLabel), ["数据集", "训练任务", "在线服务"]);
  const training = items[1];
  assert.equal(training.name, "坑槽检测训练");
  assert.equal(training.detail, "yolo26n · dev1");
  assert.equal(training.status, "训练中");
  assert.equal(training.href, "/training-tasks/930001");
  const dataset = items[0];
  assert.equal(dataset.detail, "目标检测 · 120 样本");
  assert.equal(dataset.href, "/studio/data?dataset=910001");
  const deployment = items[2];
  assert.equal(deployment.name, "坑槽检测");
  assert.equal(deployment.status, "运行中");
  assert.equal(deployment.href, "/services/970001");
});

test("buildWorkbenchActivity 训练任务取最近动静时间，空来源返回空数组", () => {
  const items = lib.buildWorkbenchActivity({
    datasets: [DATASET({ createTime: "2026-10-01 08:00:00" })],
    trainingTasks: [TASK({ finishedAt: "2026-10-10 12:00:00" })],
    runningDeployments: [DEPLOYMENT({ deviceName: null })],
  });
  assert.equal(items[0].updatedAt, "2026-10-10 12:00:00");
  assert.equal(items[0].key, "training-930001");
  assert.deepEqual(
    lib.buildWorkbenchActivity({ datasets: null, trainingTasks: null, runningDeployments: null }),
    [],
  );
});

test("buildWorkbenchActivity 尊重 limit 且 ID 为数字/字符串均可", () => {
  const items = lib.buildWorkbenchActivity(
    {
      datasets: [1, 2, 3].map((n) => DATASET({ id: n, createTime: `2026-10-0${n} 08:00:00` })),
      trainingTasks: null,
      runningDeployments: null,
    },
    2,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].href, "/studio/data?dataset=3");
});
