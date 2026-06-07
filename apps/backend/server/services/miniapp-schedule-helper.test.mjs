import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { bundleTsModule, repoRoot } from "../../../../packages/test-utils/bundle-ts-module.mjs";

const clients = [
  {
    name: "miniapp",
    schedule: await bundleTsModule(join(repoRoot, "apps/miniapp/src/lib/schedule.ts"), {
      tmpPrefix: "touchx-miniapp-schedule-test",
    }),
  },
  {
    name: "mobile",
    schedule: await bundleTsModule(join(repoRoot, "apps/mobile/src/schedule.ts"), {
      tmpPrefix: "touchx-mobile-schedule-test",
    }),
  },
];

const withMockedDateNow = async (schedule, nowMs, run) => {
  const realDateNow = Date.now;
  Date.now = () => nowMs;
  try {
    await run();
  } finally {
    Date.now = realDateNow;
    const resetNow = realDateNow();
    Date.now = () => resetNow;
    schedule.syncServerOffsetFromIso(new Date(resetNow).toISOString());
    Date.now = realDateNow;
  }
};

for (const { name, schedule } of clients) {
  test(`${name} schedule helpers calibrate current day and week from server time`, async () => {
    const localNow = new Date(2026, 2, 2, 8, 0, 0, 0);
    const serverNow = new Date(2026, 2, 9, 8, 0, 0, 0);

    await withMockedDateNow(schedule, localNow.getTime(), async () => {
      const offset = schedule.syncServerOffsetFromIso(serverNow.toISOString());
      assert.equal(offset, serverNow.getTime() - localNow.getTime());

      const todayInfo = schedule.getTodayInfo();
      assert.equal(todayInfo.dateKey, "2026-03-09");
      assert.equal(todayInfo.week, 2);
      assert.equal(todayInfo.weekday, 1);

      schedule.syncServerOffsetFromIso("not-a-date");
      assert.equal(schedule.getServerOffsetMs(), offset);
    });
  });

  test(`${name} schedule ongoing checks use calibrated now by default`, async () => {
    const localNow = new Date(2026, 2, 2, 8, 0, 0, 0);
    const serverNow = new Date(2026, 2, 2, 10, 0, 0, 0);

    await withMockedDateNow(schedule, localNow.getTime(), async () => {
      schedule.syncServerOffsetFromIso(serverNow.toISOString());

      assert.equal(schedule.isEventFutureOrOngoing({ eventType: "course", endTime: "10:01" }), true);
      assert.equal(schedule.isEventFutureOrOngoing({ eventType: "course", endTime: "09:59" }), false);
    });
  });

  test(`${name} schedule greeting uses calibrated server time by default`, async () => {
    const localNow = new Date(2026, 2, 2, 23, 0, 0, 0);
    const serverNow = new Date(2026, 2, 3, 9, 0, 0, 0);

    await withMockedDateNow(schedule, localNow.getTime(), async () => {
      schedule.syncServerOffsetFromIso(serverNow.toISOString());

      assert.equal(schedule.resolveGreeting(), "早上好");
      assert.equal(schedule.resolveGreeting(new Date(2026, 2, 3, 18, 0, 0, 0)), "晚上好");
    });
  });
}
