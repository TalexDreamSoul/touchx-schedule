import { withNexusStateScopeByDb } from "../services/nexus-state-manager";
import { resolveReminderDbFromEnv, runReminderHeartbeat } from "../services/reminder-delivery-service";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", async (payload) => {
    const scheduledPayload = (payload || {}) as {
      controller?: { scheduledTime?: number };
      env?: unknown;
    };
    const db = resolveReminderDbFromEnv(scheduledPayload.env);
    if (!db) {
      return;
    }
    const runtimeConfig = useRuntimeConfig() as Record<string, unknown>;
    const scheduledTime = Number(scheduledPayload.controller?.scheduledTime || 0);
    const now = Number.isFinite(scheduledTime) && scheduledTime > 0 ? new Date(scheduledTime) : new Date();
    await withNexusStateScopeByDb(
      db,
      {
        writeRequest: true,
        lockOwner: `scheduled_reminder_${now.getTime()}`,
      },
      async () => {
        await runReminderHeartbeat(db, {
          now,
          timezone: String(runtimeConfig.heartbeatTimezone || "Asia/Shanghai"),
          caller: "scheduled",
          actorUserId: "system_cron",
        });
      },
    );
  });
});
