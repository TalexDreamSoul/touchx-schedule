import type { H3Event } from "h3";
import { getHeader } from "h3";
import { getNexusStore, storeHelpers, type BotJobRecord, type NexusStore, type UserRecord } from "./domain-store";
import {
  addDaysToDateKey,
  getEffectiveScheduleEntriesForUser,
  getSectionTimeBySection,
  SCHEDULE_WEEKDAY_LABELS,
  getUserReminderTimezone,
  isScheduleEntryInWeek,
  resolveCurrentWeekForDate,
  SCHEDULE_DEFAULT_TIMEZONE,
  toAcademicWeekDay,
  toDateTimeParts,
  zonedDateTimeToUtc,
} from "./schedule-calendar";
import { isLegacyNotifyBoundUser } from "./social-v1-api";

export type ReminderType = "next_day_digest" | "pre_class_reminder";
export type ReminderDeliveryStatus = "pending" | "delivering" | "sent" | "failed";

export interface ReminderDeliveryItem {
  id: string;
  reminderType: ReminderType;
  dueAt: string;
  recipientUserId: string;
  studentNo: string;
  templateKey: string;
  payload: Record<string, unknown>;
  renderedTitle: string;
  renderedBody: string;
  status: ReminderDeliveryStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderHeartbeatOptions {
  now?: Date;
  nowIso?: string;
  timezone?: string;
  rainy?: boolean;
  force?: boolean;
  dryRun?: boolean;
  runNextDay?: boolean;
  actorUserId?: string;
  caller?: "cron" | "admin" | "scheduled";
}

export interface ReminderHeartbeatResult {
  skipped: boolean;
  reason?: "OUTSIDE_WINDOW" | "DUPLICATE_BUCKET";
  triggerKey: string;
  timezone: string;
  inWindow: boolean;
  shouldRunNextDay: boolean;
  dryRun: boolean;
  queuedCounts: {
    nextDayDigest: number;
    preClassReminder: number;
    duplicate: number;
  };
  job?: BotJobRecord;
}

interface ReminderDeliveryRow {
  id?: string;
  reminder_type?: string;
  dedupe_key?: string;
  due_at?: string;
  recipient_user_id?: string;
  student_no?: string;
  template_key?: string;
  payload?: string;
  status?: string;
  attempt_count?: number;
  external_message_id?: string;
  last_error?: string;
  sent_at?: string;
  created_at?: string;
  updated_at?: string;
}

interface PreparedStatementLike {
  bind: (...values: unknown[]) => PreparedStatementLike;
  first: <T = unknown>() => Promise<T | null>;
  all?: <T = unknown>() => Promise<{ results?: T[] }>;
  run: () => Promise<{ success?: boolean; meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare: (sql: string) => PreparedStatementLike;
  exec?: (sql: string) => Promise<unknown>;
}

interface ReminderCandidate {
  reminderType: ReminderType;
  dedupeKey: string;
  dueAt: string;
  recipientUserId: string;
  studentNo: string;
  templateKey: string;
  payload: Record<string, unknown>;
}

const BOT_DELIVERY_TOKEN_HEADER = "x-bot-delivery-token";
const HEARTBEAT_WINDOW_START_HOUR = 8;
const HEARTBEAT_WINDOW_END_HOUR = 23;
const HEARTBEAT_BUCKET_MINUTES = 15;
const HEARTBEAT_BUCKET_MS = HEARTBEAT_BUCKET_MINUTES * 60 * 1000;
const DELIVERY_STALE_MS = 30 * 60 * 1000;

const asString = (value: unknown) => String(value || "").trim();

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
};

const normalizeHeartbeatBucket = (hour: number, minute: number) => {
  const bucketMinute = Math.floor(Math.max(0, minute) / HEARTBEAT_BUCKET_MINUTES) * HEARTBEAT_BUCKET_MINUTES;
  return `${String(hour).padStart(2, "0")}:${String(bucketMinute).padStart(2, "0")}`;
};

const normalizeReminderStatus = (value: unknown): ReminderDeliveryStatus => {
  const status = asString(value) as ReminderDeliveryStatus;
  if (status === "pending" || status === "delivering" || status === "sent" || status === "failed") {
    return status;
  }
  return "pending";
};

const queryAll = async <T>(statement: PreparedStatementLike) => {
  if (typeof statement.all === "function") {
    const rows = await statement.all<T>();
    return Array.isArray(rows?.results) ? rows.results : [];
  }
  const single = await statement.first<T>();
  return single ? [single] : [];
};

const parseJsonRecord = (raw: unknown) => {
  const text = asString(raw);
  if (!text) {
    return {} as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    return {} as Record<string, unknown>;
  }
};

const renderTemplateText = (template: string, payload: Record<string, unknown>) => {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_matched, rawKey: string) => {
    const key = asString(rawKey);
    if (!key) {
      return "";
    }
    const value = payload[key];
    if (value === null || value === undefined) {
      return "";
    }
    if (Array.isArray(value)) {
      return value.map((item) => asString(item)).filter((item) => item).join("、");
    }
    return asString(value);
  });
};

