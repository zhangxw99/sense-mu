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
