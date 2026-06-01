import type { H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";

type ApiOk = <T>(data: T) => unknown;
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ResetStore = () => NexusStore;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface DevHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  ok: ApiOk;
  requireAdmin: RequireAdmin;
  resetStore: ResetStore;
  appendAudit: AppendAudit;
}

export const isDevPath = (path: string) => {
  return path === "dev/reset-store";
};

export const handleDevApi = async (context: DevHandlerContext) => {
  const { event, method, path, ok, requireAdmin, resetStore, appendAudit } = context;

  if (method === "POST" && path === "dev/reset-store") {
    const { user } = requireAdmin(event);
    const refreshed = resetStore();
    appendAudit("dev_reset_store", user.userId, { userCount: refreshed.users.length });
    return ok({ reset: true, users: refreshed.users.length });
  }

  return null;
};
