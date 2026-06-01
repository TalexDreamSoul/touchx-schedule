import type { H3Event } from "h3";
import { buildScheduleCandidateDrafts, buildScheduleIntelligence } from "../../services/social-collaboration-core";
import { storeHelpers, type NexusStore, type UserRecord, type UserScheduleEventRecord } from "../../services/domain-store";
import { requestAiChatCompletion, resolveAiProviderConfig } from "../../services/ai-provider";
import { confirmScheduleImportPreviewEntries } from "../../services/schedule-import-service";
import { normalizeAiScheduleOcrPreview } from "../../services/schedule-import-preview";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type ResolveEnv = (event: H3Event) => Record<string, unknown>;
type ResolveAbsoluteUrl = (event: H3Event, url: string) => string;
type BuildConflictPayload = (
  store: NexusStore,
  user: UserRecord,
  candidate: { day: number; startSection: number; endSection: number },
) => Record<string, unknown>;
type ExtractExamDate = (text: unknown) => string;

export interface LegacyAiScheduleHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  store: NexusStore;
  getStoreRevision: () => number;
  toApiError: ApiError;
  readJsonBody: ReadJsonBody;
  requireLegacyAuth: RequireLegacyAuth;
  resolveEnv: ResolveEnv;
  resolveAbsoluteUrl: ResolveAbsoluteUrl;
  buildConflictPayload: BuildConflictPayload;
  extractExamDate: ExtractExamDate;
}

const asString = (value: unknown) => String(value || "").trim();

export const isLegacyAiSchedulePath = (path: string) => {
  return path === "ai/chat" || path === "ai/schedule/ocr-preview" || path === "ai/schedule/ocr-confirm" || path === "ai/schedule/parse" || path === "ai/schedule/commit";
};

const buildScheduleCandidates = (context: LegacyAiScheduleHandlerContext, user: UserRecord, text: string) => {
  return buildScheduleCandidateDrafts(text).map((candidate) => ({
    ...candidate,
    examDate: context.extractExamDate(text),
    ...context.buildConflictPayload(context.store, user, candidate),
  }));
};

