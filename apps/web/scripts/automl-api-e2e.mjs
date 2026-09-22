import { createHash, randomBytes } from "node:crypto";

const BASE_URL = process.env.AUTOML_E2E_BASE_URL ?? "http://127.0.0.1:9992/api/automl";
const TOKEN = process.env.AUTOML_E2E_TOKEN;
const stamp = Date.now();
const results = [];

function pngBytes(size, seed) {
  const content = Buffer.alloc(size);
  for (let index = 0; index < content.length; index += 1) {
    content[index] = (seed + stamp + index * 31) % 251;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, seed & 0xff]), content]);
}

function formDataFile(field, fileName, bytes) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type: "image/png" }), fileName);
  return form;
}

function detail(value, keys) {
  if (value == null) return "无 data";
  return keys.map((key) => `${key}=${value[key] ?? "-"}`).join(", ");
}

function record(step, endpoint, pass, message = "") {
  results.push({ step, endpoint, pass, message });
  console.log(`${pass ? "PASS" : "FAIL"} ${step} ${endpoint}${message ? ` · ${message}` : ""}`);
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (TOKEN) headers.set("Authorization", TOKEN);
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return {
    ok: response.ok && payload?.code === "0000",
    status: response.status,
    payload,
    body: JSON.stringify(payload),
  };
}

async function query(name, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, String(value));
  }
  return request(`${name}?${search.toString()}`);
}

const search = await query("/algorithms/search", { page: 1, limit: 10 });
const searchRows = search.payload?.data?.rows ?? [];
record("1.1", "GET /algorithms/search", search.ok && searchRows.length > 0, `total=${search.payload?.data?.total}`);

const algorithmId = searchRows[0]?.id;
const algorithmDetail = algorithmId ? await request(`/algorithms/${algorithmId}`) : { ok: false, body: "搜索结果为空" };
record("1.2", "GET /algorithms/{id}", algorithmDetail.ok, `id=${algorithmId}`);

const directFile = pngBytes(16 * 1024, 1);
const directUpload = await request("/files/upload", { method: "POST", body: formDataFile("file", `direct-${stamp}.png`, directFile) });
const directFileId = directUpload.payload?.data?.fileId;
record("2.1", "POST /files/upload", directUpload.ok && directFileId != null, detail(directUpload.payload?.data, ["fileId", "objectKey"]));

const batchBytes = [pngBytes(12 * 1024, 2), pngBytes(13 * 1024, 3), pngBytes(14 * 1024, 4)];
const batchForm = new FormData();
batchBytes.forEach((bytes, index) => {
  batchForm.append("files", new Blob([bytes], { type: "image/png" }), `batch-${index}-${stamp}.png`);
});
const batchUpload = await request("/files/batch-upload", { method: "POST", body: batchForm });
const batchFiles = batchUpload.payload?.data ?? [];
record("2.2", "POST /files/batch-upload", batchUpload.ok && batchFiles.length === 3, `count=${batchFiles.length}`);

const chunkSize = 5 * 1024 * 1024;
const largeFile = pngBytes(chunkSize * 2 - 5, 5);
const largeMd5 = createHash("md5").update(largeFile).digest("hex");
const init = await request("/files/init", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ fileName: `chunked-${stamp}.png`, fileSize: largeFile.length, fileMd5: largeMd5, chunkSize }),
});
const uploadId = init.payload?.data?.uploadId;
record("2.3", "POST /files/init", init.ok && Boolean(uploadId), `uploadId=${uploadId}`);

let chunksUploaded = false;
let chunkErrors = [];
if (uploadId) {
  let chunkPass = true;
  for (let chunkNo = 1; chunkNo <= 2; chunkNo += 1) {
    const start = (chunkNo - 1) * chunkSize;
    const form = formDataFile("chunk", `chunk-${chunkNo}.bin`, largeFile.subarray(start, start + chunkSize));
    form.append("chunkNo", String(chunkNo));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const uploaded = await request(`/files/${uploadId}/chunks`, { method: "POST", body: form });
    if (!uploaded.ok) chunkErrors.push(`chunk ${chunkNo}: ${uploaded.body}`);
    chunkPass = chunkPass && uploaded.ok && uploaded.payload?.data?.uploaded === true;
  }
  chunksUploaded = chunkPass;
}
record("2.4", "POST /files/{uploadId}/chunks", chunksUploaded, chunkErrors.join(" | ") || "chunk 1/2 + 2/2");

