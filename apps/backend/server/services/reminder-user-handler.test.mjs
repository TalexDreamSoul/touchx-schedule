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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-reminder-user-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadReminderUserHandler = async () => {
  const ruleService = `
    export const upsertReminderRule = (store, input) => {
      const existing = input.id ? store.reminderRules.find((item) => item.id === input.id) : null;
      const item = existing || { id: input.id || 'rule-created', createdAt: '2026-05-18T00:00:00.000Z' };
      Object.assign(item, {
        targetType: input.targetType || item.targetType || 'global',
        targetId: input.targetId || item.targetId || 'global',
        enabled: input.enabled ?? item.enabled ?? true,
        offsetMinutes: input.offsetMinutes ?? item.offsetMinutes ?? 15,
        templateKey: input.templateKey || item.templateKey || 'calendar.event.reminder',
        channelStrategy: input.channelStrategy || item.channelStrategy || 'primary_then_fallback',
        quietHoursRespect: input.quietHoursRespect ?? item.quietHoursRespect ?? true,
        updatedAt: '2026-05-18T00:00:01.000Z',
      });
      if (!existing) store.reminderRules.push(item);
      return item;
    };
    export const deleteReminderRule = (store, ruleId) => {
      const index = store.reminderRules.findIndex((item) => item.id === ruleId);
      if (index < 0) return null;
      return store.reminderRules.splice(index, 1)[0] || null;
    };
  `;
  const candidateService = `
    export const listReminderCandidatesForUser = (_store, user, options = {}) => ({ items: [{ id: 'candidate-1', userId: user.userId, options }], total: 1, week: options.week });
    export const enqueueReminderCandidatesForUser = (_store, user, options = {}) => ({ items: [{ id: 'delivery-1', userId: user.userId, options }], total: 1, candidateTotal: 1 });
  `;
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/notification/reminder-user-handler.ts"),
    "reminder-user-handler.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", "\"data:text/javascript,export {};\""],
      ["\"./reminder-candidate-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(candidateService)}`)],
      ["\"./reminder-rule-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(ruleService)}`)],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const createStore = () => ({
  scheduleSubscriptions: [
    { id: "sub-owned", subscriberUserId: "user-1" },
    { id: "sub-other", subscriberUserId: "user-2" },
  ],
  userScheduleEvents: [
    { id: "event-owned", userId: "user-1" },
    { id: "event-other", userId: "user-2" },
  ],
  reminderRules: [
    { id: "rule-global", targetType: "global", targetId: "user:user-1", updatedAt: "2026-05-18T00:00:03.000Z" },
    { id: "rule-sub-owned", targetType: "subscription", targetId: "sub-owned", updatedAt: "2026-05-18T00:00:02.000Z" },
    { id: "rule-sub-other", targetType: "subscription", targetId: "sub-other", updatedAt: "2026-05-18T00:00:01.000Z" },
    { id: "rule-event-owned", targetType: "personal_event", targetId: "event-owned", updatedAt: "2026-05-18T00:00:00.000Z" },
  ],
});

const createContext = (overrides = {}) => {
  const audits = [];
  const user = { userId: "user-1" };
  const context = {
    event: {},
    method: "GET",
    path: "calendar/me/reminder-rules",
    query: {},
    store: createStore(),
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireUser: () => ({ user }),
    readJsonBody: async () => ({}),
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
    ...overrides,
  };
  return { context, audits, user };
};

test("lists only reminder rules visible to current user", async () => {
  const { handleReminderUserApi } = await loadReminderUserHandler();
  const { context } = createContext();

  const response = await handleReminderUserApi(context);

  assert.equal(response.ok, true);
  assert.deepEqual(response.data.items.map((item) => item.id), ["rule-global", "rule-sub-owned", "rule-event-owned"]);
  assert.equal(response.data.total, 3);
});

test("rejects reminder rule writes outside current user ownership", async () => {
  const { handleReminderUserApi } = await loadReminderUserHandler();
  const { context } = createContext({
    method: "POST",
    readJsonBody: async () => ({ targetType: "subscription", targetId: "sub-other" }),
  });

  await assert.rejects(() => handleReminderUserApi(context), (error) => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, "REMINDER_RULE_TARGET_FORBIDDEN");
    return true;
  });
});

test("upserts and deletes owned reminder rules with audit records", async () => {
  const { handleReminderUserApi } = await loadReminderUserHandler();
  const { context, audits } = createContext({
    method: "POST",
    readJsonBody: async () => ({ targetType: "subscription", targetId: "sub-owned", offsetMinutes: 20 }),
  });

  const upserted = await handleReminderUserApi(context);
  assert.equal(upserted.data.item.targetId, "sub-owned");
  assert.equal(audits[0].action, "user_reminder_rule_upsert");

  context.path = "calendar/me/reminder-rules/rule-sub-owned/delete";
  const deleted = await handleReminderUserApi(context);
  assert.equal(deleted.data.item.id, "rule-sub-owned");
  assert.equal(audits[1].action, "user_reminder_rule_delete");
});

test("delegates reminder candidate listing and enqueueing", async () => {
  const { handleReminderUserApi } = await loadReminderUserHandler();
  const { context, audits } = createContext({
    path: "calendar/me/reminder-candidates",
    query: { week: "4", date: "2026-05-18" },
  });

  const listed = await handleReminderUserApi(context);
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.items[0].options.week, 4);

  context.method = "POST";
  context.path = "calendar/me/reminder-candidates/enqueue";
  context.readJsonBody = async () => ({ week: 5, date: "2026-05-19", limit: 3 });
  const enqueued = await handleReminderUserApi(context);
  assert.equal(enqueued.data.total, 1);
  assert.equal(enqueued.data.items[0].options.limit, 3);
  assert.equal(audits[0].action, "reminder_candidates_enqueue");
});
