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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-domain-store-upgrade-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadDomainStore = async () => {
  const sharedPath = transpileModuleToTemp(
    join(import.meta.dirname, "../../../../packages/shared/src/index.ts"),
    "shared.mjs",
    [
      ["export * from \"./calendar\";", ""],
      ["export * from \"./notification\";", ""],
      ["export * from \"./import\";", ""],
    ],
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
  return import(pathToFileURL(domainStorePath).href);
};

test("upgrades old persisted stores with missing top-level collections", async () => {
  const domainStore = await loadDomainStore();
  const oldStore = {
    users: [],
    classes: [],
    classMembers: [],
    schedules: [],
    scheduleVersions: [],
    scheduleSubscriptions: [],
  };

  domainStore.setGlobalNexusStore(oldStore, 7);
  const upgraded = domainStore.getNexusStore();

  const collectionKeys = [
    "socialSubscriptionRequests",
    "socialSubscriptionEdges",
    "socialCircles",
    "socialCircleMembers",
    "socialActivities",
    "socialActivityInvitations",
    "socialNotifications",
    "userScheduleEvents",
    "scheduleCorrections",
    "schedulePatches",
    "scheduleConflicts",
    "sessions",
    "locationGrids",
    "foodItems",
    "foodCampaigns",
    "foodCampaignVotes",
    "foodPricingRules",
    "foodPricingRuleVersions",
    "foodPricingOverrideVersions",
    "mediaAssets",
    "botTemplates",
    "botJobs",
    "notificationChannels",
    "notificationDeliveries",
    "reminderRules",
    "userNotificationBindings",
    "importJobs",
    "importCandidateEvents",
    "auditLogs",
    "partyGameRooms",
    "partyGameMembers",
    "partyGameStates",
    "partyGameEvents",
    "partyGameHeartOpenWords",
  ];

  collectionKeys.forEach((key) => {
    assert.equal(Array.isArray(upgraded[key]), true, `${key} should be upgraded to an array`);
  });
  assert.equal(upgraded.users.some((item) => item.accountName === "admin@schedule.com"), true);
  assert.deepEqual(
    upgraded.notificationChannels.map((item) => item.type).sort(),
    ["feishu", "wechat_clawdbot"],
  );
  assert.equal(upgraded.botTemplates.some((item) => item.key === "pre_class_reminder"), true);
  assert.equal(upgraded.partyGameHeartOpenWords.length > 0, true);
  assert.equal(domainStore.getNexusStoreRevision(), 7);
});
