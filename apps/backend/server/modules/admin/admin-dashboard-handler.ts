import type { H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import { buildAdminDashboard } from "./dashboard-service";

type ApiOk = <T>(data: T) => unknown;
type RequireAdmin = (event: H3Event) => { user: UserRecord };

export interface AdminDashboardHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  store: NexusStore;
  ok: ApiOk;
  requireAdmin: RequireAdmin;
}

export const isAdminDashboardPath = (path: string) => {
  return path === "admin/dashboard";
};

export const handleAdminDashboardApi = async (context: AdminDashboardHandlerContext) => {
  const { event, method, path, store, ok, requireAdmin } = context;

  if (method === "GET" && path === "admin/dashboard") {
    requireAdmin(event);
    return ok(buildAdminDashboard(store));
  }

  return null;
};
