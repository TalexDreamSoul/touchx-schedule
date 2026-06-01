import type { H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import { listAdminUsers, updateAdminUser } from "./admin-user-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface AdminUserHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireAdmin: RequireAdmin;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
}

const parsePagination = (query: Record<string, unknown>) => {
  const limit = Math.max(1, Math.min(500, Number(query.limit || 100)));
  const offset = Math.max(0, Number(query.offset || 0));
  return { limit, offset };
};

export const isAdminUserPath = (path: string) => {
  return path === "admin/users" || path.startsWith("admin/users/");
};

export const handleAdminUserApi = async (context: AdminUserHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireAdmin, readJsonBody, appendAudit } = context;

  if (method === "GET" && path === "admin/users") {
    requireAdmin(event);
    const { limit, offset } = parsePagination(query);
    const includeGhost = String(query.includeGhost || "").toLowerCase() === "true";
    return ok(listAdminUsers(store, { limit, offset, includeGhost }));
  }

  const adminUserUpdateMatch = path.match(/^admin\/users\/([^/]+)\/update$/);
  if (method === "POST" && adminUserUpdateMatch) {
    const { user: adminUser } = requireAdmin(event);
    const userId = decodeURIComponent(adminUserUpdateMatch[1]);
    const body = await readJsonBody<{
      name?: string;
      nickname?: string;
      classLabel?: string;
      studentId?: string;
      adminRole?: "none" | "operator" | "super_admin";
      reminderEnabled?: boolean;
      reminderWindowMinutes?: number[] | string;
    }>(event);
    const user = updateAdminUser(store, userId, body);
    if (!user) {
      return toApiError(404, "ADMIN_USER_NOT_FOUND", "用户不存在");
    }
    appendAudit("admin_user_update", adminUser.userId, {
      targetUserId: user.userId,
      targetStudentNo: user.studentNo,
    });
    return ok({ user });
  }

  return null;
};