const defaultTemplateByKey: Record<string, { title: string; body: string }> = {
  next_day_brief: {
    title: "次日课表播报",
    body: "{{name}}，你明天共有 {{courseCount}} 门课，第一节在 {{firstCourseTime}}。{{courseSummary}}",
  },
  next_day_no_class: {
    title: "无课日建议",
    body: "{{name}}，明日无课，可安排复习/运动/社团活动。",
  },
  pre_class_reminder: {
    title: "课前提醒",
    body: "{{name}}，{{windowMinutes}} 分钟后上 {{courseName}}（{{startTime}}-{{endTime}}），地点 {{classroom}}。",
  },
};

const resolveTemplate = (store: NexusStore, templateKey: string) => {
  const matched = store.botTemplates.find((item) => item.key === templateKey && item.enabled) || null;
  if (matched) {
    return {
      title: matched.title,
      body: matched.body,
    };
  }
  return defaultTemplateByKey[templateKey] || {
    title: templateKey,
    body: "{{name}}",
  };
};

const renderReminderDelivery = (store: NexusStore, templateKey: string, payload: Record<string, unknown>) => {
  const template = resolveTemplate(store, templateKey);
  return {
    renderedTitle: renderTemplateText(template.title, payload),
    renderedBody: renderTemplateText(template.body, payload),
  };
};

const resolveHeartbeatActor = (store: NexusStore) => {
  const actor =
    store.users.find((item) => item.adminRole === "super_admin") ||
    store.users.find((item) => item.adminRole === "operator") ||
    store.users[0] ||
    null;
  return actor?.userId || "system_cron";
};

const hasHeartbeatJobInBucket = (store: NexusStore, triggerKey: string) => {
  return store.botJobs.some((job) => job.type === "heartbeat_tick" && job.summary.includes(`triggerKey=${triggerKey}`));
};

const sanitizeReminderWindows = (user: UserRecord) => {
  const windows = Array.isArray(user.reminderWindowMinutes)
    ? user.reminderWindowMinutes.map((item) => Math.max(1, Math.min(24 * 60, Math.trunc(Number(item) || 0))))
    : [];
  return Array.from(new Set(windows.filter((item) => Number.isFinite(item) && item > 0))).sort((left, right) => right - left);
};

const resolveScheduleDateContext = (date: Date, timeZone: string) => {
  const parts = toDateTimeParts(date, timeZone);
  return {
    timeZone,
    nowParts: parts,
    currentWeek: resolveCurrentWeekForDate(date, timeZone),
    weekday: toAcademicWeekDay(date, timeZone),
  };
};

const isUserEligibleForReminder = (store: NexusStore, user: UserRecord) => {
  if (!user.reminderEnabled) {
    return false;
  }
  return isLegacyNotifyBoundUser(store, user.userId);
};

