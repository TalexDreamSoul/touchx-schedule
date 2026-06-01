import type { H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import {
  createWechatClawdbotBindingQr,
  disableWechatClawdbotBindings,
  listUserNotificationBindings,
} from "./notification-binding-service";

type ApiOk = <T>(data: T) => unknown;
type RequireUser = (event: H3Event) => { user: UserRecord };
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface NotificationBindingUserHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  store: NexusStore;
  ok: ApiOk;
  requireUser: RequireUser;
  appendAudit: AppendAudit;
}

export const isNotificationBindingUserPath = (path: string) => {
  return path === "calendar/me/notification-bindings" || path.startsWith("calendar/me/notification-bindings/");
};

export const handleNotificationBindingUserApi = async (context: NotificationBindingUserHandlerContext) => {
  const { event, method, path, store, ok, requireUser, appendAudit } = context;

  if (method === "GET" && path === "calendar/me/notification-bindings") {
    const { user } = requireUser(event);
    return ok(listUserNotificationBindings(store, user));
  }

  if (method === "POST" && path === "calendar/me/notification-bindings/wechat-clawdbot/qr") {
    const { user } = requireUser(event);
    const result = createWechatClawdbotBindingQr(store, user);
    appendAudit("wechat_clawdbot_qr_create", user.userId, { bindingToken: result.bindingToken });
    return ok(result);
  }

  if (method === "POST" && path === "calendar/me/notification-bindings/wechat-clawdbot/unbind") {
    const { user } = requireUser(event);
    const result = disableWechatClawdbotBindings(store, user);
    appendAudit("wechat_clawdbot_unbind", user.userId, {});
    return ok(result);
  }

  return null;
};
