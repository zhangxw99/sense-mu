import assert from "node:assert/strict";
import test from "node:test";

// automl-device-api.ts 复用 automl-data-api 的 fetchAutoml（localhost 校验 + window 计时器），补最小 window shim
globalThis.window = {
  location: { hostname: "localhost" },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  dispatchEvent: () => true,
  addEventListener: () => {},
};
const api = await import("../lib/automl-device-api.ts");

const DEVICE_ENVELOPE = {
  code: "0000",
  message: "SUCCESS",
  data: {},
  param: {},
};

function installFetchStub(handler) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const data = handler?.(calls[calls.length - 1]) ?? {};
    return new Response(JSON.stringify({ ...DEVICE_ENVELOPE, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

test("listAutomlDevices 拼 query 且默认分页参数", async () => {
  const calls = installFetchStub(() => ({ rows: [], total: 0, current: 1, limit: 10, totalPage: 0 }));
  await api.listAutomlDevices();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sz-api\/automl\/devices\?page=1&limit=10$/);
});

test("listAutomlDevices 只携带非空筛选参数", async () => {
  const calls = installFetchStub();
  await api.listAutomlDevices({ page: 2, limit: 20, keyword: " mac ", statusCd: "ONLINE", deviceType: "MAC" });
  const { url } = calls[0];
  assert.match(url, /page=2/);
  assert.match(url, /limit=20/);
  assert.match(url, /keyword=%20mac%20|keyword=\+mac\+|keyword=mac/);
  assert.match(url, /statusCd=ONLINE/);
  assert.match(url, /deviceType=MAC/);
  assert.ok(!url.includes("accessMode="), "未传的筛选不应出现在 query 里");
});

test("setAutomlDeviceStatus 走 PUT statusCd 并提交 statusCd body", async () => {
  const calls = installFetchStub();
  await api.setAutomlDeviceStatus("960001", "DISABLED");
  const { url, init } = calls[0];
  assert.equal(init.method, "PUT");
  assert.match(url, /\/sz-api\/automl\/devices\/960001\/statusCd$/);
  assert.equal(JSON.parse(init.body).statusCd, "DISABLED");
});

test("deleteAutomlDevice 走 DELETE 设备路径", async () => {
  const calls = installFetchStub();
  await api.deleteAutomlDevice("960001");
  assert.equal(calls[0].init.method, "DELETE");
  assert.match(calls[0].url, /\/sz-api\/automl\/devices\/960001$/);
});

test("createAutomlDeviceDeployment 提交 modelVersionId 到设备 deployments 端点", async () => {
  const calls = installFetchStub(() => ({
    deploymentId: "880001",
    deploymentCode: "DP0001",
    deviceId: "960001",
    modelVersionId: "770002",
    statusCd: "ISSUED",
    issuedAt: null,
    activatedAt: null,
    finishedAt: null,
    errorMessage: null,
  }));
  const created = await api.createAutomlDeviceDeployment("960001", "770002");
  const { url, init } = calls[0];
  assert.equal(init.method, "POST");
  assert.match(url, /\/sz-api\/automl\/devices\/960001\/deployments$/);
  assert.equal(JSON.parse(init.body).modelVersionId, "770002");
  assert.equal(created.statusCd, "ISSUED");
});

test("getAutomlDeviceDeployment 走 deployments 前缀详情路径", async () => {
  const calls = installFetchStub(() => ({ deploymentId: "880001", statusCd: "ACTIVE" }));
  const detail = await api.getAutomlDeviceDeployment("880001");
  assert.match(calls[0].url, /\/sz-api\/automl\/devices\/deployments\/880001$/);
  assert.equal(detail.statusCd, "ACTIVE");
});

test("isDeploymentInProgress 终态为 false、过程态为 true", () => {
  for (const status of ["CREATED", "ISSUED", "DOWNLOADING", "VALIDATING", "HEALTH_CHECKING"]) {
    assert.equal(api.isDeploymentInProgress(status), true, status);
  }
  for (const status of ["ACTIVE", "FAILED", "ROLLED_BACK", "CANCELLED"]) {
    assert.equal(api.isDeploymentInProgress(status), false, status);
  }
});

test("resolveRunningDeployment 只认运行中口径（与每设备最新激活列表取交集）", () => {
  // 场景复刻：任务 12 的焊缝模型部署 #15 仍是 ACTIVE，但设备 2 已切换到 #16（wildlife）
  const superseded = {
    deploymentId: "15",
    deviceId: "2",
    statusCd: "ACTIVE",
    issuedAt: "2026-10-08T23:07:33",
    activatedAt: "2026-10-08 23:40:58",
  };
  const replacedBy = { deploymentId: "16", deviceId: "2", statusCd: "ACTIVE" };

  // 运行中列表（后端已按每设备最新一次激活去重）里没有 #15 → 不算已部署
  assert.equal(api.resolveRunningDeployment([superseded], [replacedBy]), null);
  assert.equal(api.resolveRunningDeployment([superseded], []), null);
  assert.equal(api.resolveRunningDeployment([superseded], null), null);

  // 运行中列表里仍是它 → 已部署（取任务记录行，保留 deviceName/apiAlias 等富化字段）
  const running = { ...superseded, deviceName: "vivideMacBook-Pro-2.local", apiAlias: "hhanfen-12" };
  assert.equal(api.resolveRunningDeployment([superseded], [running]), running);

  // 非 ACTIVE 记录永不命中
  const failed = { deploymentId: "11", statusCd: "FAILED" };
  assert.equal(api.resolveRunningDeployment([failed], [failed]), null);
});

test("deviceTrainingCapability 三态：支持/明确不支持/未上报", () => {
  assert.equal(api.deviceTrainingCapability({ capabilityJson: { supportedTrainingTypes: ["OBJECT_DETECTION"] } }), true);
  assert.equal(api.deviceTrainingCapability({ capabilityJson: { supportedTrainingTypes: [] } }), false);
  // 旧版端侧：无 capabilityJson 或缺 supportedTrainingTypes 键 → 未知
  assert.equal(api.deviceTrainingCapability({ capabilityJson: {} }), null);
  assert.equal(api.deviceTrainingCapability({ capabilityJson: null }), null);
  assert.equal(api.deviceTrainingCapability({}), null);
});

test("trainingCapableDevices 排除明确不支持训练的设备，能力未知保留", () => {
  const capable = { deviceId: "1", capabilityJson: { supportedTrainingTypes: ["OBJECT_DETECTION"] } };
  const incapable = { deviceId: "2", capabilityJson: { supportedTrainingTypes: [] } };
  const unknown = { deviceId: "3", capabilityJson: null };
  const filtered = api.trainingCapableDevices([capable, incapable, unknown]);
  assert.deepEqual(filtered.map((device) => device.deviceId), ["1", "3"]);
});