const formatCourseSummary = (courses: Array<{ courseName: string; startTime: string }>) => {
  if (courses.length <= 0) {
    return "";
  }
  return courses.slice(0, 3).map((item) => `${item.startTime} ${item.courseName}`).join("；");
};

const buildNextDayDigestCandidates = (store: NexusStore, now: Date) => {
  const candidates: ReminderCandidate[] = [];
  for (const user of store.users) {
    if (!isUserEligibleForReminder(store, user)) {
      continue;
    }
    const userTimezone = getUserReminderTimezone(store, user) || SCHEDULE_DEFAULT_TIMEZONE;
    const context = resolveScheduleDateContext(now, userTimezone);
    const targetDateKey = addDaysToDateKey(context.nowParts.dateKey, 1);
    const targetDate = zonedDateTimeToUtc(targetDateKey, "12:00", userTimezone);
    const targetWeek = resolveCurrentWeekForDate(targetDate, userTimezone);
    const targetDay = toAcademicWeekDay(targetDate, userTimezone);
    const entries = getEffectiveScheduleEntriesForUser(store, user)
      .filter((entry) => entry.day === targetDay && isScheduleEntryInWeek(entry, targetWeek))
      .sort((left, right) => left.startSection - right.startSection || left.endSection - right.endSection);
    const firstCourse = entries[0] || null;
    const firstCourseStart = firstCourse ? getSectionTimeBySection(firstCourse.startSection)?.start || "待定" : "无";
    const courseSummary = entries
      .map((entry) => ({
        courseName: entry.courseName,
        startTime: getSectionTimeBySection(entry.startSection)?.start || "待定",
      }));
    const payload: Record<string, unknown> = {
      name: user.name || user.nickname || user.studentNo,
      studentNo: user.studentNo,
      targetDateKey,
      weekdayLabel: `周${SCHEDULE_WEEKDAY_LABELS[targetDay - 1] || targetDay}`,
      courseCount: entries.length,
      firstCourseTime: firstCourseStart,
      courseSummary: formatCourseSummary(courseSummary),
      firstCourseName: firstCourse?.courseName || "",
    };
    candidates.push({
      reminderType: "next_day_digest",
      dedupeKey: `next_day_digest|${user.userId}|${targetDateKey}`,
      dueAt: now.toISOString(),
      recipientUserId: user.userId,
      studentNo: user.studentNo,
      templateKey: entries.length > 0 ? "next_day_brief" : "next_day_no_class",
      payload,
    });
  }
  return candidates;
};

const buildPreClassReminderCandidates = (store: NexusStore, now: Date) => {
  const candidates: ReminderCandidate[] = [];
  const bucketStart = Math.floor(now.getTime() / HEARTBEAT_BUCKET_MS) * HEARTBEAT_BUCKET_MS;
  const bucketEnd = bucketStart + HEARTBEAT_BUCKET_MS;
  for (const user of store.users) {
    if (!isUserEligibleForReminder(store, user)) {
      continue;
    }
    const reminderWindows = sanitizeReminderWindows(user);
    if (reminderWindows.length <= 0) {
      continue;
    }
    const entries = getEffectiveScheduleEntriesForUser(store, user);
    for (const entry of entries) {
      const timeZone = asString(entry.timezone) || SCHEDULE_DEFAULT_TIMEZONE;
      const context = resolveScheduleDateContext(now, timeZone);
      if (entry.day !== context.weekday || !isScheduleEntryInWeek(entry, context.currentWeek)) {
        continue;
      }
      const startSlot = getSectionTimeBySection(entry.startSection);
      const endSlot = getSectionTimeBySection(entry.endSection);
      if (!startSlot || !endSlot) {
        continue;
      }
      const courseStart = zonedDateTimeToUtc(context.nowParts.dateKey, startSlot.start, timeZone);
      const courseEnd = zonedDateTimeToUtc(context.nowParts.dateKey, endSlot.end, timeZone);
      if (!Number.isFinite(courseStart.getTime()) || !Number.isFinite(courseEnd.getTime())) {
        continue;
      }
      if (courseEnd.getTime() <= now.getTime()) {
        continue;
      }
      for (const windowMinutes of reminderWindows) {
        const dueAtDate = new Date(courseStart.getTime() - windowMinutes * 60 * 1000);
        const dueAtTs = dueAtDate.getTime();
        if (dueAtTs < bucketStart || dueAtTs >= bucketEnd) {
          continue;
        }
        const payload: Record<string, unknown> = {
          name: user.name || user.nickname || user.studentNo,
          studentNo: user.studentNo,
          courseName: entry.courseName,
          classroom: entry.classroom || "待定",
          teacher: entry.teacher || "待定",
          startTime: startSlot.start,
          endTime: endSlot.end,
          startSection: entry.startSection,
          endSection: entry.endSection,
          windowMinutes,
          dueDateKey: context.nowParts.dateKey,
          timezone: timeZone,
        };
        candidates.push({
          reminderType: "pre_class_reminder",
          dedupeKey: [
            "pre_class_reminder",
            user.userId,
            context.nowParts.dateKey,
            entry.courseName,
            entry.startSection,
            entry.endSection,
            windowMinutes,
          ].join("|"),
          dueAt: dueAtDate.toISOString(),
          recipientUserId: user.userId,
          studentNo: user.studentNo,
          templateKey: "pre_class_reminder",
          payload,
        });
      }
    }
  }
  return candidates;
};

