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
  const tmpDir = mkdtempSync(join(tmpdir(), "touchx-import-candidate-"));
  const tmpFile = join(tmpDir, fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadImportCandidateModule = async () => {
  const sharedPath = transpileModuleToTemp(
    join(import.meta.dirname, "../../../../packages/shared/src/index.ts"),
    "shared.mjs",
  );
  const importCorePath = transpileModuleToTemp(
    join(import.meta.dirname, "../../../../packages/import-core/src/index.ts"),
    "import-core.mjs",
    [["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`]],
  );
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const importCandidatePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/import/import-candidate-service.ts"),
    "import-candidate-service.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`],
      ["from \"@touchx/import-core\";", `from ${JSON.stringify(pathToFileURL(importCorePath).href)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/schedule-import-preview\"", "\"data:text/javascript,export {};\""],
    ],
  );
  return import(pathToFileURL(importCandidatePath).href);
};

const createStore = () => {
  const now = "2026-05-18T00:00:00.000Z";
  return {
    users: [],
    classes: [],
    classMembers: [],
    schedules: [
      {
        id: "schedule-1",
        classId: "class-1",
        title: "软件工程课表",
        description: "V1 import target",
        publishedVersionNo: 1,
        createdByUserId: "admin-1",
        createdAt: now,
        updatedAt: now,
      },
    ],
    scheduleVersions: [
      {
        id: "schedule-version-1",
        scheduleId: "schedule-1",
        versionNo: 1,
        status: "published",
        entries: [{
          id: "entry-1",
          day: 1,
          startSection: 1,
          endSection: 2,
          weekExpr: "1-16",
          parity: "all",
          courseName: "高等数学",
          classroom: "A101",
          teacher: "张老师",
        }],
        createdByUserId: "admin-1",
        createdAt: now,
      },
    ],
    scheduleSubscriptions: [],
    socialSubscriptionRequests: [],
    socialSubscriptionEdges: [],
    socialCircles: [],
    socialCircleMembers: [],
    socialActivities: [],
    socialActivityInvitations: [],
    socialNotifications: [],
    userScheduleEvents: [],
    scheduleCorrections: [],
    schedulePatches: [],
    scheduleConflicts: [],
    sessions: [],
    locationGrids: [],
    foodItems: [],
    foodCampaigns: [],
    foodCampaignVotes: [],
    foodPricingRules: [],
    foodPricingRuleVersions: [],
    foodPricingOverrideVersions: [],
    mediaAssets: [],
    botTemplates: [],
    botJobs: [],
    notificationChannels: [],
    notificationDeliveries: [],
    reminderRules: [],
    userNotificationBindings: [],
    importJobs: [],
    importCandidateEvents: [],
    auditLogs: [],
    partyGameRooms: [],
    partyGameMembers: [],
    partyGameStates: [],
    partyGameEvents: [],
    partyGameHeartOpenWords: [],
  };
};

test("corrects and commits an import candidate into a published calendar source version", async () => {
  const service = await loadImportCandidateModule();
  const store = createStore();
  const job = service.createManualImportJob(store, {
    ownerUserId: "admin-1",
    type: "pdf",
    targetSourceId: "schedule:schedule-1",
    rawText: "OCR preview text",
  });
  const candidate = service.createImportCandidateEvent(store, {
    jobId: job.id,
    title: "数据结构",
    eventType: "course",
    location: "B202",
    weekday: 2,
    startSection: 3,
    endSection: 4,
    weekExpr: "1-18",
    confidence: 0.7,
  });

  const corrected = service.updateImportCandidateStatus(store, candidate.id, "corrected", {
    title: "数据结构与算法",
    location: "B203",
    weekday: 3,
    startSection: 5,
    endSection: 6,
  });
  const result = service.commitImportCandidateToCalendarSource(store, {
    candidateId: candidate.id,
    actorUserId: "admin-1",
    publish: true,
  });

  assert.equal(corrected.title, "数据结构与算法");
  assert.equal(corrected.location, "B203");
  assert.equal(result.version.status, "published");
  assert.equal(result.version.versionNo, 2);
  assert.equal(result.schedule.publishedVersionNo, 2);
  assert.equal(result.version.entries.length, 2);
  assert.equal(result.entry.courseName, "数据结构与算法");
  assert.equal(result.entry.classroom, "B203");
  assert.equal(result.entry.day, 3);
  assert.equal(job.status, "committed");
  assert.equal(candidate.status, "accepted");
  assert.equal(candidate.rawPayload.committedTo, "calendar_source");
});

test("commits an import candidate into a personal event", async () => {
  const service = await loadImportCandidateModule();
  const store = createStore();
  const job = service.createManualImportJob(store, {
    ownerUserId: "admin-1",
    type: "image",
    rawText: "deadline screenshot",
  });
  const candidate = service.createImportCandidateEvent(store, {
    jobId: job.id,
    title: "提交课程设计",
    eventType: "deadline",
    location: "线上",
    weekday: 5,
    startSection: 9,
    endSection: 10,
    date: "2026-05-22",
    warnings: ["图片识别置信度中等"],
  });

  const result = service.commitImportCandidateToPersonalEvent(store, {
    candidateId: candidate.id,
    userId: "user-1",
  });

  assert.equal(result.event.userId, "user-1");
  assert.equal(result.event.title, "提交课程设计");
  assert.equal(result.event.source, "manual");
  assert.equal(result.event.priorityLabel, "high");
  assert.equal(result.event.examDate, "2026-05-22");
  assert.deepEqual(result.event.tags, ["import", "deadline"]);
  assert.equal(job.status, "committed");
  assert.equal(candidate.status, "accepted");
  assert.equal(candidate.rawPayload.committedTo, "personal_event");
});
