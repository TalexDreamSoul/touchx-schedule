import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-user-utils-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyUserUtils = async () => {
  const statePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-state.ts"),
    "legacy-state.mjs",
    [
      [
        "from \"../../services/food-utils\";",
        `from ${JSON.stringify(dataModule("export const normalizeCaloriesKcal=(value,fallback=0)=>Number(value||fallback||0);"))};`,
      ],
    ],
  );
  const userUtilsPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-user-utils.ts"),
    "legacy-user-utils.mjs",
    [
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          let seq = 0;
          export const storeHelpers = {
            createId: (prefix) => prefix + "_" + (++seq),
            nowIso: () => "2026-06-01T08:00:00.000Z",
          };
        `))};`,
      ],
      ["\"./legacy-state\"", JSON.stringify(pathToFileURL(statePath).href)],
    ],
  );
  return import(pathToFileURL(userUtilsPath).href);
};

const nowIso = "2026-06-01T08:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user_1",
  studentNo: "2305200101",
  studentId: "student_1",
  name: "Alice",
  classLabel: "一班",
  nickname: "Alice同学",
  avatarUrl: "",
  wallpaperUrl: "",
  classIds: ["class_1"],
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: nowIso,
  updatedAt: nowIso,
  ...overrides,
});

const createStore = () => ({
  users: [
    createUser(),
    createUser({
      userId: "user_2",
      studentNo: "2305200202",
      studentId: "student_2",
      name: "2305200202",
      nickname: "Bob同学",
      classLabel: "二班",
      adminRole: "operator",
    }),
  ],
  userNotificationBindings: [
    {
      id: "binding_1",
      userId: "user_2",
      channelType: "wechat_clawdbot",
      externalUserId: "wx-user-2",
      externalOpenId: "wx-open-2",
      externalUnionId: "wx-union-2",
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ],
});

const createState = () => ({
  randomCodeByUserId: new Map([["user_1", "0101"], ["user_2", "0202"]]),
  notifyBoundUserIds: new Set(["user_1"]),
  practiceCourseKeysByUserId: new Map([["user_1", new Set(["course_a"])]]),
  subscriptionTargetsByUserId: new Map(),
  bindingTargetUserIdByUserId: new Map([["user_1", "user_2"]]),
  campaignMetaByCampaignId: new Map(),
  campaignParticipantsByCampaignId: new Map(),
  foodCandidates: [],
  foodKeyBySourceFoodId: new Map(),
  sourceFoodIdByFoodKey: new Map(),
});

test("resolves legacy user identity, labels, and bound targets", async () => {
  const utils = await loadLegacyUserUtils();
  const store = createStore();
  const state = createState();

  assert.equal(utils.isAdminRole(store.users[1]), true);
  assert.equal(utils.resolveBoundTargetUser(store, state, store.users[0])?.userId, "user_2");
  assert.equal(utils.resolveSocialActorUser(store, state, store.users[0]).userId, "user_2");
  assert.deepEqual(utils.resolveNotificationRecipientUserIds(store, state, store.users[0]), ["user_1", "user_2"]);
  assert.equal(utils.findUserByStudentId(store, "student_2")?.userId, "user_2");
  assert.equal(utils.findUserByStudentNo(store, "2305200101")?.userId, "user_1");
  assert.equal(utils.findUserByUserId(store, "user_2")?.studentNo, "2305200202");
  assert.equal(utils.resolveMeaningfulUserName(store.users[1]), "Bob同学");
  assert.equal(utils.resolveUserDisplayLabel({ ...store.users[1], nickname: "" }), "2305200202");
});

test("finds and creates ClawDBot users through legacy state", async () => {
  const utils = await loadLegacyUserUtils();
  const store = createStore();
  const state = createState();

  assert.equal(utils.findClawDBotUser(store, { openId: "wx-open-2" })?.userId, "user_2");
  assert.equal(utils.findClawDBotUser(store, { unionId: "wx-union-2" })?.userId, "user_2");
  assert.equal(utils.findClawDBotUser(store, { externalUserId: "missing" }), null);

  const created = utils.createClawDBotUser(store, state, "2305200399", "新同学");
  assert.equal(created.userId, "user_1");
  assert.equal(created.nickname, "新同学");
  assert.equal(store.users.at(-1), created);
  assert.equal(state.randomCodeByUserId.get(created.userId), "0399");
  assert.equal(state.bindingTargetUserIdByUserId.get(created.userId), created.userId);

  const payload = utils.toLegacyAuthUser(store.users[0], store.users[1], state);
  assert.equal(payload.studentNo, "2305200202");
  assert.equal(payload.nickname, "Alice");
  assert.equal(payload.randomCode, "0202");
});