const ensureReminderDeliveryTable = async (db: D1DatabaseLike) => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS schedule_reminder_deliveries (
      id TEXT PRIMARY KEY,
      reminder_type TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      due_at TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      student_no TEXT NOT NULL,
      template_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      external_message_id TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_schedule_reminder_deliveries_status_due ON schedule_reminder_deliveries(status, due_at)",
    "CREATE INDEX IF NOT EXISTS idx_schedule_reminder_deliveries_user_due ON schedule_reminder_deliveries(recipient_user_id, due_at)",
  ];
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
};

const insertReminderCandidate = async (db: D1DatabaseLike, candidate: ReminderCandidate) => {
  const nowIso = storeHelpers.nowIso();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO schedule_reminder_deliveries (
        id, reminder_type, dedupe_key, due_at, recipient_user_id, student_no,
        template_key, payload, status, attempt_count, external_message_id,
        last_error, sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', '', ?, ?)`,
    )
    .bind(
      storeHelpers.createId("delivery"),
      candidate.reminderType,
      candidate.dedupeKey,
      candidate.dueAt,
      candidate.recipientUserId,
      candidate.studentNo,
      candidate.templateKey,
      JSON.stringify(candidate.payload || {}),
      nowIso,
      nowIso,
    )
    .run();
  return Number(result?.meta?.changes || 0) > 0;
};

