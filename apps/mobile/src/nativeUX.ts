import { LayoutAnimation, NativeModules, PermissionsAndroid, Platform, Vibration } from "react-native";
import type { EffectiveCalendarItem } from "./api";
import {
  addDays,
  formatEventTime,
  getEventColor,
  getEventEndSection,
  getEventLocation,
  getEventStartSection,
  getEventType,
  getEventWeekday,
  getSectionEndTime,
  getSectionStartTime,
  sortEvents,
  termMeta,
} from "./schedule";

type HapticImpactStyle = "light" | "medium" | "heavy" | "soft" | "rigid";
type HapticNotificationType = "success" | "warning" | "error";

type NativeScheduleEvent = {
  id: string;
  title: string;
  body: string;
  location: string;
  eventType: string;
  color: string;
  startAt: string;
  endAt?: string;
  timeText: string;
  offsetMinutes: number[];
};

type TouchXNativeUXModule = {
  selection?: () => void;
  impact?: (style: HapticImpactStyle) => void;
  notification?: (type: HapticNotificationType) => void;
  requestNotificationPermission?: () => Promise<{ granted?: boolean; status?: number }>;
  scheduleEventNotifications?: (events: NativeScheduleEvent[]) => Promise<{ scheduled?: number }>;
  updateSharedSchedule?: (events: NativeScheduleEvent[]) => Promise<{ saved?: boolean; count?: number }>;
  exportScheduleToSystemCalendar?: (events: NativeScheduleEvent[]) => Promise<{ exported?: number; inserted?: number; updated?: number; skipped?: number; reason?: string }>;
  startLiveActivity?: (event: NativeScheduleEvent) => Promise<{ started?: boolean; reason?: string; id?: string }>;
  endLiveActivity?: () => Promise<{ ended?: number }>;
  setAuthenticated?: (authenticated: boolean) => void;
  pushNativeScreen?: (screen: string, title: string) => void;
};

const nativeUX = NativeModules.TouchXNativeUX as TouchXNativeUXModule | undefined;

const canUseNativeUX = Boolean(nativeUX);
const minuteMs = 60 * 1000;

const fallbackVibrate = (pattern: number | number[] = 10) => {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // Ignore platform-specific haptic failures.
  }
};

export const smoothLayout = () => {
  try {
    LayoutAnimation.configureNext({
      duration: 260,
      create: { type: "easeInEaseOut", property: "opacity" },
      update: { type: "easeInEaseOut" },
      delete: { type: "easeInEaseOut", property: "opacity" },
    });
  } catch {
    // LayoutAnimation is best-effort.
  }
};

export const hapticSelection = () => {
  if (canUseNativeUX && nativeUX?.selection) {
    nativeUX.selection();
    return;
  }
  fallbackVibrate(8);
};

export const hapticImpact = (style: HapticImpactStyle = "light") => {
  if (canUseNativeUX && nativeUX?.impact) {
    nativeUX.impact(style);
    return;
  }
  fallbackVibrate(style === "heavy" ? 18 : 10);
};

export const hapticNotification = (type: HapticNotificationType = "success") => {
  if (canUseNativeUX && nativeUX?.notification) {
    nativeUX.notification(type);
    return;
  }
  fallbackVibrate(type === "success" ? [0, 10, 40, 10] : [0, 20, 40, 20]);
};

export const requestScheduleNotificationPermission = async () => {
  if (!canUseNativeUX || !nativeUX?.requestNotificationPermission) return { granted: false };
  try {
    return await nativeUX.requestNotificationPermission();
  } catch {
    return { granted: false };
  }
};

const parseTimeText = (value: string | undefined) => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) };
};

const dateAtLocalTime = (dateKey: string | undefined, timeText: string | undefined) => {
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  const parsedTime = parseTimeText(timeText);
  if (!year || !month || !day || !parsedTime) return null;
  const date = new Date(year, month - 1, day, parsedTime.hour, parsedTime.minute, 0, 0);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
};

const resolveEventDateKey = (event: EffectiveCalendarItem, week?: number) => {
  if (event.date) return event.date;
  const safeWeek = Math.max(1, Math.min(termMeta.maxWeek, Number(week || 1)));
  return addDays(termMeta.week1Monday, (safeWeek - 1) * 7 + getEventWeekday(event) - 1);
};

