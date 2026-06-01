import type { H3Event } from "h3";
import type { AuthSessionRecord, NexusStore, UserRecord } from "../../services/domain-store";
import { isAdminRole } from "../auth/auth-service";
import {
  findStaleOwnScheduleSubscriptionIds,
  summarizeClassSubscriptionsForUser,
} from "../schedule/schedule-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireAdmin = (event: H3Event) => { session?: AuthSessionRecord; user: UserRecord };
type ResolveSessionWithUser = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord } | null;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;
type ToUserPayload = (user: UserRecord) => Record<string, unknown>;

export interface AdminPreviewHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireAdmin: RequireAdmin;
  resolveSessionWithUser: ResolveSessionWithUser;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
  toUserPayload: ToUserPayload;
}

const asString = (value: unknown) => String(value || "").trim();

const requireScheduleImportAccess = (context: AdminPreviewHandlerContext) => {
  try {
    return context.requireAdmin(context.event);
  } catch (error) {
    const resolved = context.resolveSessionWithUser(context.event);
    if (resolved && isAdminRole(resolved.user)) {
      return resolved;
    }
    throw error;
  }
};

const findUserByStudentNo = (store: NexusStore, studentNo: string) => {
  return store.users.find((item) => item.studentNo === studentNo) || null;
};

export const isAdminPreviewPath = (path: string) => {
  return path === "admin/preview/profile-card" || path === "admin/preview/class-subscriptions" || path === "admin/preview/class-subscriptions/repair";
};

export const handleAdminPreviewApi = async (context: AdminPreviewHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireAdmin, readJsonBody, appendAudit, toUserPayload } = context;

  if (method === "GET" && path === "admin/preview/profile-card") {
    requireAdmin(event);
    const studentNo = asString(query.studentNo || query.student_no);
    const user = findUserByStudentNo(store, studentNo);
    if (!user) {
      return toApiError(404, "PREVIEW_USER_NOT_FOUND", "未找到对应学号用户");
    }
    const classes = store.classMembers
      .filter((item) => item.userId === user.userId)
      .map((item) => {
        const classItem = store.classes.find((classRow) => classRow.id === item.classId) || null;
        return {
          classId: item.classId,
          classLabel: classItem?.name || "",
          classRole: item.classRole,
        };
      });
    return ok({
      studentNo: user.studentNo,
      studentId: user.studentId || "",
      name: toUserPayload(user).name,
      avatarUrl: user.avatarUrl,
      wallpaperUrl: user.wallpaperUrl,
      classLabel: user.classLabel || "",
      classes,
    });
  }

  if (method === "GET" && path === "admin/preview/class-subscriptions") {
    requireAdmin(event);
    const studentNo = asString(query.studentNo || query.student_no);
    const user = findUserByStudentNo(store, studentNo);
    if (!user) {
      return toApiError(404, "PREVIEW_USER_NOT_FOUND", "未找到对应学号用户");
    }
    const { memberships, subscriptions } = summarizeClassSubscriptionsForUser(store, user);
    const repairableSubscriptionIds = findStaleOwnScheduleSubscriptionIds(store, user);
    return ok({
      studentNo,
      memberships,
      subscriptions,
      repairableSubscriptionIds,
    });
  }

  if (method === "POST" && path === "admin/preview/class-subscriptions/repair") {
    const { user: adminUser } = requireScheduleImportAccess(context);
    const body = await readJsonBody<{ studentNo?: string; student_no?: string; dryRun?: boolean }>(event);
    const studentNo = asString(body.studentNo || body.student_no);
    if (!studentNo) {
      return toApiError(400, "REPAIR_STUDENT_NO_REQUIRED", "studentNo 不能为空");
    }
    const user = findUserByStudentNo(store, studentNo);
    if (!user) {
      return toApiError(404, "REPAIR_USER_NOT_FOUND", "未找到对应学号用户");
    }
    const removableSubscriptionIds = new Set(findStaleOwnScheduleSubscriptionIds(store, user));
    const before = summarizeClassSubscriptionsForUser(store, user);
    if (body.dryRun === false && removableSubscriptionIds.size > 0) {
      store.scheduleSubscriptions = store.scheduleSubscriptions.filter((item) => !removableSubscriptionIds.has(item.id));
      store.schedulePatches = store.schedulePatches.filter((item) => !removableSubscriptionIds.has(item.subscriptionId));
      store.scheduleConflicts = store.scheduleConflicts.filter((item) => !removableSubscriptionIds.has(item.subscriptionId));
      appendAudit("admin_repair_class_subscriptions", adminUser.userId, {
        studentNo,
        removedSubscriptionIds: Array.from(removableSubscriptionIds.values()),
      });
    }
    const after = summarizeClassSubscriptionsForUser(store, user);
    return ok({
      studentNo,
      dryRun: body.dryRun !== false,
      removedSubscriptionIds: Array.from(removableSubscriptionIds.values()),
      before,
      after,
    });
  }

  return null;
};