const status = uploadId ? await request(`/files/${uploadId}`) : { ok: false, body: "无 uploadId" };
record("2.6", "GET /files/{uploadId}", status.ok && (status.payload?.data?.uploadedChunks ?? []).length === 2, detail(status.payload?.data, ["status", "receivedBytes"]));

const complete = uploadId ? await request(`/files/${uploadId}/complete`, { method: "POST" }) : { ok: false, body: "无 uploadId" };
const completedFileId = complete.payload?.data?.fileId;
record("2.5", "POST /files/{uploadId}/complete", complete.ok && completedFileId != null, complete.ok ? `fileId=${completedFileId}` : complete.body);

const objectKeys = [directUpload.payload?.data?.objectKey, ...batchFiles.map((file) => file.objectKey), complete.payload?.data?.objectKey].filter(Boolean);
const fileUrls = await request("/files/batch-urls", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ objectKeys, ttlSeconds: 3600 }),
});
record("2.7", "POST /files/batch-urls", fileUrls.ok && fileUrls.payload?.data?.length === objectKeys.length, `count=${fileUrls.payload?.data?.length}`);

const dataFileIds = [directFileId, ...batchFiles.map((file) => file.fileId), completedFileId].filter(Boolean).map(String);
const createDataset = await request("/datasets/from-files", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    dataFileIds,
    name: `E2E-${stamp}`,
    description: "SenseMu API E2E",
    taskType: "OBJECT_DETECTION",
    classNames: ["target"],
  }),
});
const datasetId = createDataset.payload?.data?.id;
const versionId = createDataset.payload?.data?.initialDatasetVersionId;
record("3.1", "POST /datasets/from-files", createDataset.ok && datasetId != null && versionId != null, `datasetId=${datasetId}, versionId=${versionId}`);

const datasetList = await query("/datasets", { page: 1, limit: 10, name: `E2E-${stamp}` });
record("3.2", "GET /datasets", datasetList.ok && (datasetList.payload?.data?.rows ?? []).length === 1, `total=${datasetList.payload?.data?.total}`);

const items = await query(`/datasets/${datasetId}/versions/${versionId}/items`, { page: 1, limit: 10 });
const itemRows = items.payload?.data?.rows ?? [];
record("3.3", "GET .../items", items.ok && itemRows.length === dataFileIds.length, `total=${items.payload?.data?.total}`);

const splitTarget = itemRows[0]?.itemId;
const split = datasetId && versionId && splitTarget ? await request(`/datasets/${datasetId}/versions/${versionId}/items/splits`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{ itemId: splitTarget, splitType: "val" }] }),
}) : { ok: false, body: "缺少样本 ID" };
record("3.3b", "PUT .../items/splits", split.ok && Array.isArray(split.payload?.data), JSON.stringify(split.payload?.data ?? split.body));

const materials = datasetId ? await request(`/datasets/${datasetId}/materials`) : { ok: false, body: "缺 datasetId" };
record("3.4", "GET .../materials", materials.ok && materials.payload?.data?.length === dataFileIds.length, `count=${materials.payload?.data?.length}`);

const models = datasetId ? await request(`/datasets/${datasetId}/models`) : { ok: false, body: "缺 datasetId" };
record("3.5", "GET .../models", models.ok && Array.isArray(models.payload?.data), `count=${models.payload?.data?.length}`);

const versionDetails = datasetId ? await request(`/datasets/${datasetId}/version-details`) : { ok: false, body: "缺 datasetId" };
record("3.6", "GET .../version-details", versionDetails.ok && Array.isArray(versionDetails.payload?.data?.versions), `versions=${versionDetails.payload?.data?.versions?.length}`);