const hydrateDeliveryItem = (store: NexusStore, row: ReminderDeliveryRow): ReminderDeliveryItem => {
  const payload = parseJsonRecord(row.payload);
  const templateKey = asString(row.template_key);
  const rendered = renderReminderDelivery(store, templateKey, payload);
  return {
    id: asString(row.id),
    reminderType: (asString(row.reminder_type) || "next_day_digest") as ReminderType,
    dueAt: asString(row.due_at),
    recipientUserId: asString(row.recipient_user_id),
    studentNo: asString(row.student_no),
    templateKey,
    payload,
    renderedTitle: rendered.renderedTitle,
    renderedBody: rendered.renderedBody,
    status: normalizeReminderStatus(row.status),
    attemptCount: toInt(row.attempt_count, 0),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
};

export const resolveReminderDbFromEvent = (event: H3Event) => {
  const candidate = (event.context as { cloudflare?: { env?: { NEXUS_DB?: unknown } } }).cloudflare?.env?.NEXUS_DB;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const db = candidate as D1DatabaseLike;
  if (typeof db.prepare !== "function") {
    return null;
  }
  return db;
};

export const resolveReminderDbFromEnv = (env: unknown) => {
  const candidate = (env as { NEXUS_DB?: unknown })?.NEXUS_DB;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const db = candidate as D1DatabaseLike;
  if (typeof db.prepare !== "function") {
    return null;
  }
  return db;
};

export const getBotDeliveryTokenHeader = () => BOT_DELIVERY_TOKEN_HEADER;

export const requireBotDeliveryToken = (event: H3Event, configuredToken: string) => {
  const expected = asString(configuredToken);
  if (!expected) {
    throw new Error("BOT_DELIVERY_TOKEN_MISSING");
  }
  const received = asString(getHeader(event, BOT_DELIVERY_TOKEN_HEADER));
  return received && received === expected;
};

export const runReminderHeartbeat = async (db: D1DatabaseLike, options: ReminderHeartbeatOptions = {}): Promise<ReminderHeartbeatResult> => {
  await ensureReminderDeliveryTable(db);
  const store = getNexusStore();
  const now = options.now || (options.nowIso ? new Date(options.nowIso) : new Date());
  if (!Number.isFinite(now.getTime())) {
    throw new Error("HEARTBEAT_NOW_INVALID");
  }
  const timezone = asString(options.timezone) || SCHEDULE_DEFAULT_TIMEZONE;
  const nowParts = toDateTimeParts(now, timezone);
  const inWindow = nowParts.hour >= HEARTBEAT_WINDOW_START_HOUR && nowParts.hour <= HEARTBEAT_WINDOW_END_HOUR;
  const triggerKey = `${nowParts.dateKey}_${normalizeHeartbeatBucket(nowParts.hour, nowParts.minute)}`;
  if (!options.force && !inWindow) {
    return {
      skipped: true,
      reason: "OUTSIDE_WINDOW",
      triggerKey,
      timezone,
      inWindow,
      shouldRunNextDay: false,
      dryRun: options.dryRun === true,
      queuedCounts: {
        nextDayDigest: 0,
        preClassReminder: 0,
        duplicate: 0,
      },
    };
  }
  if (!options.force && hasHeartbeatJobInBucket(store, triggerKey)) {
    return {
      skipped: true,
      reason: "DUPLICATE_BUCKET",
      triggerKey,
      timezone,
      inWindow,
      shouldRunNextDay: false,
      dryRun: options.dryRun === true,
      queuedCounts: {
        nextDayDigest: 0,
        preClassReminder: 0,
        duplicate: 0,
      },
    };
  }

  const shouldRunNextDay = options.runNextDay === true || (nowParts.hour === 21 && nowParts.minute < HEARTBEAT_BUCKET_MINUTES);
  const digestCandidates = shouldRunNextDay ? buildNextDayDigestCandidates(store, now) : [];
  const preClassCandidates = buildPreClassReminderCandidates(store, now);
  let nextDayDigest = 0;
  let preClassReminder = 0;
  let duplicate = 0;

  if (!options.dryRun) {
    for (const candidate of [...digestCandidates, ...preClassCandidates]) {
      const inserted = await insertReminderCandidate(db, candidate);
      if (!inserted) {
        duplicate += 1;
        continue;
      }
      if (candidate.reminderType === "next_day_digest") {
        nextDayDigest += 1;
      } else {
        preClassReminder += 1;
      }
    }
  }

  const summary = [
    `triggerKey=${triggerKey}`,
    `caller=${options.caller || "cron"}`,
    `window=${inWindow ? "in" : "out"}`,
    `nextDay=${shouldRunNextDay ? "triggered" : "skipped"}`,
    `digest=${options.dryRun ? digestCandidates.length : nextDayDigest}`,
    `preClass=${options.dryRun ? preClassCandidates.length : preClassReminder}`,
    `duplicate=${duplicate}`,
    `dryRun=${options.dryRun === true ? "true" : "false"}`,
  ].join(";");
  const job: BotJobRecord = {
    id: storeHelpers.createId("bot_job"),
    type: "heartbeat_tick",
    status: "done",
    createdBy: asString(options.actorUserId) || resolveHeartbeatActor(store),
    createdAt: storeHelpers.nowIso(),
    finishedAt: storeHelpers.nowIso(),
    summary,
    suggestions: [],
  };

  if (!options.dryRun) {
    store.botJobs.unshift(job);
    if (store.botJobs.length > 2000) {
      store.botJobs.length = 2000;
    }
  }

  return {
    skipped: false,
    triggerKey,
    timezone,
    inWindow,
    shouldRunNextDay,
    dryRun: options.dryRun === true,
    queuedCounts: {
      nextDayDigest: options.dryRun ? digestCandidates.length : nextDayDigest,
      preClassReminder: options.dryRun ? preClassCandidates.length : preClassReminder,
      duplicate,
    },
    job,
  };
};

export const pullPendingReminderDeliveries = async (
  db: D1DatabaseLike,
  options?: { limit?: number; now?: Date },
): Promise<ReminderDeliveryItem[]> => {
  await ensureReminderDeliveryTable(db);
  const now = options?.now || new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - DELIVERY_STALE_MS).toISOString();
  const limit = Math.max(1, Math.min(100, toInt(options?.limit, 20)));
  const rows = await queryAll<ReminderDeliveryRow>(
    db
      .prepare(
        `SELECT
          id, reminder_type, dedupe_key, due_at, recipient_user_id, student_no,
          template_key, payload, status, attempt_count, external_message_id,
          last_error, sent_at, created_at, updated_at
         FROM schedule_reminder_deliveries
         WHERE due_at <= ?
           AND (status = 'pending' OR (status = 'delivering' AND updated_at <= ?))
         ORDER BY due_at ASC, created_at ASC
         LIMIT ?`,
      )
      .bind(nowIso, staleIso, limit),
  );
  const store = getNexusStore();
  const items: ReminderDeliveryItem[] = [];
  for (const row of rows) {
    const deliveryId = asString(row.id);
    if (!deliveryId) {
      continue;
    }
    const claimedAt = storeHelpers.nowIso();
    const claim = await db
      .prepare(
        `UPDATE schedule_reminder_deliveries
         SET status = 'delivering', attempt_count = attempt_count + 1, updated_at = ?
         WHERE id = ?
           AND (status = 'pending' OR (status = 'delivering' AND updated_at <= ?))`,
      )
      .bind(claimedAt, deliveryId, staleIso)
      .run();
    if (Number(claim?.meta?.changes || 0) <= 0) {
      continue;
    }
    items.push(
      hydrateDeliveryItem(store, {
        ...row,
        status: "delivering",
        attempt_count: toInt(row.attempt_count, 0) + 1,
        updated_at: claimedAt,
      }),
    );
  }
  return items;
};

