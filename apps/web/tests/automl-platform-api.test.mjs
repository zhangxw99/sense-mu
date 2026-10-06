import assert from "node:assert/strict";
import test from "node:test";

// automl-platform-api.ts 复用 automl-data-api 的 fetchAutoml（localhost 校验 + window 计时器），补最小 window shim
globalThis.window = {
  location: { hostname: "localhost" },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  dispatchEvent: () => true,
  addEventListener: () => {},
};
const api = await import("../lib/automl-platform-api.ts");

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

test("listAutomlConstants 只携带非空筛选参数", async () => {
  const calls = installFetchStub(() => []);
  await api.listAutomlConstants();
  assert.equal(calls[0].url, "/sz-api/automl/constants");
  await api.listAutomlConstants({ constType: "TASK_TYPE", statusCd: "ENABLED" });
  assert.match(calls[1].url, /\/constants\?constType=TASK_TYPE&statusCd=ENABLED$/);
});

test("createAutomlConstant 走 POST /constants 且提交分组与编码", async () => {
  const calls = installFetchStub(() => ({ id: "1", constType: "TASK_TYPE", code: "OBJECT_DETECTION", name: "目标检测" }));
  const created = await api.createAutomlConstant({ constType: "TASK_TYPE", code: "OBJECT_DETECTION", name: "目标检测", sortOrder: 1 });
  const { url, init } = calls[0];
  assert.equal(init.method, "POST");
  assert.match(url, /\/sz-api\/automl\/constants$/);
  const body = JSON.parse(init.body);
  assert.equal(body.constType, "TASK_TYPE");
  assert.equal(body.code, "OBJECT_DETECTION");
  assert.equal(created.name, "目标检测");
});

test("updateAutomlConstant 走 PUT /constants/{id} 且不含 code/constType", async () => {
  const calls = installFetchStub(() => ({ id: "3", name: "新名称" }));
  await api.updateAutomlConstant("3", { name: "新名称", sortOrder: 2, statusCd: "DISABLED" });
  const { url, init } = calls[0];
  assert.equal(init.method, "PUT");
  assert.match(url, /\/sz-api\/automl\/constants\/3$/);
  const body = JSON.parse(init.body);
  assert.equal(body.name, "新名称");
  assert.ok(!("code" in body), "code 不可改");
  assert.ok(!("constType" in body), "constType 不可改");
});

test("deleteAutomlConstant 走 DELETE /constants/{id}", async () => {
  const calls = installFetchStub();
  await api.deleteAutomlConstant("9");
  assert.equal(calls[0].init.method, "DELETE");
  assert.match(calls[0].url, /\/sz-api\/automl\/constants\/9$/);
});

test("listAutomlPlatforms 走 /training-platforms 且拼 keyword/statusCd", async () => {
  const calls = installFetchStub(() => []);
  await api.listAutomlPlatforms({ keyword: " py ", statusCd: "ENABLED" });
  assert.match(calls[0].url, /\/sz-api\/automl\/training-platforms\?keyword=py&statusCd=ENABLED$/);
  await api.listAutomlPlatformOptions("OBJECT_DETECTION");
  assert.match(calls[1].url, /\/sz-api\/automl\/training-platforms\/options\?taskType=OBJECT_DETECTION$/);
  await api.listAutomlPlatformOptions();
  assert.match(calls[2].url, /\/sz-api\/automl\/training-platforms\/options$/);
});

test("平台状态更新与删除走对应端点", async () => {
  const calls = installFetchStub();
  await api.setAutomlPlatformStatus("12", "DISABLED");
  assert.equal(calls[0].init.method, "PUT");
  assert.match(calls[0].url, /\/training-platforms\/12\/status$/);
  assert.equal(JSON.parse(calls[0].init.body).statusCd, "DISABLED");
  await api.deleteAutomlPlatform("12");
  assert.equal(calls[1].init.method, "DELETE");
  assert.match(calls[1].url, /\/training-platforms\/12$/);
});

test("createAutomlPlatform 提交 platformCode，update 不提交", async () => {
  const calls = installFetchStub(() => ({ id: "20", platformCode: "PYTORCH", name: "PyTorch" }));
  await api.createAutomlPlatform({ platformCode: "PYTORCH", name: "PyTorch", taskTypes: ["OBJECT_DETECTION"] });
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /\/sz-api\/automl\/training-platforms$/);
  assert.equal(JSON.parse(calls[0].init.body).platformCode, "PYTORCH");
  await api.updateAutomlPlatform("20", { name: "PyTorch 更名" });
  assert.equal(calls[1].init.method, "PUT");
  assert.match(calls[1].url, /\/training-platforms\/20$/);
  assert.ok(!("platformCode" in JSON.parse(calls[1].init.body)), "更新体不带 platformCode");
});

test("基础模型走平台嵌套与 base-models 前缀路径", async () => {
  const calls = installFetchStub(() => ({ id: "30", modelCode: "YOLOV8N", name: "YOLOv8n" }));
  await api.listAutomlPlatformBaseModels("20", "SEGMENTATION");
  assert.match(calls[0].url, /\/training-platforms\/20\/base-models\?taskType=SEGMENTATION$/);
  await api.createAutomlPlatformBaseModel("20", { modelCode: "YOLOV8N", name: "YOLOv8n" });
  assert.equal(calls[1].init.method, "POST");
  assert.match(calls[1].url, /\/training-platforms\/20\/base-models$/);
  await api.updateAutomlBaseModel("30", { name: "YOLOv8n 更名" });
  assert.equal(calls[2].init.method, "PUT");
  assert.match(calls[2].url, /\/training-platforms\/base-models\/30$/);
  assert.ok(!("modelCode" in JSON.parse(calls[2].init.body)), "更新体不带 modelCode");
  await api.setAutomlBaseModelStatus("30", "ENABLED");
  assert.match(calls[3].url, /\/training-platforms\/base-models\/30\/status$/);
  await api.deleteAutomlBaseModel("30");
  assert.equal(calls[4].init.method, "DELETE");
  assert.match(calls[4].url, /\/training-platforms\/base-models\/30$/);
});
