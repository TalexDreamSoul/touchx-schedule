import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const transpileModuleToTemp = (sourcePath, fileName, replacements = []) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [needle, replacement] of replacements) {
    source = source.split(needle).join(replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-import-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadImportHandler = async () => {
  const sharedModule = `
    export const IMPORT_CANDIDATE_STATUSES = ['pending', 'accepted', 'rejected', 'corrected'];
  `;
  const sharedHref = `data:text/javascript,${encodeURIComponent(sharedModule)}`;
  const importCoreModule = `
    export const normalizeImportCandidateStatus = (value) => ['pending', 'accepted', 'rejected', 'corrected'].includes(String(value || '')) ? String(value) : 'pending';
    export const summarizeImportCandidates = (items = []) => ({ total: items.length, pending: items.filter((item) => item.status === 'pending').length });
  `;
  const h3Module = `
    export const readMultipartFormData = async (event) => event.multipartFormData || [];
  `;
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const previewPath = transpileModuleToTemp(
    join(import.meta.dirname, "schedule-import-preview.ts"),
    "schedule-import-preview.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
    ],
  );
  const scheduleImportService = `
    export const createScheduleImportJob = async (_event, userId, options = {}) => ({ jobId: 'legacy-created', createdByUserId: userId, totalFiles: 1, mode: options.mode || 'commit' });
    export const listRecentScheduleImportJobIds = async () => ['legacy-1', 'legacy-2'];
    export const listRecentScheduleImportJobs = async (_event, options = {}) => [{ jobId: 'legacy-1', createdByUserId: options.actorUserId, results: [{ itemId: 'row-1', previewEntries: [{ courseName: '旧导入课程', day: 1, startSection: 1, endSection: 2 }] }] }];
    export const getScheduleImportJobStatus = async (_event, jobId) => {
      if (jobId === 'missing') return null;
      return { jobId, createdByUserId: jobId === 'foreign' ? 'user-3' : 'user-1', results: [{ itemId: 'row-1', previewEntries: [{ courseName: '旧导入课程', day: 1, startSection: 1, endSection: 2 }] }] };
    };
    export const confirmScheduleImportJob = async (_event, jobId, userId, previewEntries = [], options = {}) => {
      if (jobId === 'bad-confirm') {
        const error = new Error('确认失败');
        error.payload = { code: 'SCHEDULE_IMPORT_CONFIRM_INVALID', message: '确认失败', details: { previewCount: previewEntries.length } };
        throw error;
      }
      return { jobId, userId, scheduleId: 'schedule-1', versionNo: 2, entryCount: previewEntries.length, originalPayload: options.originalPayload || null };
    };
    export const toScheduleImportErrorPayload = (error) => error.payload || { code: 'SCHEDULE_IMPORT_CONFIRM_FAILED', message: error.message || '确认导入失败' };
  `;
  const parserModule = `
    export const parseSchedulePdf = () => ({ name: 'Alice', studentNo: '2300000001', courses: [{ name: 'PDF课程', day: 1, startSection: 1, endSection: 2 }] });
  `;
  const authServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/auth/auth-service.ts"),
    "auth-service.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const candidateServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/import/import-candidate-service.ts"),
    "import-candidate-service.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["from \"@touchx/import-core\";", `from ${JSON.stringify(`data:text/javascript,${encodeURIComponent(importCoreModule)}`)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/schedule-import-preview\"", JSON.stringify(pathToFileURL(previewPath).href)],
    ],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/import/import-handler.ts"),
    "import-handler.mjs",
    [
      ["from \"h3\";", `from ${JSON.stringify(`data:text/javascript,${encodeURIComponent(h3Module)}`)};`],
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/schedule-import-preview\"", JSON.stringify(pathToFileURL(previewPath).href)],
      ["\"../../services/schedule-import-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(scheduleImportService)}`)],
      ["\"../../services/schedule-pdf-parser\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(parserModule)}`)],
      ["\"./import-candidate-service\"", JSON.stringify(pathToFileURL(candidateServicePath).href)],
      ["\"../auth/auth-service\"", JSON.stringify(pathToFileURL(authServicePath).href)],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-05-18T00:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2300000001",
  studentId: "student-1",
  accountName: "alice@example.test",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "测试一班",
  classIds: [],
  avatarUrl: "",
  wallpaperUrl: "",
  adminRole: "operator",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createStore = () => ({
  users: [createUser(), createUser({ userId: "user-2", studentNo: "2300000002", adminRole: "none" })],
  schedules: [
    {
      id: "schedule-1",
      classId: "class-1",
      title: "默认日程源",
      description: "",
      publishedVersionNo: 1,
      createdByUserId: "user-1",
      createdAt: now,
      updatedAt: now,
    },
  ],
  scheduleVersions: [
    {
      id: "version-1",
      scheduleId: "schedule-1",
      versionNo: 1,
      status: "published",
      entries: [{ id: "entry-1", day: 1, startSection: 1, endSection: 2, weekExpr: "1-25", parity: "all", courseName: "旧课", classroom: "", teacher: "" }],
      createdByUserId: "user-1",
      createdAt: now,
    },
  ],
  importJobs: [],
  importCandidateEvents: [],
  userScheduleEvents: [],
  auditLogs: [],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const context = {
    event: overrides.event || {},
    method: overrides.method || "GET",
    path: overrides.path || "admin/import-candidate-jobs",
    query: overrides.query || {},
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message, details) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, details });
      throw error;
    },
    requireUser: () => ({ user, session: { role: "user", userId: user.userId } }),
    requireAdmin: () => {
      if (overrides.adminDenied) {
        const error = new Error("admin denied");
        Object.assign(error, { statusCode: 401, code: "ADMIN_AUTH_INVALID" });
        throw error;
      }
      return { user, session: { role: "admin", userId: user.userId } };
    },
    resolveSessionWithUser: () => overrides.resolvedSession ?? ({ user, session: { role: user.adminRole === "none" ? "user" : "admin", userId: user.userId } }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => store.auditLogs.push({ action, actorUserId, payload }),
  };
  return { context, store, user, handleImportApi: handler.handleImportApi };
};

