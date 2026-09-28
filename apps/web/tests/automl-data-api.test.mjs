import assert from "node:assert/strict";
import test from "node:test";

// automl-data-api.ts 零依赖、仅用全局 fetch，可直接以 Node 原生类型剥离导入
// fetchAutoml 依赖 window.setTimeout 与 window.location.hostname（localhost 校验），补最小 window shim
globalThis.window = {
  location: { hostname: "localhost" },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};
const api = await import("../lib/automl-data-api.ts");

/** 捕获请求的 stub fetch，返回统一成功结构 */
function installFetchStub() {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ code: "0000", message: "SUCCESS", data: {}, param: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

test("createAutomlDatasetClass 在 body 中注入后端必填的 datasetId", async () => {
  const calls = installFetchStub();
  await api.createAutomlDatasetClass("910011", {
    classCode: "helmet",
    className: "安全帽",
    color: "#1677ff",
  });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.match(url, /\/sz-api\/automl\/datasets\/910011\/classes$/);
  const body = JSON.parse(init.body);
  assert.equal(body.classCode, "helmet");
  assert.equal(body.datasetId, "910011", "后端 CreateDTO 的 datasetId 为 @NotNull，body 必须携带");
});

test("updateAutomlDatasetClass 在 body 中注入后端必填的 id", async () => {
  const calls = installFetchStub();
  await api.updateAutomlDatasetClass("910011", "22", {
    datasetId: "910011",
    classCode: "helmet",
    classIndex: 0,
    className: "安全帽-改",
  });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.match(url, /\/sz-api\/automl\/datasets\/910011\/classes\/22$/);
  const body = JSON.parse(init.body);
  assert.equal(body.id, "22", "后端 UpdateDTO 的 id 为 @NotNull，body 必须携带");
  assert.equal(body.datasetId, "910011");
  assert.equal(body.className, "安全帽-改");
});

test("deleteAutomlDatasetClass 走 DELETE 且不携带 body", async () => {
  const calls = installFetchStub();
  await api.deleteAutomlDatasetClass("910011", "22");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.body, undefined);
});

test("deleteAutomlDataset 走 DELETE 数据集路径", async () => {
  const calls = installFetchStub();
  await api.deleteAutomlDataset("910001");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sz-api\/automl\/datasets\/910001$/);
  assert.equal(calls[0].init.method, "DELETE");
});

test("createAutomlDatasetVersionSnapshot 缺省 sourceVersionId 时提交空对象", async () => {
  const calls = installFetchStub();
  await api.createAutomlDatasetVersionSnapshot("910001");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sz-api\/automl\/datasets\/910001\/versions$/);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {});
});

test("createAutomlDatasetVersionSnapshot 携带 sourceVersionId", async () => {
  const calls = installFetchStub();
  await api.createAutomlDatasetVersionSnapshot("910001", "920001");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.sourceVersionId, "920001");
});

test("releaseAutomlDatasetVersion 走 PUT release 路径且无 body", async () => {
  const calls = installFetchStub();
  await api.releaseAutomlDatasetVersion("910001", "920002");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sz-api\/automl\/datasets\/910001\/versions\/920002\/release$/);
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.body, undefined);
});

test("setAutomlDataApiToken 派发令牌变更事件并广播空令牌", () => {
  const originalWindow = globalThis.window;
  const eventTarget = new EventTarget();
  globalThis.window = Object.assign(Object.create(eventTarget), {
    location: originalWindow.location,
    setTimeout: originalWindow.setTimeout,
    clearTimeout: originalWindow.clearTimeout,
  });
  const fired = [];
  const listener = () => fired.push(true);
  globalThis.window.addEventListener(api.AUTOML_TOKEN_CHANGED_EVENT, listener);
  try {
    api.setAutomlDataApiToken("token-a");
    api.setAutomlDataApiToken(null);
    assert.equal(fired.length, 2, "每次注入（含清空）都应派发事件");
  } finally {
    globalThis.window.removeEventListener(api.AUTOML_TOKEN_CHANGED_EVENT, listener);
    globalThis.window = originalWindow;
  }
});

test("appendAutomlDatasetFiles 提交 dataFileIds 到数据集 files 端点", async () => {
  const calls = installFetchStub();
  await api.appendAutomlDatasetFiles("910022", ["2101", "2102"]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sz-api\/automl\/datasets\/910022\/files$/);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { dataFileIds: ["2101", "2102"] });
});

test("createAutomlEmptyDataset 提交到 POST /datasets 且不带文件", async () => {
  const calls = installFetchStub();
  await api.createAutomlEmptyDataset({ name: "空数据集", taskType: "OBJECT_DETECTION", classNames: ["a"] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sz-api\/automl\/datasets$/);
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, "空数据集");
  assert.equal(body.dataFileIds, undefined, "空数据集创建不携带文件字段");
});
