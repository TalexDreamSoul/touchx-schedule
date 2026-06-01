import { getHeader, getRequestURL, type H3Event } from "h3";
import { buildScheduleCandidateDrafts, buildScheduleIntelligence } from "../../services/social-collaboration-core";
import { storeHelpers, type NexusStore, type UserRecord, type UserScheduleEventRecord } from "../../services/domain-store";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type ResolveEnv = (event: H3Event) => Record<string, unknown>;
type FindUserByStudentNo = (store: NexusStore, studentNo: string) => UserRecord | null;
type FindClawDBotUser = (store: NexusStore, identity: ClawDBotIdentity) => UserRecord | null;
type CreateClawDBotUser = (store: NexusStore, studentNo: string, nickname?: string) => UserRecord;
type ToLegacyAuthUser = (accountUser: UserRecord, boundTarget: UserRecord | null) => Record<string, unknown>;
type BuildConflictPayload = (
  store: NexusStore,
  user: UserRecord,
  candidate: { day: number; startSection: number; endSection: number },
) => Record<string, unknown>;
type ExtractExamDate = (text: unknown) => string;
type AppendAudit = (store: NexusStore, action: string, actorUserId: string, payload: Record<string, unknown>) => void;

type ClawDBotScheduleCandidate = ReturnType<typeof buildScheduleCandidateDrafts>[number] & {
  examDate: string;
  conflicts?: unknown[];
  alternatives?: unknown[];
};

export interface ClawDBotIdentity {
  studentNo: string;
  studentId: string;
  userId: string;
  openId: string;
  unionId: string;
  externalUserId: string;
  nickname: string;
}

export interface LegacyClawDBotHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  store: NexusStore;
  getStoreRevision: () => number;
  toApiError: ApiError;
  readJsonBody: ReadJsonBody;
  resolveEnv: ResolveEnv;
  findUserByStudentNo: FindUserByStudentNo;
  findClawDBotUser: FindClawDBotUser;
  createClawDBotUser: CreateClawDBotUser;
  toLegacyAuthUser: ToLegacyAuthUser;
  buildConflictPayload: BuildConflictPayload;
  extractExamDate: ExtractExamDate;
  appendAudit: AppendAudit;
}

const asString = (value: unknown) => String(value || "").trim();

export const isLegacyClawDBotPath = (path: string) => {
  return path === "bot/clawdbot/simulate" || path === "bot/clawdbot/webhook";
};

export const extractClawDBotText = (payload: unknown): string => {
  if (typeof payload === "string") {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const body = payload as Record<string, unknown>;
  const direct = asString(body.text || body.message || body.content || body.msg || body.keyword);
  if (direct) {
    return direct;
  }
  const textNode = body.text;
  if (textNode && typeof textNode === "object") {
    const textContent = asString((textNode as Record<string, unknown>).content);
    if (textContent) {
      return textContent;
    }
  }
  const messageNode = body.message;
  if (messageNode && typeof messageNode === "object") {
    const message = messageNode as Record<string, unknown>;
    const messageText = asString(message.text || message.content || message.message);
    if (messageText) {
      return messageText;
    }
    const nestedContent = message.content;
    if (nestedContent && typeof nestedContent === "object") {
      const nestedText = asString((nestedContent as Record<string, unknown>).text || (nestedContent as Record<string, unknown>).content);
      if (nestedText) {
        return nestedText;
      }
    }
  }
  const eventNode = body.event;
  if (eventNode && typeof eventNode === "object") {
    return extractClawDBotText(eventNode);
  }
  return "";
};

export const extractClawDBotIdentity = (payload: unknown): ClawDBotIdentity => {
  const result = {
    studentNo: "",
    studentId: "",
    userId: "",
    openId: "",
    unionId: "",
    externalUserId: "",
    nickname: "",
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const data = value as Record<string, unknown>;
    result.studentNo ||= asString(data.studentNo || data.student_no || data.student_no_text);
    result.studentId ||= asString(data.studentId || data.student_id);
    result.userId ||= asString(data.userId || data.user_id || data.uid);
    result.openId ||= asString(data.openId || data.open_id || data.openid || data.fromUserName || data.from_user_name);
    result.unionId ||= asString(data.unionId || data.union_id || data.unionid);
    result.externalUserId ||= asString(data.externalUserId || data.external_user_id || data.senderId || data.sender_id);
    result.nickname ||= asString(data.nickname || data.nickName || data.nick_name || data.name || data.senderName || data.sender_name);
    [data.user, data.sender, data.from, data.source, data.event].forEach(visit);
  };
  visit(payload);
  return result;
};

export const shouldCommitClawDBotText = (payload: unknown, text: string) => {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    if (body.commit === true || body.confirm === true) {
      return true;
    }
    const action = asString(body.action || body.intent).toLowerCase();
    if (action === "commit" || action === "confirm") {
      return true;
    }
  }
  return /^(确认|确认创建|创建|加入日程|添加日程|保存|commit|yes)$/i.test(asString(text));
};

