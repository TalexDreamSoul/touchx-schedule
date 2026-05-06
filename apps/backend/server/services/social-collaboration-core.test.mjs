import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadCoreModule = async () => {
  const sourcePath = join(import.meta.dirname, "social-collaboration-core.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-social-core-")), "social-collaboration-core.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

test("normalizes collaboration visibility to the supported scopes", async () => {
  const core = await loadCoreModule();

  assert.equal(core.normalizeVisibilityScope("detail"), "detail");
  assert.equal(core.normalizeVisibilityScope("blocked"), "blocked");
  assert.equal(core.normalizeVisibilityScope("unknown", "hidden"), "hidden");
  assert.equal(core.normalizeVisibilityScope("", "busy_free"), "busy_free");
});

test("resolves effective visibility from independent direct and circle grants", async () => {
  const core = await loadCoreModule();

  assert.equal(
    core.resolveEffectiveVisibilityScope([
      { visibilityScope: "busy_free", source: "circle", status: "active" },
      { visibilityScope: "detail", source: "request", status: "active" },
    ]),
    "detail",
  );
  assert.equal(
    core.resolveEffectiveVisibilityScope([
      { visibilityScope: "detail", source: "request", status: "revoked" },
      { visibilityScope: "busy_free", source: "circle", status: "active" },
    ]),
    "busy_free",
  );
});

test("keeps block grants stronger than all other visibility grants", async () => {
  const core = await loadCoreModule();

  assert.equal(
    core.resolveEffectiveVisibilityScope([
      { visibilityScope: "detail", source: "request", status: "active" },
      { visibilityScope: "blocked", source: "legacy", status: "active" },
      { visibilityScope: "busy_free", source: "circle", status: "active" },
    ]),
    "blocked",
  );
});

test("summarizes social relation state for search results", async () => {
  const core = await loadCoreModule();

  assert.deepEqual(
    core.buildSocialRelationStatus({
      isSelf: false,
      outboundPending: true,
      inboundPending: false,
      effectiveVisibility: "hidden",
      activeSources: [],
    }),
    {
      status: "pending_outbound",
      visibilityScope: "hidden",
      sources: [],
      canRequest: false,
      canUnsubscribe: false,
      canBlock: true,
    },
  );
  assert.deepEqual(
    core.buildSocialRelationStatus({
      isSelf: false,
      outboundPending: false,
      inboundPending: false,
      effectiveVisibility: "detail",
      activeSources: ["request", "circle"],
    }),
    {
      status: "subscribed",
      visibilityScope: "detail",
      sources: ["request", "circle"],
      canRequest: false,
      canUnsubscribe: true,
      canBlock: true,
    },
  );
});

test("allows social access only for self or active visible subscriptions", async () => {
  const core = await loadCoreModule();

  assert.equal(core.canUseSocialAccess({ relationStatus: { status: "self", visibilityScope: "detail" } }), true);
  assert.equal(core.canUseSocialAccess({ relationStatus: { status: "subscribed", visibilityScope: "busy_free" } }), true);
  assert.equal(core.canUseSocialAccess({ relationStatus: { status: "subscribed", visibilityScope: "detail" } }), true);
  assert.equal(core.canUseSocialAccess({ relationStatus: { status: "subscribed", visibilityScope: "hidden" } }), false);
  assert.equal(core.canUseSocialAccess({ relationStatus: { status: "blocked", visibilityScope: "blocked" } }), false);
  assert.equal(core.canUseSocialAccess({ relationStatus: { status: "pending_outbound", visibilityScope: "hidden" } }), false);
});

test("keeps social activity status transitions inside the activity state machine", async () => {
  const core = await loadCoreModule();

  assert.equal(core.resolveNextActivityStatus("draft", "send"), "inviting");
  assert.equal(core.resolveNextActivityStatus("inviting", "confirm"), "confirmed");
  assert.equal(core.resolveNextActivityStatus("inviting", "cancel"), "cancelled");
  assert.equal(core.resolveNextActivityStatus("confirmed", "cancel"), "cancelled");
  assert.equal(core.resolveNextActivityStatus("confirmed", "expire"), "confirmed");
});

