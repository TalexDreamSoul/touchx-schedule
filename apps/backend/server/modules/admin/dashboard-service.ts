import type { NexusStore } from "../../services/domain-store";

export interface AdminDashboardStats {
  users: number;
  classes: number;
  calendarSources: number;
  publishedCalendarSources: number;
  personalEvents: number;
  notificationChannels: number;
  pendingDeliveries: number;
  failedDeliveries: number;
  importJobs: number;
  pendingImports: number;
  auditLogs: number;
}

export interface AdminDashboardPayload {
  stats: AdminDashboardStats;
  recentAuditLogs: NexusStore["auditLogs"];
  recentDeliveries: NexusStore["notificationDeliveries"];
}

const RECENT_LIMIT = 8;

export const buildAdminDashboard = (store: NexusStore): AdminDashboardPayload => {
  const failedDeliveries = store.notificationDeliveries.filter((item) => item.status === "failed").length;
  const pendingDeliveries = store.notificationDeliveries.filter((item) => item.status === "pending").length;
  const pendingImports = store.importCandidateEvents.filter((item) => item.status === "pending").length;
  const publishedSchedules = store.schedules.filter((item) => Number(item.publishedVersionNo || 0) > 0).length;

  return {
    stats: {
      users: store.users.length,
      classes: store.classes.length,
      calendarSources: store.schedules.length,
      publishedCalendarSources: publishedSchedules,
      personalEvents: store.userScheduleEvents.length,
      notificationChannels: store.notificationChannels.length,
      pendingDeliveries,
      failedDeliveries,
      importJobs: store.importJobs.length,
      pendingImports,
      auditLogs: store.auditLogs.length,
    },
    recentAuditLogs: store.auditLogs.slice(0, RECENT_LIMIT),
    recentDeliveries: store.notificationDeliveries.slice(0, RECENT_LIMIT),
  };
};