export const buildClawDBotScheduleReply = (
  context: LegacyClawDBotHandlerContext,
  input: {
    user: UserRecord;
    text: string;
    nickname?: string;
    commit?: boolean;
  },
) => {
  const { store, getStoreRevision, toLegacyAuthUser, buildConflictPayload, extractExamDate } = context;
  const nickname = asString(input.nickname);
  if (nickname) {
    input.user.nickname = nickname;
    input.user.updatedAt = storeHelpers.nowIso();
  }
  const intelligence = buildScheduleIntelligence(input.text);
  const candidates: ClawDBotScheduleCandidate[] = buildScheduleCandidateDrafts(input.text).map((candidate) => ({
    ...candidate,
    examDate: extractExamDate(input.text),
    ...buildConflictPayload(store, input.user, candidate),
  }));
  const first = candidates[0] || null;
  let eventRecord: UserScheduleEventRecord | null = null;
  if (input.commit && first) {
    eventRecord = {
      id: storeHelpers.createId("user_event"),
      userId: input.user.userId,
      title: first.title,
      description: first.description,
      source: first.examLike ? "exam" : "ai",
      day: first.day,
      startSection: first.startSection,
      endSection: Math.max(first.startSection, first.endSection),
      weekExpr: first.weekExpr,
      parity: first.parity,
      tags: first.tags,
      priorityScore: first.priorityScore,
      priorityLabel: first.priorityLabel,
      examDate: first.examDate || "",
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.userScheduleEvents.push(eventRecord);
  }
  const replyLines = candidates.length > 0
    ? [
        `我识别到 ${candidates.length} 个日程候选：`,
        ...candidates.slice(0, 3).map((item, index) => {
          const conflict = Array.isArray(item.conflicts) && item.conflicts.length > 0 ? "（有冲突，建议换时间）" : "";
          return `${index + 1}. ${item.title} · 周${item.day} · 第${item.startSection}-${item.endSection}节 · ${item.examLike ? "考试/复习" : "日程"}${conflict}`;
        }),
        input.commit && eventRecord ? `已确认并创建个人日程：${eventRecord.id}` : "回复“确认”后可创建到个人日程。",
      ]
    : ["我暂时没有识别到明确日程，请试试：周三下午3点复习数据结构。"];
  return {
    ok: true,
    provider: "rules",
    channel: "wechat_clawdbot",
    user: toLegacyAuthUser(input.user, input.user),
    incoming: {
      text: input.text,
    },
    intelligence,
    candidates,
    committed: Boolean(eventRecord),
    event: eventRecord,
    reply: {
      msgtype: "text",
      text: {
        content: replyLines.join("\n"),
      },
    },
    text: replyLines.join("\n"),
    stateRevision: getStoreRevision(),
  };
};

export const handleLegacyClawDBotApi = async (context: LegacyClawDBotHandlerContext) => {
  const { event, method, path, store, toApiError, readJsonBody, resolveEnv, findUserByStudentNo, findClawDBotUser, createClawDBotUser, appendAudit } =
    context;

  if (method === "POST" && path === "bot/clawdbot/simulate") {
    const requestUrl = getRequestURL(event);
    const isLocalSimulation = requestUrl.hostname === "127.0.0.1" || requestUrl.hostname === "localhost";
    const env = resolveEnv(event);
    const configuredToken = asString(env.TOUCHX_CLAWDBOT_SIM_TOKEN || env.NEXUS_BOT_DELIVERY_TOKEN);
    const providedToken = asString(getHeader(event, "x-clawdbot-sim-token") || getHeader(event, "x-bot-delivery-token"));
    if (!isLocalSimulation && (!configuredToken || providedToken !== configuredToken)) {
      return toApiError(401, "CLAWDBOT_SIM_TOKEN_REQUIRED", "ClawDBot 模拟接口需要本地访问或有效测试 token");
    }
    const body = await readJsonBody<{
      text?: string;
      message?: string;
      studentNo?: string;
      student_no?: string;
      nickname?: string;
      commit?: boolean;
    }>(event);
    const text = asString(body.text || body.message);
    const studentNo = asString(body.studentNo || body.student_no) || "2305100613";
    if (!text) {
      return toApiError(400, "CLAWDBOT_SIM_TEXT_REQUIRED", "请输入要模拟的 ClawDBot 消息");
    }
    const user = findUserByStudentNo(store, studentNo) || createClawDBotUser(store, studentNo, asString(body.nickname));
    return buildClawDBotScheduleReply(context, {
      user,
      text,
      nickname: body.nickname,
      commit: body.commit === true,
    });
  }

  if (method === "POST" && path === "bot/clawdbot/webhook") {
    const env = resolveEnv(event);
    const configuredToken = asString(env.TOUCHX_CLAWDBOT_WEBHOOK_TOKEN || env.NEXUS_BOT_DELIVERY_TOKEN || env.TOUCHX_CLAWDBOT_SIM_TOKEN);
    const providedToken = asString(
      getHeader(event, "x-clawdbot-webhook-token") ||
        getHeader(event, "x-clawdbot-sim-token") ||
        getHeader(event, "x-bot-delivery-token") ||
        getHeader(event, "x-clawdbot-token"),
    );
    if (!configuredToken || providedToken !== configuredToken) {
      return toApiError(401, "CLAWDBOT_WEBHOOK_TOKEN_INVALID", "ClawDBot webhook token 无效");
    }
    const body = await readJsonBody<unknown>(event);
    const text = extractClawDBotText(body);
    if (!text) {
      return toApiError(400, "CLAWDBOT_WEBHOOK_TEXT_REQUIRED", "ClawDBot webhook 消息文本为空");
    }
    const identity = extractClawDBotIdentity(body);
    const user = findClawDBotUser(store, identity);
    if (!user) {
      return toApiError(404, "CLAWDBOT_WEBHOOK_USER_NOT_FOUND", "未找到 ClawDBot 消息对应用户，请先绑定或提供 studentNo");
    }
    const targetUser = user as UserRecord;
    const result = buildClawDBotScheduleReply(context, {
      user: targetUser,
      text,
      nickname: identity.nickname,
      commit: shouldCommitClawDBotText(body, text),
    });
    appendAudit(store, "clawdbot_webhook_message", targetUser.userId, {
      committed: result.committed,
      candidateCount: result.candidates.length,
      openId: identity.openId,
      externalUserId: identity.externalUserId,
    });
    return {
      ...result,
      webhook: true,
    };
  }

  return null;
};