const classCode = `e2e_${stamp}`;
const createClass = datasetId ? await request(`/datasets/${datasetId}/classes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ datasetId, classCode, className: "E2E目标", color: "#1677ff", sortNo: 1 }),
}) : { ok: false, body: "缺 datasetId" };
record("3.7a", "POST .../classes", createClass.ok, createClass.body);

const classList = datasetId ? await request(`/datasets/${datasetId}/classes`) : { ok: false, body: "缺 datasetId" };
const createdClass = (classList.payload?.data ?? []).find((item) => item.classCode === classCode);
record("3.7b", "GET .../classes", classList.ok && Boolean(createdClass), `count=${classList.payload?.data?.length}`);

const updateClass = datasetId && createdClass ? await request(`/datasets/${datasetId}/classes/${createdClass.id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: createdClass.id,
    datasetId,
    classCode,
    classIndex: createdClass.classIndex,
    className: "E2E目标B",
    color: "#16a34a",
    sortNo: 1,
    statusCd: "ENABLED",
  }),
}) : { ok: false, body: "缺 classId" };
record("3.7c", "PUT .../classes/{id}", updateClass.ok, updateClass.body);

const createTask = datasetId && versionId ? await request(`/datasets/${datasetId}/versions/${versionId}/annotation-tasks/standard`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: `E2E任务-${stamp}`, method: "MANUAL" }),
}) : { ok: false, body: "缺 datasetId/versionId" };
const taskId = createTask.payload?.data?.id;
record("4.2", "POST .../annotation-tasks/standard", createTask.ok && taskId != null, `taskId=${taskId}`);

const taskList = datasetId && versionId ? await request(`/datasets/${datasetId}/versions/${versionId}/annotation-tasks`) : { ok: false, body: "缺 datasetId/versionId" };
record("4.1", "GET .../annotation-tasks", taskList.ok && taskList.payload?.data?.length === 1, `count=${taskList.payload?.data?.length}`);

const itemId = itemRows[0]?.itemId;
const saveAnnotations = datasetId && versionId && itemId && taskId ? await request(`/datasets/${datasetId}/versions/${versionId}/items/${itemId}/annotations`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    annotationTaskId: taskId,
    annotations: [{ labelName: "E2E目标B", annotationJson: { type: "bbox", x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, sourceCd: "MANUAL" }],
  }),
}) : { ok: false, body: "缺任务或样本 ID" };
record("5.2", "PUT .../annotations", saveAnnotations.ok && saveAnnotations.payload?.data?.length === 1, saveAnnotations.ok ? `count=${saveAnnotations.payload?.data?.length}` : saveAnnotations.body);

const annotations = datasetId && versionId && itemId ? await query(`/datasets/${datasetId}/versions/${versionId}/items/${itemId}/annotations`, { annotationTaskId: taskId }) : { ok: false, body: "缺任务或样本 ID" };
record("5.1", "GET .../annotations", annotations.ok && annotations.payload?.data?.length === 1, `count=${annotations.payload?.data?.length}`);

await new Promise((resolve) => setTimeout(resolve, 1200));
const unusedClassResponse = datasetId ? await request(`/datasets/${datasetId}/classes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ datasetId, classCode: `unused_${stamp}`, className: "E2E未引用", sortNo: 2 }),
}) : { ok: false, body: "缺 datasetId" };
const unusedClassList = unusedClassResponse.ok ? await request(`/datasets/${datasetId}/classes`) : null;
const unusedClass = (unusedClassList?.payload?.data ?? []).find((item) => item.classCode === `unused_${stamp}`);
const deleteClass = datasetId && unusedClass ? await request(`/datasets/${datasetId}/classes/${unusedClass.id}`, { method: "DELETE" }) : { ok: false, body: "未创建可删除类别" };
record("3.7d", "DELETE .../classes/{id}", deleteClass.ok, deleteClass.ok ? "未引用类别删除成功" : `${deleteClass.body} · create=${unusedClassResponse.body} · list=${unusedClassList?.body}`);

const failed = results.filter((result) => !result.pass);
console.log(`\n===== 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length > 0) {
  console.log("失败项:", failed.map((result) => result.step).join(", "));
  process.exit(1);
}