export const handleLegacyAiScheduleApi = async (context: LegacyAiScheduleHandlerContext) => {
  const {
    event,
    method,
    path,
    store,
    getStoreRevision,
    toApiError,
    readJsonBody,
    requireLegacyAuth,
    resolveEnv,
    resolveAbsoluteUrl,
  } = context;

  if (method === "POST" && path === "ai/chat") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{
      text?: string;
      message?: string;
      attachments?: Array<{ type?: string; url?: string; name?: string; text?: string }>;
    }>(event);
    const text = asString(body.text || body.message);
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!text && attachments.length <= 0) {
      return toApiError(400, "AI_CHAT_INPUT_REQUIRED", "请输入消息或上传文件");
    }
    const config = resolveAiProviderConfig(resolveEnv(event));
    if (!config.enabled) {
      return toApiError(503, config.reason, "AI 服务未配置，请设置 TOUCHX_AI_API_KEY 等环境变量");
    }
    const attachmentText = attachments
      .map((item) => {
        const name = asString(item.name);
        const type = asString(item.type);
        const extractedText = asString(item.text);
        const url = asString(item.url);
        return [type, name, extractedText, url].filter((value) => value).join(" ");
      })
      .filter((value) => value)
      .join("\n");
    const imageAttachments = attachments
      .filter((item) => /image|photo|camera|album/i.test(asString(item.type || item.name || item.url)) && asString(item.url))
      .map((item) => ({
        type: "image_url" as const,
        image_url: {
          url: resolveAbsoluteUrl(event, asString(item.url)),
        },
      }))
      .filter((item) => item.image_url.url);
    const userText = [text, attachmentText ? `附件信息：\n${attachmentText}` : ""].filter((value) => value).join("\n\n");
    const userContent =
      imageAttachments.length > 0
        ? [
            {
              type: "text" as const,
              text: userText || "请识别附件中的日程信息。",
            },
            ...imageAttachments,
          ]
        : userText;
    let assistantText = "";
    try {
      assistantText = await requestAiChatCompletion(config, {
        useVision: imageAttachments.length > 0,
        messages: [
          {
            role: "system",
            content:
              "你是 TouchX 简程的时间助手。请用简洁中文回复，识别用户要创建的日程、活动、冲突问题或空闲查询。不要直接声称已创建，必须提示用户确认。",
          },
          {
            role: "user",
            content: userContent,
          },
        ],
      });
    } catch (error) {
      return toApiError(502, "AI_PROVIDER_REQUEST_FAILED", error instanceof Error ? error.message : "AI 服务调用失败");
    }
    const scheduleCandidates = text
      ? buildScheduleCandidates(context, user, text).map((candidate) => ({
          type: "schedule_candidate",
          candidate,
        }))
      : [];
    return {
      ok: true,
      provider: "openai-compatible",
      message: {
        role: "assistant",
        content: assistantText || "已完成识别，请确认下方候选内容。",
      },
      cards: scheduleCandidates,
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "ai/schedule/ocr-preview") {
    requireLegacyAuth(event);
    const body = await readJsonBody<{
      assetUrl?: string;
      fileName?: string;
      studentNo?: string;
      term?: string;
    }>(event);
    const assetUrl = asString(body.assetUrl);
    if (!assetUrl) {
      return toApiError(400, "AI_OCR_ASSET_REQUIRED", "请先上传课表图片");
    }
    const config = resolveAiProviderConfig(resolveEnv(event));
    if (!config.enabled) {
      return toApiError(503, config.reason, "AI 服务未配置，请设置 TOUCHX_AI_API_KEY 等环境变量");
    }
    const imageUrl = resolveAbsoluteUrl(event, assetUrl);
    let assistantText = "";
    try {
      assistantText = await requestAiChatCompletion(config, {
        useVision: true,
        messages: [
          {
            role: "system",
            content:
              "你是课表 OCR 结构化助手。只返回 JSON，不要 Markdown。JSON 字段：studentNo、term、name、courses。courses 每项包含 courseName、weekday(1-7)、sections([start,end])、weeks、parity(all/odd/even)、location、teacher。",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "请识别图片中的大学课表，并返回可导入的 JSON。",
                  body.studentNo ? `已知学号：${asString(body.studentNo)}` : "",
                  body.term ? `已知学期：${asString(body.term)}` : "",
                  body.fileName ? `文件名：${asString(body.fileName)}` : "",
                ]
                  .filter((value) => value)
                  .join("\n"),
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
      });
    } catch (error) {
      return toApiError(502, "AI_PROVIDER_REQUEST_FAILED", error instanceof Error ? error.message : "AI 服务调用失败");
    }
    try {
      const normalized = normalizeAiScheduleOcrPreview(assistantText);
      return {
        ok: true,
        provider: "openai-compatible",
        assetUrl,
        rawText: assistantText,
        studentNo: asString(body.studentNo) || normalized.studentNo,
        term: asString(body.term) || normalized.term || "2025-2026-2",
        parsedName: normalized.parsedName,
        previewEntries: normalized.previewEntries,
        stateRevision: getStoreRevision(),
      };
    } catch (error) {
      return toApiError(422, "AI_OCR_PREVIEW_EMPTY", "AI 未识别到可导入课程，请换一张更清晰的课表图片");
    }
  }

  if (method === "POST" && path === "ai/schedule/ocr-confirm") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{
      studentNo?: string;
      term?: string;
      parsedName?: string;
      rawText?: string;
      assetUrl?: string;
      previewEntries?: unknown[];
    }>(event);
    const studentNo = asString(body.studentNo || user.studentNo || user.studentId);
    const previewEntries = Array.isArray(body.previewEntries) ? body.previewEntries : [];
    try {
      const result = await confirmScheduleImportPreviewEntries(event, user.userId, {
        studentNo,
        term: asString(body.term) || "2025-2026-2",
        parsedName: asString(body.parsedName || user.name || user.nickname),
        previewEntries: previewEntries as Parameters<typeof confirmScheduleImportPreviewEntries>[2]["previewEntries"],
        sourceLabel: "AI/OCR 导入",
        originalPayload: {
          source: "ai_ocr",
          rawText: asString(body.rawText),
          assetUrl: asString(body.assetUrl),
        },
      });
      return {
        ok: true,
        ...result,
        stateRevision: getStoreRevision(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "确认导入失败";
      return toApiError(400, "AI_OCR_CONFIRM_FAILED", message);
    }
  }

  if (method === "POST" && path === "ai/schedule/parse") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{ text?: string }>(event);
    const text = asString(body.text);
    if (!text) {
      return toApiError(400, "AI_SCHEDULE_TEXT_REQUIRED", "请输入需要解析的日程文本");
    }
    const candidates = buildScheduleCandidates(context, user, text);
    return {
      ok: true,
      provider: "rules",
      candidates,
      userId: user.userId,
    };
  }

  if (method === "POST" && path === "ai/schedule/commit") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{
      title?: string;
      description?: string;
      day?: number;
      startSection?: number;
      start_section?: number;
      endSection?: number;
      end_section?: number;
      weekExpr?: string;
      week_expr?: string;
      parity?: "all" | "odd" | "even";
      tags?: string[];
      examDate?: string;
      exam_date?: string;
    }>(event);
    const title = asString(body.title);
    if (!title) {
      return toApiError(400, "SCHEDULE_EVENT_TITLE_REQUIRED", "日程标题不能为空");
    }
    const intelligence = buildScheduleIntelligence(`${title} ${asString(body.description)}`);
    const eventRecord: UserScheduleEventRecord = {
      id: storeHelpers.createId("user_event"),
      userId: user.userId,
      title,
      description: asString(body.description),
      source: intelligence.examLike ? "exam" : "ai",
      day: Math.max(1, Math.min(7, Math.trunc(Number(body.day || intelligence.repeatWeekdays[0] || 1)))),
      startSection: Math.max(1, Math.trunc(Number(body.startSection || body.start_section || intelligence.suggestedStartSection || 1))),
      endSection: Math.max(
        1,
        Math.trunc(Number(body.endSection || body.end_section || body.startSection || body.start_section || intelligence.suggestedEndSection || 1)),
      ),
      weekExpr: asString(body.weekExpr || body.week_expr) || "1-20",
      parity: body.parity === "odd" || body.parity === "even" ? body.parity : "all",
      tags: Array.isArray(body.tags) && body.tags.length > 0 ? body.tags.map((item) => asString(item)).filter((item) => item) : intelligence.tags,
      priorityScore: intelligence.priorityScore,
      priorityLabel: intelligence.priorityLabel,
      examDate: asString(body.examDate || body.exam_date) || context.extractExamDate(`${title} ${asString(body.description)}`),
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    eventRecord.endSection = Math.max(eventRecord.startSection, eventRecord.endSection);
    store.userScheduleEvents.push(eventRecord);
    return { ok: true, event: eventRecord, stateRevision: getStoreRevision() };
  }

  return null;
};
