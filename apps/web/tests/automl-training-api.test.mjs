import assert from "node:assert/strict";
import test from "node:test";

// automl-training-api.ts 复用 automl-data-api 的 fetchAutoml（localhost 校验 + window 计时器），补最小 window shim
globalThis.window = {
  location: { hostname: "localhost" },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  dispatchEvent: () => true,
  addEventListener: () => {},
};
const api = await import("../lib/automl-training-api.ts");

const ENVELOPE = { code: "0000", message: "SUCCESS", data: {}, param: {} };

function installFetchStub(handler) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const data = handler?.(calls[calls.length - 1]) ?? {};
    return new Response(JSON.stringify({ ...ENVELOPE, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

test("createAutomlTrainingTask 提交数据集版本与基础模型", async () => {
  const calls = installFetchStub(() => ({ id: "40", taskCode: "T0001", statusCd: "CREATED" }));
  const created = await api.createAutomlTrainingTask({
    name: "路损检测训练",
    datasetVersionId: "920001",
    baseModelId: "30",
    hyperParamsJson: { epochs: 50 },
  });
  const { url, init } = calls[0];
  assert.equal(init.method, "POST");
  assert.match(url, /\/sz-api\/automl\/training-tasks$/);
  const body = JSON.parse(init.body);
  assert.equal(body.datasetVersionId, "920001");
  assert.equal(body.baseModelId, "30");
  assert.deepEqual(body.hyperParamsJson, { epochs: 50 });
  assert.equal(created.statusCd, "CREATED");
});

test("listAutomlTrainingTasks 默认分页且只携带非空筛选", async () => {
  const calls = installFetchStub(() => ({ rows: [], total: 0, current: 1, limit: 10, totalPage: 0 }));
  await api.listAutomlTrainingTasks();
  assert.match(calls[0].url, /\/sz-api\/automl\/training-tasks\?page=1&limit=10$/);
  await api.listAutomlTrainingTasks({ page: 2, limit: 20, keyword: " yol ", statusCd: "RUNNING", deviceId: "960001", datasetVersionId: "920001" });
  const { url } = calls[1];
  assert.match(url, /page=2/);
  assert.match(url, /keyword=yol/);
  assert.match(url, /statusCd=RUNNING/);
  assert.match(url, /deviceId=960001/);
  assert.match(url, /datasetVersionId=920001/);
});

test("getAutomlTaskReadiness 以 datasetVersionId 查询", async () => {
  const calls = installFetchStub(() => ({ datasetVersionId: "920001", ready: true, checks: [] }));
  const readiness = await api.getAutomlTaskReadiness("920001");
  assert.match(calls[0].url, /\/training-tasks\/readiness\?datasetVersionId=920001$/);
  assert.equal(readiness.ready, true);
});

test("dispatch 走 PUT dispatch 并提交 deviceId，cancel 走 PUT cancel", async () => {
  const calls = installFetchStub(() => ({ id: "40", statusCd: "QUEUED" }));
  const dispatched = await api.dispatchAutomlTrainingTask("40", "960001");
  assert.equal(calls[0].init.method, "PUT");
  assert.match(calls[0].url, /\/training-tasks\/40\/dispatch$/);
  assert.equal(JSON.parse(calls[0].init.body).deviceId, "960001");
  assert.equal(dispatched.statusCd, "QUEUED");
  await api.cancelAutomlTrainingTask("40");
  assert.equal(calls[1].init.method, "PUT");
  assert.match(calls[1].url, /\/training-tasks\/40\/cancel$/);
});

test("metrics 与 events 走任务嵌套路径", async () => {
  const calls = installFetchStub(() => []);
  await api.listAutomlTrainingTaskMetrics("40");
  assert.match(calls[0].url, /\/training-tasks\/40\/metrics$/);
  await api.listAutomlTrainingTaskMetrics("40", { metricName: "loss", splitType: "TRAIN" });
  assert.match(calls[1].url, /\/training-tasks\/40\/metrics\?metricName=loss&splitType=TRAIN$/);
  await api.listAutomlTrainingTaskEvents("40");
  assert.ok(!calls[2].init.method || calls[2].init.method === "GET", "events 走 GET");
  assert.match(calls[2].url, /\/training-tasks\/40\/events$/);
});

test("isTrainingTaskActive 进行中为 true、终态为 false", () => {
  for (const status of ["QUEUED", "SCHEDULED", "RUNNING"]) {
    assert.equal(api.isTrainingTaskActive(status), true, status);
  }
  for (const status of ["CREATED", "SUCCEEDED", "FAILED", "CANCELLED", "CANCELED"]) {
    assert.equal(api.isTrainingTaskActive(status), false, status);
  }
});
