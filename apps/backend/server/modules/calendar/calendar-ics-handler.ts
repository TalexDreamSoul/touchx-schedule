import { setHeader, type H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import {
  buildCalendarSourceIcs,
  buildScheduleIcs,
  buildUserCalendarIcs,
} from "./calendar-ics-service";

type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { user: UserRecord };

export interface CalendarIcsHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  toApiError: ApiError;
  requireUser: RequireUser;
}

const writeIcsResponseHeaders = (event: H3Event, filename: string) => {
  setHeader(event, "content-type", "text/calendar; charset=utf-8");
  setHeader(event, "content-disposition", `attachment; filename=\"${filename}\"`);
};

export const isCalendarIcsPath = (path: string) => {
  return path === "calendar/me/ics" || /^calendar\/sources\/[^/]+\/ics$/.test(path) || /^schedules\/[^/]+\/ics$/.test(path);
};

export const handleCalendarIcsApi = async (context: CalendarIcsHandlerContext) => {
  const { event, method, path, query, store, toApiError, requireUser } = context;

  if (method === "GET" && path === "calendar/me/ics") {
    const { user } = requireUser(event);
    const result = buildUserCalendarIcs(store, user, {
      week: query.week,
      date: query.date,
    });
    writeIcsResponseHeaders(event, result.filename);
    return result.content;
  }

  const calendarSourceIcsMatch = path.match(/^calendar\/sources\/([^/]+)\/ics$/);
  if (method === "GET" && calendarSourceIcsMatch) {
    const { user } = requireUser(event);
    const sourceId = decodeURIComponent(calendarSourceIcsMatch[1]);
    const result = buildCalendarSourceIcs(store, sourceId, user);
    if (!result.ok && result.reason === "source_not_found") {
      return toApiError(404, "CALENDAR_SOURCE_NOT_FOUND", "日程源不存在");
    }
    if (!result.ok && result.reason === "forbidden") {
      return toApiError(403, "CALENDAR_SOURCE_FORBIDDEN", "无权导出该日程源");
    }
    if (!result.ok) {
      return toApiError(400, "CALENDAR_SOURCE_NOT_PUBLISHED", "日程源尚未发布，无法导出 ICS");
    }
    writeIcsResponseHeaders(event, result.filename);
    return result.content;
  }

  const scheduleIcsMatch = path.match(/^schedules\/([^/]+)\/ics$/);
  if (method === "GET" && scheduleIcsMatch) {
    requireUser(event);
    const scheduleId = decodeURIComponent(scheduleIcsMatch[1]);
    const result = buildScheduleIcs(store, scheduleId);
    if (!result.ok && result.reason === "schedule_not_found") {
      return toApiError(404, "SCHEDULE_NOT_FOUND", "课表不存在");
    }
    if (!result.ok) {
      return toApiError(400, "SCHEDULE_NOT_PUBLISHED", "课表尚未发布，无法导出 ICS");
    }
    writeIcsResponseHeaders(event, result.filename);
    return result.content;
  }

  return null;
};