test("creates manual import candidate jobs and lists candidates", async () => {
  const handler = await loadImportHandler();
  const { context, store, handleImportApi } = createContext(handler, {
    method: "POST",
    path: "admin/import-candidate-jobs",
    body: { rawText: "manual", title: "线下讲座", location: "A101", weekday: 2, startSection: 3 },
  });

  const created = await handleImportApi(context);

  assert.equal(created.data.item.type, "manual");
  assert.equal(store.importCandidateEvents[0].title, "线下讲座");
  assert.equal(store.auditLogs[0].action, "import_candidate_job_create");

  context.method = "GET";
  context.path = `admin/import-candidate-jobs/${created.data.item.id}/candidates`;
  const listed = await handleImportApi(context);
  assert.equal(listed.data.total, 1);
});

test("commits import candidates to calendar source and personal events", async () => {
  const handler = await loadImportHandler();
  const { context, store, handleImportApi } = createContext(handler, {
    method: "POST",
    path: "admin/import-candidate-jobs",
    body: { title: "导入课程", weekday: 1, startSection: 1, endSection: 2 },
  });
  await handleImportApi(context);
  const candidateId = store.importCandidateEvents[0].id;

  context.path = `admin/import-candidates/${candidateId}/commit-calendar`;
  context.readJsonBody = async () => ({ sourceId: "schedule:schedule-1", publish: true });
  const calendarResult = await handleImportApi(context);
  assert.equal(calendarResult.data.version.versionNo, 2);
  assert.equal(store.schedules[0].publishedVersionNo, 2);

  store.importCandidateEvents.push({ ...store.importCandidateEvents[0], id: "candidate-personal", status: "pending", rawPayload: {} });
  context.path = "admin/import-candidates/candidate-personal/commit-personal";
  context.readJsonBody = async () => ({});
  const personalResult = await handleImportApi(context);
  assert.equal(personalResult.data.event.title, "导入课程");
  assert.equal(store.userScheduleEvents.length, 1);
});

