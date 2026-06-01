import type { H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";

type ApiOk = <T>(data: T) => unknown;
type RequireAdmin = (event: H3Event) => { user: UserRecord };

export interface AdminAuditHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  requireAdmin: RequireAdmin;
}

const parsePagination = (query: Record<string, unknown>) => {
  const limit = Math.max(1, Math.min(500, Number(query.limit || 100)));
  const offset = Math.max(0, Number(query.offset || 0));
  return { limit, offset };
};

export const isAdminAuditPath = (path: string) => {
  return path === "admin/audit";
};

export const handleAdminAuditApi = async (context: AdminAuditHandlerContext) => {
  const { event, method, path, query, store, ok, requireAdmin } = context;

  if (method === "GET" && path === "admin/audit") {
    requireAdmin(event);
    const { limit, offset } = parsePagination(query);
    return ok({
      items: store.auditLogs.slice(offset, offset + limit),
      total: store.auditLogs.length,
      limit,
      offset,
    });
  }

  return null;
};
