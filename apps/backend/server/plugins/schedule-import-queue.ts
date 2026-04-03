import { consumeScheduleImportQueueBatch } from "../services/schedule-import-service";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:queue", async (payload) => {
    const batch = (payload || {}) as { batch?: unknown; env?: unknown; event?: unknown };
    const queueBatch = (batch.batch || batch.event) as { messages?: Array<{ body?: unknown; ack?: () => void; retry?: () => void }> } | undefined;
    if (!queueBatch || !Array.isArray(queueBatch.messages) || queueBatch.messages.length <= 0) {
      return;
    }
    await consumeScheduleImportQueueBatch(batch.env, queueBatch);
  });
});