test("converts legacy schedule-import preview rows into import candidates", async () => {
  const handler = await loadImportHandler();
  const { context, store, handleImportApi } = createContext(handler, {
    method: "POST",
    path: "admin/import-candidate-jobs/from-schedule-import/legacy-1",
    body: { targetSourceId: "schedule:schedule-1", itemId: "row-1" },
  });

  const response = await handleImportApi(context);

  assert.equal(response.data.candidateCount, 1);
  assert.equal(response.data.candidates[0].title, "旧导入课程");
  assert.equal(store.auditLogs[0].action, "import_candidate_from_schedule_import");
});

test("enforces schedule import ownership and maps confirm errors", async () => {
  const handler = await loadImportHandler();
  const user = createUser({ userId: "user-2", studentNo: "2300000002", adminRole: "none" });
  const { context, handleImportApi } = createContext(handler, {
    user,
    method: "GET",
    path: "schedule-import/jobs/foreign",
  });

  await assert.rejects(() => handleImportApi(context), (error) => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, "SCHEDULE_IMPORT_JOB_FORBIDDEN");
    return true;
  });

  const ownerContext = createContext(handler, {
    method: "POST",
    path: "schedule-import/jobs/bad-confirm/confirm",
    body: { previewEntries: [{ title: "bad" }] },
  });
  await assert.rejects(() => ownerContext.handleImportApi(ownerContext.context), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "SCHEDULE_IMPORT_CONFIRM_INVALID");
    assert.deepEqual(error.details, { previewCount: 1 });
    return true;
  });

  const confirmContext = createContext(handler, {
    method: "POST",
    path: "schedule-import/jobs/legacy-1/confirm",
    body: {
      previewEntries: [{ courseName: "旧导入课程", day: 1, startSection: 1, endSection: 2 }],
      originalPayload: { source: "pdf_preview", previewEntries: [{ courseName: "原课程" }] },
    },
  });
  const confirmed = await confirmContext.handleImportApi(confirmContext.context);
  assert.deepEqual(confirmed.data.originalPayload, { source: "pdf_preview", previewEntries: [{ courseName: "原课程" }] });
});

test("allows operator sessions to access schedule import admin routes when admin token check fails", async () => {
  const handler = await loadImportHandler();
  const operator = createUser({ userId: "operator-1", adminRole: "operator" });
  const { context, handleImportApi } = createContext(handler, {
    user: operator,
    adminDenied: true,
    method: "GET",
    path: "admin/import-jobs",
    query: { limit: "1" },
  });

  const response = await handleImportApi(context);

  assert.equal(response.data.total, 1);
  assert.equal(response.data.limit, 1);
  assert.equal(response.data.storage, "schedule_import_jobs");
});

test("previews PDF imports and ignores unrelated routes", async () => {
  const handler = await loadImportHandler();
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const { context, store, handleImportApi } = createContext(handler, {
    method: "POST",
    path: "calendar/me/pdf-import/preview",
    event: {
      multipartFormData: [{ name: "file", filename: "schedule.pdf", type: "application/pdf", data: pdfBytes }],
    },
  });

  const preview = await handleImportApi(context);
  assert.equal(preview.data.fileName, "schedule.pdf");
  assert.equal(preview.data.total, 1);
  assert.equal(store.importCandidateEvents[0].title, "PDF课程");

  context.path = "calendar/sources";
  assert.equal(handler.isImportPath("admin/import-candidate-jobs"), true);
  assert.equal(handler.isImportPath("calendar/sources"), false);
  assert.equal(await handleImportApi(context), null);
});