export const ackReminderDelivery = async (
  db: D1DatabaseLike,
  deliveryId: string,
  payload: {
    success?: boolean;
    status?: "sent" | "failed";
    externalMessageId?: string;
    errorMessage?: string;
  },
) => {
  await ensureReminderDeliveryTable(db);
  const nextStatus = payload.status || (payload.success === false ? "failed" : "sent");
  const current = await db
    .prepare("SELECT status FROM schedule_reminder_deliveries WHERE id = ?")
    .bind(deliveryId)
    .first<{ status?: string }>();
  if (!current) {
    return false;
  }
  const currentStatus = normalizeReminderStatus(current.status);
  if (currentStatus === nextStatus) {
    return true;
  }
  if (currentStatus !== "delivering") {
    return false;
  }
  const nowIso = storeHelpers.nowIso();
  const runResult = await db
    .prepare(
      `UPDATE schedule_reminder_deliveries
       SET status = ?, external_message_id = ?, last_error = ?, sent_at = ?, updated_at = ?
       WHERE id = ? AND status = 'delivering'`,
    )
    .bind(
      nextStatus,
      asString(payload.externalMessageId),
      asString(payload.errorMessage),
      nextStatus === "sent" ? nowIso : "",
      nowIso,
      deliveryId,
    )
    .run();
  return Number(runResult?.meta?.changes || 0) > 0;
};