test("extracts first-pass schedule intelligence without requiring an LLM", async () => {
  const core = await loadCoreModule();

  const parsed = core.buildScheduleIntelligence("下周三下午3点考试复习，周一三五下午2-4点训练 DDL");

  assert.equal(parsed.tags.includes("学习"), true);
  assert.equal(parsed.tags.includes("运动"), true);
  assert.equal(parsed.priorityLabel, "high");
  assert.equal(parsed.examLike, true);
  assert.equal(parsed.repeatWeekdays.join(","), "1,3,5");
  assert.equal(parsed.suggestedDay, 1);
  assert.equal(parsed.suggestedStartSection, 6);
  assert.equal(parsed.suggestedEndSection, 6);

  const batchParsed = core.buildScheduleIntelligence("周一三五下午2-4点训练");
  assert.equal(batchParsed.repeatWeekdays.join(","), "1,3,5");
  assert.equal(batchParsed.suggestedStartSection, 5);
  assert.equal(batchParsed.suggestedEndSection, 7);
});

test("expands repeated natural-language schedules into separate candidates", async () => {
  const core = await loadCoreModule();

  const candidates = core.buildScheduleCandidateDrafts("周一三五下午2-4点训练");

  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((item) => item.day), [1, 3, 5]);
  assert.equal(candidates.every((item) => item.startSection === 5 && item.endSection === 7), true);
  assert.equal(candidates.every((item) => item.tags.includes("运动")), true);
});

test("normalizes custom AA split rows and rejects mismatched totals", async () => {
  const core = await loadCoreModule();

  const okSplit = core.buildActivitySplitDraft({
    activityId: "activity_1",
    totalAmount: 30,
    currency: "CNY",
    participants: [
      { userId: "u1", studentId: "s1", name: "A" },
      { userId: "u2", studentId: "s2", name: "B" },
    ],
    perPerson: [
      { userId: "u1", amount: 12.5 },
      { userId: "u2", amount: 17.5 },
    ],
  });

  assert.equal(okSplit.totalAmount, 30);
  assert.deepEqual(okSplit.perPerson.map((item) => item.amount), [12.5, 17.5]);
  assert.throws(() => {
    core.buildActivitySplitDraft({
      activityId: "activity_1",
      totalAmount: 30,
      currency: "CNY",
      participants: [{ userId: "u1", studentId: "s1", name: "A" }],
      perPerson: [{ userId: "u1", amount: 29 }],
    });
  }, /AA_SPLIT_TOTAL_MISMATCH/);
});

test("builds exam countdown state from date keys", async () => {
  const core = await loadCoreModule();

  assert.deepEqual(core.buildExamCountdownState("2026-05-03", "2026-04-28"), {
    daysRemaining: 5,
    status: "upcoming",
  });
  assert.deepEqual(core.buildExamCountdownState("2026-04-28", "2026-04-28"), {
    daysRemaining: 0,
    status: "today",
  });
  assert.deepEqual(core.buildExamCountdownState("bad-date", "2026-04-28"), {
    daysRemaining: null,
    status: "unknown",
  });
});

test("sorts daily priority items by score then time", async () => {
  const core = await loadCoreModule();

  const items = core.sortDailyPriorityItems([
    { id: "late", title: "晚课", priorityScore: 60, startSection: 8 },
    { id: "urgent", title: "DDL", priorityScore: 95, startSection: 9 },
    { id: "early", title: "早课", priorityScore: 60, startSection: 1 },
  ]);

  assert.deepEqual(items.map((item) => item.id), ["urgent", "early", "late"]);
});

test("resolves calendar view keys from tags and sources", async () => {
  const core = await loadCoreModule();

  assert.equal(core.resolveCalendarViewKey({ tags: ["学习"], source: "ai", title: "复习线代" }), "learning");
  assert.equal(core.resolveCalendarViewKey({ tags: ["社团"], source: "activity", title: "社团例会" }), "social");
  assert.equal(core.resolveCalendarViewKey({ tags: ["运动"], source: "manual", title: "跑步" }), "personal");
  assert.equal(core.resolveCalendarViewKey({ tags: ["考试"], source: "exam", title: "期末考试" }), "learning");
});

test("builds escaped activity snapshot poster svg", async () => {
  const core = await loadCoreModule();

  const svg = core.buildActivitySnapshotPosterSvg({
    title: "复盘 & 聚餐",
    statusLabel: "已确认",
    timeLabel: "第 3 周 周五 18:00-20:00",
    participants: ["张三", "李四"],
  });

  assert.equal(svg.includes("复盘 &amp; 聚餐"), true);
  assert.equal(svg.includes("张三、李四"), true);
  assert.equal(svg.includes("<svg"), true);
});