export const toNativeScheduleEvent = (event: EffectiveCalendarItem, week?: number): NativeScheduleEvent | null => {
  const startSection = getEventStartSection(event);
  const endSection = getEventEndSection(event);
  const startTime = event.startTime || getSectionStartTime(startSection);
  const endTime = event.endTime || getSectionEndTime(endSection);
  const dateKey = resolveEventDateKey(event, week);
  const startDate = dateAtLocalTime(dateKey, startTime);
  if (!startDate) return null;
  const endDate = dateAtLocalTime(dateKey, endTime) || new Date(startDate.getTime() + 45 * minuteMs);
  const location = getEventLocation(event);
  const timeText = formatEventTime(event);
  const customOffsets = Array.isArray((event as { reminderOffsets?: unknown }).reminderOffsets)
    ? ((event as { reminderOffsets?: unknown[] }).reminderOffsets || [])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
    : null;
  return {
    id: event.id || `${event.title}-${dateKey}-${startTime}`,
    title: event.title || "未命名日程",
    body: `${timeText}${location ? ` · ${location}` : ""}`,
    location,
    eventType: getEventType(event),
    color: getEventColor(event),
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
    timeText,
    offsetMinutes: customOffsets && customOffsets.length > 0 ? customOffsets : [15, 5],
  };
};

export const normalizeNativeScheduleEvents = (events: EffectiveCalendarItem[], week?: number) => {
  return sortEvents(events)
    .map((event) => toNativeScheduleEvent(event, week))
    .filter((event): event is NativeScheduleEvent => Boolean(event));
};

export const getNextNativeScheduleEvent = (events: NativeScheduleEvent[]) => {
  const now = Date.now();
  return events
    .filter((event) => Date.parse(event.startAt) > now - 5 * minuteMs)
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0] || null;
};

const authStateListeners = new Set<(authenticated: boolean) => void>();

export const subscribeAuthState = (listener: (authenticated: boolean) => void) => {
  authStateListeners.add(listener);
  return () => {
    authStateListeners.delete(listener);
  };
};

export const notifyNativeAuthState = (authenticated: boolean) => {
  authStateListeners.forEach((listener) => listener(authenticated));
  if (!canUseNativeUX || !nativeUX?.setAuthenticated) return;
  try {
    nativeUX.setAuthenticated(authenticated);
  } catch {
    // Auth gate still works in JS fallback mode.
  }
};

export const pushNativeScreen = (screen: string, title: string) => {
  if (!canUseNativeUX || !nativeUX?.pushNativeScreen) return false;
  try {
    nativeUX.pushNativeScreen(screen, title);
    return true;
  } catch {
    return false;
  }
};

export const exportScheduleToSystemCalendar = async (events: EffectiveCalendarItem[], options: { week?: number } = {}) => {
  const normalized = normalizeNativeScheduleEvents(events, options.week);
  if (!canUseNativeUX || !nativeUX?.exportScheduleToSystemCalendar) return { exported: 0 };
  try {
    if (Platform.OS === "android") {
      const permissions = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_CALENDAR,
        PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR,
      ]);
      const granted = permissions[PermissionsAndroid.PERMISSIONS.READ_CALENDAR] === PermissionsAndroid.RESULTS.GRANTED
        && permissions[PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR] === PermissionsAndroid.RESULTS.GRANTED;
      if (!granted) return { exported: 0, reason: "calendar_permission_denied" };
    }
    return await nativeUX.exportScheduleToSystemCalendar(normalized);
  } catch {
    return { exported: 0 };
  }
};

export const syncScheduleWithSystem = async (events: EffectiveCalendarItem[], options: { week?: number } = {}) => {
  if (!canUseNativeUX) return;
  const normalized = normalizeNativeScheduleEvents(events, options.week);
  try {
    await nativeUX?.updateSharedSchedule?.(normalized);
  } catch {
    // Widget refresh should never block the app.
  }
  try {
    await requestScheduleNotificationPermission();
    await nativeUX?.scheduleEventNotifications?.(normalized);
  } catch {
    // Notification scheduling is best-effort.
  }
  try {
    const next = getNextNativeScheduleEvent(normalized);
    if (next && Date.parse(next.startAt) - Date.now() <= 8 * 60 * minuteMs) {
      await nativeUX?.startLiveActivity?.(next);
    } else {
      await nativeUX?.endLiveActivity?.();
    }
  } catch {
    // Live Activities are unavailable on older devices/iOS versions or when disabled by the user.
  }
};
