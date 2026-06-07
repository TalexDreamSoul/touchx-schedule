import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  GestureResponderEvent,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  archivePersonalEvent,
  cancelCalendarSubscription,
  clearAuthState,
  createPersonalEvent,
  createWechatClawDBotBindingQr,
  getAuthMe,
  getCalendarSettings,
  getSessionToken,
  getStoredUser,
  getTodayBrief,
  listCalendarSources,
  listMyCalendarSubscriptions,
  listMyEffectiveCalendar,
  listMyReminderRules,
  listNotificationBindings,
  listPersonalEvents,
  login,
  logout,
  markPersonalEventDone,
  register,
  setSessionToken,
  setStoredUser,
  subscribeCalendarSource,
  unbindWechatClawDBot,
  updateAuthProfile,
  updateCalendarSettings,
  upsertCalendarSource,
  upsertMyReminderRule,
  type CalendarSourceRow,
  type CalendarSubscriptionRow,
  type EffectiveCalendarItem,
  type MiniappUser,
  type NotificationBindingRow,
  type PersonalEventRow,
  type ReminderRuleRow,
} from "./api";
import {
  eventTypeLabels,
  formatDateLabel,
  formatEventDateTime,
  formatEventTime,
  formatSectionRange,
  formatWeekRange,
  getEventColor,
  getEventEndSection,
  getEventLocation,
  getEventStartSection,
  getEventType,
  getEventWeekday,
  getTodayInfo,
  isArchivedPersonalEvent,
  isDonePersonalEvent,
  isEventFutureOrOngoing,
  priorityLabel,
  resolveDateByWeekday,
  resolveGreeting,
  sectionTimes,
  sortEvents,
  syncServerOffsetFromIso,
  weekdayLabels,
} from "./schedule";
import { NativeLiquidTabBar, isNativeLiquidTabBarAvailable } from "./NativeLiquidTabBar";
import { exportScheduleToSystemCalendar, hapticImpact, hapticNotification, hapticSelection, notifyNativeAuthState, pushNativeScreen, requestScheduleNotificationPermission, smoothLayout, subscribeAuthState, syncScheduleWithSystem } from "./nativeUX";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { calendarEventTones, mobileNativeTheme } from "@touchx/ui-tokens";

type TabKey = "today" | "schedule" | "profile";
type ProfileRoute = "main" | "subscriptions";
type NativeStackScreen = "login" | "main" | "subscriptions";

type AppProps = {
  /** Passed by the native iOS UITabBarController. */
  tabKey?: TabKey | "login";
  /** True when UIKit owns the bottom tab bar. */
  nativeTabBar?: boolean;
  /** Secondary UIKit navigation destination rendered inside a pushed React root. */
  nativeStackScreen?: NativeStackScreen;
};

const tabItems: Array<{ key: TabKey; label: string }> = [
  { key: "today", label: "今日" },
  { key: "schedule", label: "日程表" },
  { key: "profile", label: "我的" },
];

const colors = mobileNativeTheme;

const eventTypeSoftColors: Record<string, string> = {
  course: calendarEventTones.course.soft,
  exam: calendarEventTones.exam.soft,
  todo: calendarEventTones.todo.soft,
  activity: calendarEventTones.activity.soft,
  holiday: calendarEventTones.holiday.soft,
  deadline: calendarEventTones.deadline.soft,
  custom: calendarEventTones.custom.soft,
};

const eventTypeBorderColors: Record<string, string> = {
  course: calendarEventTones.course.border,
  exam: calendarEventTones.exam.border,
  todo: calendarEventTones.todo.border,
  activity: calendarEventTones.activity.border,
  holiday: calendarEventTones.holiday.border,
  deadline: calendarEventTones.deadline.border,
  custom: calendarEventTones.custom.border,
};

const resolveTabKey = (value?: string): TabKey => {
  if (value === "today" || value === "schedule" || value === "profile") return value;
  return "today";
};

const isLoginRoot = (value?: string) => value === "login";

const sourceKey = (event: EffectiveCalendarItem, index: number) => event.id || `${event.title}-${event.date}-${index}`;
const loginHint = "请先登录后同步你的日程。";
const IOS_NATIVE_TAB_BAR_HEIGHT = 49;
const IOS_NATIVE_NAV_BAR_HEIGHT = 44;
const EDGE_GUTTER = 12;
const edgeTopInset = (top: number, extra = EDGE_GUTTER) => (Platform.OS === "ios" ? top + extra : extra);
const edgeBottomInset = (bottom: number, extra = EDGE_GUTTER) => (Platform.OS === "ios" ? bottom + extra : extra);
const edgeTopBarInset = (top: number, barHeight: number, extra = EDGE_GUTTER) => {
  if (Platform.OS !== "ios") return extra;
  const safeAreaAlreadyIncludesBar = top >= barHeight + 24;
  return top + (safeAreaAlreadyIncludesBar ? 0 : barHeight) + extra;
};
const edgeBottomBarInset = (bottom: number, barHeight: number, extra = EDGE_GUTTER) => {
  if (Platform.OS !== "ios") return extra;
  const safeAreaAlreadyIncludesBar = bottom >= barHeight;
  return bottom + (safeAreaAlreadyIncludesBar ? 0 : barHeight) + extra;
};

function Pill({ label, active }: { label: string; active?: boolean }) {
  return <Text style={[styles.pill, active ? styles.pillActive : undefined]}>{label}</Text>;
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, Platform.OS === "android" ? styles.androidCard : undefined, style]}>{children}</View>;
}

function FadeInView({ children, style }: { children: React.ReactNode; style?: object }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, damping: 18, stiffness: 160, mass: 0.7, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

function EventCard({ event }: { event: EffectiveCalendarItem }) {
  const type = getEventType(event);
  const color = getEventColor(type);
  return (
    <View style={[styles.eventCard, { backgroundColor: eventTypeSoftColors[type] || eventTypeSoftColors.custom, borderColor: eventTypeBorderColors[type] || eventTypeBorderColors.custom }]}>
      <View style={[styles.eventMark, { backgroundColor: color }]} />
      <View style={styles.eventMain}>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title || "未命名日程"}</Text>
        <Text style={styles.eventMeta}>{formatEventTime(event)} · {getEventLocation(event)}</Text>
      </View>
      <Text style={[styles.eventType, { color }]}>{eventTypeLabels[type]}</Text>
    </View>
  );
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: MiniappUser) => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("账号密码登录后同步今日、日程表与订阅。");
  const [loading, setLoading] = useState(false);

  const submitLogin = async () => {
    hapticSelection();
    if (!accountName.trim()) {
      hapticNotification("warning");
      setMessage("请输入账号。");
      return;
    }
    if (!password.trim()) {
      hapticNotification("warning");
      setMessage("请输入密码。");
      return;
    }
    setLoading(true);
    try {
      const data = mode === "register"
        ? await register({ accountName: accountName.trim(), password, confirmPassword, nickname: nickname.trim() || undefined })
        : await login({ accountName: accountName.trim(), password, nickname: nickname.trim() || undefined });
      setSessionToken(data.sessionToken);
      setStoredUser(data.user);
      hapticNotification("success");
      notifyNativeAuthState(true);
      onLoggedIn(data.user);
    } catch (error) {
      hapticNotification("error");
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[
        styles.loginRoot,
        { paddingTop: edgeTopInset(insets.top, 20), paddingBottom: edgeBottomInset(insets.bottom, 20) },
      ]}
    >
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <FadeInView style={styles.loginCard}>
        <View style={styles.loginMark}><Text style={styles.loginMarkText}>T</Text></View>
        <Text style={styles.loginTitle}>{mode === "register" ? "注册 TouchX" : "登录 TouchX"}</Text>
        <Text style={styles.loginSubtitle}>{message}</Text>
        <View style={styles.authSegment}>
          <Pressable style={[styles.authSegmentItem, mode === "login" ? styles.authSegmentItemActive : undefined]} onPress={() => setMode("login")}><Text style={styles.authSegmentText}>登录</Text></Pressable>
          <Pressable style={[styles.authSegmentItem, mode === "register" ? styles.authSegmentItemActive : undefined]} onPress={() => setMode("register")}><Text style={styles.authSegmentText}>注册</Text></Pressable>
        </View>
        <TextInput
          value={accountName}
          onChangeText={setAccountName}
          placeholder="账号 / 邮箱"
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
          style={styles.loginInput}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="密码"
          placeholderTextColor={colors.secondaryText}
          secureTextEntry
          style={styles.loginInput}
        />
        {mode === "register" ? (
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="确认密码"
            placeholderTextColor={colors.secondaryText}
            secureTextEntry
            style={styles.loginInput}
          />
        ) : null}
        <TextInput
          value={nickname}
          onChangeText={setNickname}
          placeholder="昵称，可选"
          placeholderTextColor={colors.secondaryText}
          style={styles.loginInput}
        />
        <Pressable style={[styles.loginButton, loading ? styles.disabledButton : undefined]} onPress={submitLogin} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.loginButtonText}>{mode === "register" ? "注册并进入 App" : "登录并进入 App"}</Text>}
        </Pressable>
      </FadeInView>
    </KeyboardAvoidingView>
  );
}

function TodayScreen({ refreshSignal, edgeToEdge = false }: { refreshSignal: number; edgeToEdge?: boolean }) {
  const insets = useSafeAreaInsets();
  const [todayInfo, setTodayInfo] = useState(() => getTodayInfo());
  const [events, setEvents] = useState<EffectiveCalendarItem[]>([]);
  const [todos, setTodos] = useState<PersonalEventRow[]>([]);
  const [message, setMessage] = useState("正在加载真实日程…");
  const [loading, setLoading] = useState(false);
  const [todoTitle, setTodoTitle] = useState("");

  const sortedEvents = useMemo(() => sortEvents(events), [events]);
  const todayCourses = sortedEvents.filter((event) => getEventType(event) === "course");
  const otherEvents = sortedEvents.filter((event) => getEventType(event) !== "course");
  const pendingCourses = todayCourses.filter((event) => isEventFutureOrOngoing(event, todayInfo.date)).slice(0, 6);
  const todaySectionLoad = todayCourses.reduce((sum, item) => sum + Math.max(1, Number(item.endSection || item.startSection || 1) - Number(item.startSection || 1) + 1), 0);

  const syncServerClock = async () => {
    try {
      const brief = await getTodayBrief();
      syncServerOffsetFromIso(brief.serverNowIso);
    } catch {
      // Keep the last known offset when the calibration endpoint is unavailable.
    }
    const nextTodayInfo = getTodayInfo();
    setTodayInfo(nextTodayInfo);
    return nextTodayInfo;
  };

  const load = async () => {
    const nextTodayInfo = await syncServerClock();
    if (!getSessionToken()) {
      setEvents([]);
      setTodos([]);
      setMessage(loginHint);
      return;
    }
    setLoading(true);
    try {
      const [calendar, personal] = await Promise.all([
        listMyEffectiveCalendar({ date: nextTodayInfo.dateKey }),
        listPersonalEvents(),
      ]);
      const activeTodos = (personal.items || []).filter((item) => !isDonePersonalEvent(item) && !isArchivedPersonalEvent(item));
      smoothLayout();
      setEvents(calendar.items || []);
      setTodos(activeTodos);
      setMessage(`今天 ${calendar.items?.length || 0} 条日程，${activeTodos.length} 个待办`);
      void syncScheduleWithSystem(calendar.items || [], { week: nextTodayInfo.week });
    } catch (error) {
      setEvents([]);
      setTodos([]);
      setMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const addTodo = async () => {
    hapticImpact("light");
    if (!todoTitle.trim()) {
      hapticNotification("warning");
      setMessage("请输入 Todo 标题。");
      return;
    }
    setLoading(true);
    try {
      await createPersonalEvent({
        title: todoTitle.trim(),
        eventType: "todo",
        weekday: todayInfo.weekday,
        startSection: 1,
        endSection: 1,
        priority: "normal",
        tags: ["个人", "todo"],
      });
      hapticNotification("success");
      setTodoTitle("");
      await load();
    } catch (error) {
      hapticNotification("error");
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const doneTodo = async (id: string) => {
    hapticSelection();
    setLoading(true);
    try {
      await markPersonalEventDone(id);
      hapticNotification("success");
      await load();
    } catch (error) {
      hapticNotification("error");
      setMessage(error instanceof Error ? error.message : "完成失败");
    } finally {
      setLoading(false);
    }
  };

  const archiveTodo = async (id: string) => {
    hapticSelection();
    setLoading(true);
    try {
      await archivePersonalEvent(id);
      hapticNotification("success");
      await load();
    } catch (error) {
      hapticNotification("error");
      setMessage(error instanceof Error ? error.message : "归档失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [refreshSignal]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      scrollIndicatorInsets={{ top: edgeToEdge ? insets.top : 0, bottom: edgeToEdge ? edgeBottomBarInset(insets.bottom, IOS_NATIVE_TAB_BAR_HEIGHT, 8) : 0 }}
      contentContainerStyle={[
        styles.content,
        edgeToEdge ? {
          paddingTop: edgeTopInset(insets.top, 10),
          paddingBottom: edgeBottomBarInset(insets.bottom, IOS_NATIVE_TAB_BAR_HEIGHT, 24),
        } : undefined,
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <View style={styles.greetingRow}>
        <View style={styles.greetingCopy}>
          <Text style={styles.greeting}>{resolveGreeting(todayInfo.date)}</Text>
          <Text style={styles.greetingSub}>第 {todayInfo.week} 周 · 周{todayInfo.weekdayLabel} · {todayInfo.dateKey}</Text>
        </View>
        <Pressable style={styles.roundIcon} onPress={() => {
          hapticSelection();
          void load();
        }}>
          {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.roundIconText}>↻</Text>}
        </Pressable>
      </View>

      <View style={styles.lessonHead}>
        <Text style={styles.lessonTitle}>今日待上课程</Text>
        <Text style={styles.lessonCount}>{pendingCourses.length} 门</Text>
      </View>
      <FlatList
        horizontal
        data={pendingCourses}
        keyExtractor={sourceKey}
        showsHorizontalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.lessonList}
        ListEmptyComponent={<Text style={styles.emptyInline}>今天暂无待上课程。</Text>}
        renderItem={({ item }) => {
          const type = getEventType(item);
          return (
            <View style={[styles.lessonItem, { backgroundColor: eventTypeSoftColors[type] || eventTypeSoftColors.custom, borderColor: eventTypeBorderColors[type] || eventTypeBorderColors.custom }]}>
              <View style={[styles.lessonMark, { backgroundColor: getEventColor(item) }]} />
              <View style={styles.lessonMain}>
                <Text style={styles.lessonName} numberOfLines={1}>{item.title || "未命名课程"}</Text>
                <Text style={styles.lessonReminder} numberOfLines={2}>{getEventLocation(item)} · {formatSectionRange(item.startSection, item.endSection)}</Text>
              </View>
              <Text style={styles.lessonTime}>{item.startTime || sectionTimes.find((section) => section.section === item.startSection)?.start || "--:--"}</Text>
            </View>
          );
        }}
      />

      <Card>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.sectionTitle}>今日课程</Text>
            <Text style={styles.sectionSub}>{message}</Text>
          </View>
          <Pill label={`${todayCourses.length} 门 / ${todaySectionLoad} 节`} active />
        </View>
        {todayCourses.length <= 0 ? <Text style={styles.tip}>暂无课程。</Text> : null}
        {todayCourses.map((event, index) => <EventCard event={event} key={sourceKey(event, index)} />)}
      </Card>

      {otherEvents.length > 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>今日优先事项</Text>
          <Text style={styles.sectionSub}>课程之外的考试、活动和个人日程</Text>
          {otherEvents.map((event, index) => <EventCard event={event} key={sourceKey(event, index)} />)}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>新增 Todo</Text>
        <TextInput
          value={todoTitle}
          onChangeText={setTodoTitle}
          placeholder="例如：复习数据结构"
          placeholderTextColor={colors.secondaryText}
          style={styles.input}
        />
        <Pressable style={styles.primaryButton} onPress={addTodo}>
          <Text style={styles.primaryButtonText}>创建 Todo</Text>
        </Pressable>
        {todos.map((todo) => (
          <View style={styles.todoRow} key={todo.id}>
            <View style={styles.todoMain}>
              <Text style={styles.todoTitle}>{todo.title}</Text>
              <Text style={styles.todoMeta}>周{weekdayLabels[Math.max(0, Math.min(6, Number(todo.weekday || todo.day || todayInfo.weekday) - 1))]} · {priorityLabel(todo.priorityLabel)}</Text>
            </View>
            <Pressable style={styles.secondaryButton} onPress={() => doneTodo(todo.id)}><Text style={styles.secondaryButtonText}>完成</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => archiveTodo(todo.id)}><Text style={styles.secondaryButtonText}>归档</Text></Pressable>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function ScheduleScreen({ refreshSignal, edgeToEdge = false }: { refreshSignal: number; edgeToEdge?: boolean }) {
  const insets = useSafeAreaInsets();
  const alignedServerWeekRef = useRef(false);
  const [todayInfo, setTodayInfo] = useState(() => getTodayInfo());
  const [week, setWeek] = useState(todayInfo.week);
  const [events, setEvents] = useState<EffectiveCalendarItem[]>([]);
  const [message, setMessage] = useState("正在加载周日程…");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"timeline" | "course">("timeline");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderOffsets, setReminderOffsets] = useState("30,15");
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  const syncServerClock = async () => {
    try {
      const brief = await getTodayBrief();
      syncServerOffsetFromIso(brief.serverNowIso);
    } catch {
      // Keep the last known offset when the calibration endpoint is unavailable.
    }
    const nextTodayInfo = getTodayInfo();
    setTodayInfo(nextTodayInfo);
    return nextTodayInfo;
  };

  const load = async (targetWeek = week, options: { alignWithServerWeek?: boolean } = {}) => {
    const nextTodayInfo = await syncServerClock();
    const resolvedWeek = options.alignWithServerWeek ? nextTodayInfo.week : targetWeek;
    if (options.alignWithServerWeek) {
      setWeek(resolvedWeek);
    }
    if (!getSessionToken()) {
      setEvents([]);
      setMessage(loginHint);
      return;
    }
    setLoading(true);
    try {
      const [data, settings] = await Promise.all([
        listMyEffectiveCalendar({ week: resolvedWeek }),
        getCalendarSettings().catch(() => null),
      ]);
      smoothLayout();
      setEvents(data.items || []);
      if (settings) {
        setReminderEnabled(Boolean(settings.reminderEnabled ?? true));
        setReminderOffsets((settings.reminderWindowMinutes || [30, 15]).join(","));
      }
      setMessage(`第 ${data.week || resolvedWeek} 周 ${data.items?.length || 0} 条日程`);
      void syncScheduleWithSystem(data.items || [], { week: data.week || resolvedWeek });
    } catch (error) {
      setEvents([]);
      setMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const alignWithServerWeek = !alignedServerWeekRef.current;
    alignedServerWeekRef.current = true;
    void load(week, { alignWithServerWeek });
  }, [refreshSignal]);

  const sortedEvents = useMemo(() => sortEvents(events), [events]);
  const byCell = useMemo(() => {
    const map = new Map<string, EffectiveCalendarItem[]>();
    sortedEvents.forEach((event) => {
      const key = `${getEventWeekday(event)}-${getEventStartSection(event)}`;
      map.set(key, [...(map.get(key) || []), event]);
    });
    return map;
  }, [sortedEvents]);
  const byDate = useMemo(() => {
    const map = new Map<string, EffectiveCalendarItem[]>();
    sortedEvents.forEach((event) => {
      const key = event.date || resolveDateByWeekday(week, getEventWeekday(event));
      map.set(key, [...(map.get(key) || []), event]);
    });
    return Array.from(map.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [sortedEvents, week]);

  const changeWeek = (delta: number) => {
    hapticSelection();
    smoothLayout();
    const next = Math.max(1, Math.min(25, week + delta));
    setWeek(next);
    setExpandedIds([]);
    void load(next);
  };

  const toggleExpand = (event: EffectiveCalendarItem) => {
    const id = event.id || `${event.title}-${event.date}-${event.startSection}`;
    hapticSelection();
    setExpandedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const saveSettings = async () => {
    const offsets = reminderOffsets.split(/[,，\s]+/).map((item) => Math.trunc(Number(item))).filter((item) => Number.isFinite(item) && item >= 0);
    setLoading(true);
    try {
      await updateCalendarSettings({ reminderEnabled, reminderWindowMinutes: offsets.length > 0 ? offsets : [30, 15] });
      hapticNotification("success");
      setMessage("日程表配置已保存。");
      setShowSettings(false);
    } catch (error) {
      hapticNotification("error");
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const exportToSystem = async () => {
    hapticImpact("light");
    await requestScheduleNotificationPermission();
    const result = await exportScheduleToSystemCalendar(events, { week });
    const exportedCount = result.exported || result.inserted || 0;
    setMessage(result.reason === "calendar_permission_denied" ? "请在系统设置中允许 TouchX 访问日历。" : `系统日历同步完成：${exportedCount} 条`);
  };

  const onTouchStart = (event: GestureResponderEvent) => {
    setTouchStart({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
  };
  const onTouchEnd = (event: GestureResponderEvent) => {
    if (!touchStart) return;
    const dx = event.nativeEvent.pageX - touchStart.x;
    const dy = event.nativeEvent.pageY - touchStart.y;
    setTouchStart(null);
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) changeWeek(dx < 0 ? 1 : -1);
  };

  const periodLabel = (event: EffectiveCalendarItem) => event.startTime || event.endTime ? formatEventTime(event) : formatSectionRange(event.startSection, event.endSection);

  return (
    <View
      style={[
        styles.scheduleScreen,
        edgeToEdge ? {
          paddingTop: edgeTopInset(insets.top, 8),
          paddingBottom: edgeBottomBarInset(insets.bottom, IOS_NATIVE_TAB_BAR_HEIGHT, 8),
        } : undefined,
      ]}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <View style={styles.weekHeader}>
        <Pressable style={styles.weekButton} onPress={() => changeWeek(-1)}><Text style={styles.weekButtonText}>‹</Text></Pressable>
        <Pressable style={styles.weekTitleWrap} onPress={() => { hapticSelection(); void load(); }}>
          <Text style={styles.weekTitle}>日程表 · 第 {week} 周</Text>
          <Text style={styles.weekSubtitle}>{formatWeekRange(week)} · {message}</Text>
        </Pressable>
        <Pressable style={styles.weekButton} onPress={() => changeWeek(1)}>{loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.weekButtonText}>›</Text>}</Pressable>
      </View>

      <View style={styles.scheduleToolbar}>
        <Pressable style={[styles.modeButton, mode === "timeline" ? styles.modeButtonActive : undefined]} onPress={() => setMode("timeline")}><Text style={styles.modeButtonText}>日程表</Text></Pressable>
        <Pressable style={[styles.modeButton, mode === "course" ? styles.modeButtonActive : undefined]} onPress={() => setMode("course")}><Text style={styles.modeButtonText}>课表模式</Text></Pressable>
        <Pressable style={styles.modeButton} onPress={() => setShowSettings((value) => !value)}><Text style={styles.modeButtonText}>设置</Text></Pressable>
      </View>

      {showSettings ? (
        <Card style={styles.scheduleSettingsCard}>
          <Text style={styles.sectionTitle}>日程表配置</Text>
          <Text style={styles.sectionSub}>提醒信息可编辑；iOS / Android 会尝试同步到系统日历。</Text>
          <View style={styles.settingsInlineRow}>
            <Text style={styles.settingsCellTitle}>默认提醒</Text>
            <Pressable style={[styles.switchPill, reminderEnabled ? styles.switchPillActive : undefined]} onPress={() => setReminderEnabled((value) => !value)}><Text style={styles.switchPillText}>{reminderEnabled ? "开启" : "关闭"}</Text></Pressable>
          </View>
          <TextInput value={reminderOffsets} onChangeText={setReminderOffsets} placeholder="提前分钟：30,15" placeholderTextColor={colors.secondaryText} style={styles.input} />
          <View style={styles.inlineActions}>
            <Pressable style={styles.primaryButton} onPress={saveSettings}><Text style={styles.primaryButtonText}>保存</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={exportToSystem}><Text style={styles.secondaryButtonText}>同步系统日历</Text></Pressable>
          </View>
        </Card>
      ) : null}

      {mode === "course" ? (
        <View style={styles.tableWrap}>
          <View style={styles.tableRowHead}>
            <View style={[styles.timeCol, styles.headCell]}><Text style={styles.headText}>节次</Text></View>
            {weekdayLabels.map((day, index) => (
              <View key={day} style={[styles.dayCol, styles.headCell, week === todayInfo.week && index + 1 === todayInfo.weekday ? styles.todayColumn : undefined]}>
                <Text style={[styles.headText, week === todayInfo.week && index + 1 === todayInfo.weekday ? styles.todayHeadText : undefined]}>周{day}</Text>
              </View>
            ))}
          </View>
          <ScrollView
            refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
            contentInsetAdjustmentBehavior="never"
            scrollIndicatorInsets={{ top: edgeToEdge ? insets.top : 0, bottom: edgeToEdge ? edgeBottomBarInset(insets.bottom, IOS_NATIVE_TAB_BAR_HEIGHT, 8) : 0 }}
          >
            {sectionTimes.map((section) => (
              <View style={styles.tableRow} key={section.section}>
                <View style={styles.timeCol}><Text style={styles.sectionNo}>{section.section}</Text><Text style={styles.sectionTime}>{section.start}</Text></View>
                {weekdayLabels.map((day, index) => {
                  const dayNumber = index + 1;
                  const cellEvents = byCell.get(`${dayNumber}-${section.section}`) || [];
                  const event = cellEvents[0];
                  const type = event ? getEventType(event) : "custom";
                  return (
                    <View key={`${section.section}-${day}`} style={[styles.dayCol, styles.cell, week === todayInfo.week && dayNumber === todayInfo.weekday ? styles.todayColumn : undefined]}>
                      {event ? (
                        <Pressable onPress={() => toggleExpand(event)} style={[styles.cellCard, { backgroundColor: eventTypeSoftColors[type] || eventTypeSoftColors.custom, borderColor: eventTypeBorderColors[type] || eventTypeBorderColors.custom }]}>
                          <Text style={styles.cellTitle} numberOfLines={2}>{event.title}</Text>
                          <Text style={styles.cellRoom} numberOfLines={1}>{getEventLocation(event)}</Text>
                          {getEventEndSection(event) > getEventStartSection(event) ? <Text style={styles.cellRoom}>{getEventStartSection(event)}-{getEventEndSection(event)}节</Text> : null}
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          style={styles.timelineScroll}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
          contentContainerStyle={styles.timelineContent}
          showsVerticalScrollIndicator={false}
        >
          {byDate.length <= 0 ? <Text style={styles.tip}>暂无日程。订阅或发布日程源后会显示。</Text> : null}
          {byDate.map(([dateKey, dayEvents]) => {
            const day = new Date(`${dateKey}T00:00:00`).getDay() || 7;
            return (
              <View key={dateKey} style={styles.timelineDay}>
                <View style={styles.timelineDayHead}><Text style={styles.timelineDayTitle}>周{weekdayLabels[day - 1]} · {formatDateLabel(dateKey)}</Text><Text style={styles.timelineDayCount}>{dayEvents.length} 项</Text></View>
                {dayEvents.map((event, index) => {
                  const type = getEventType(event);
                  const id = event.id || `${event.title}-${dateKey}-${index}`;
                  const expanded = expandedIds.includes(id);
                  return (
                    <Pressable key={id} style={styles.timelineEvent} onPress={() => toggleExpand(event)}>
                      <View style={styles.timelineTimeRail}><Text style={styles.timelineTimeMain}>{event.startTime || sectionTimes.find((item) => item.section === getEventStartSection(event))?.start || "全天"}</Text><Text style={styles.timelineTimeSub}>{event.endTime || ""}</Text></View>
                      <View style={[styles.timelineEventCard, { backgroundColor: eventTypeSoftColors[type] || eventTypeSoftColors.custom, borderColor: eventTypeBorderColors[type] || eventTypeBorderColors.custom }]}>
                        <View style={[styles.timelineEventMark, { backgroundColor: getEventColor(type) }]} />
                        <View style={styles.cardHeader}><View style={styles.eventMain}><Text style={styles.eventTitle}>{event.title || "未命名日程"}</Text><Text style={styles.eventMeta}>{periodLabel(event)} · {getEventLocation(event)}</Text></View><Text style={[styles.eventType, { color: getEventColor(type) }]}>{eventTypeLabels[type]}</Text></View>
                        {expanded ? <View style={styles.expandedBox}><Text style={styles.eventMeta}>完整时间：{formatEventDateTime(event)}</Text>{event.description ? <Text style={styles.eventMeta}>说明：{event.description}</Text> : null}<Text style={styles.eventMeta}>来源：{String(event.metadata?.sourceTitle || event.originType || "TouchX")}</Text><Text style={styles.eventMeta}>提醒：{event.reminderEnabled ? "已开启" : "已关闭"}</Text></View> : <Text style={styles.expandHint}>点击展开详情</Text>}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const sourceTypeLabel = (type: string) => {
  if (type === "class_schedule") return "班级课表";
  if (type === "exam_schedule") return "考试安排";
  if (type === "club_activity") return "社团活动";
  if (type === "school_calendar") return "校历";
  return type || "日程源";
};

function SubscriptionManagerScreen({ onBack, nativeNav = false, edgeToEdge = false }: { onBack?: () => void; nativeNav?: boolean; edgeToEdge?: boolean }) {
  const insets = useSafeAreaInsets();
  const [sources, setSources] = useState<CalendarSourceRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<CalendarSubscriptionRow[]>([]);
  const [message, setMessage] = useState("管理订阅后，今日和日程表会自动合成。");
  const [loading, setLoading] = useState(false);

  const subscribedIds = useMemo(() => new Set(subscriptions.map((item) => item.sourceId)), [subscriptions]);

  const load = async (interactive = true) => {
    if (interactive) {
      hapticSelection();
      smoothLayout();
    }
    setLoading(true);
    try {
      const [sourceData, subscriptionData] = await Promise.all([
        listCalendarSources(),
        listMyCalendarSubscriptions(),
      ]);
      setSources(sourceData.items || []);
      setSubscriptions(subscriptionData.items || []);
      setMessage(`已订阅 ${subscriptionData.items?.length || 0} 个日程源`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const subscribe = async (sourceId: string) => {
    hapticImpact("medium");
    smoothLayout();
    setLoading(true);
    try {
      const result = await subscribeCalendarSource(sourceId);
      hapticNotification(result.duplicated ? "warning" : "success");
      setMessage(result.duplicated ? "此前已订阅该日程源。" : "订阅成功。");
      await load(false);
    } catch (error) {
      hapticNotification("error");
      setMessage(error instanceof Error ? error.message : "订阅失败");
    } finally {
      setLoading(false);
    }
  };

  const cancelSubscription = async (subscriptionId: string) => {
    hapticImpact("light");
    setLoading(true);
    try {
      await cancelCalendarSubscription(subscriptionId);
      hapticNotification("success");
      setMessage("已取消订阅。");
      await load(false);
    } catch (error) {
      hapticNotification("error");
      setMessage(error instanceof Error ? error.message : "取消失败");
    } finally {
      setLoading(false);
    }
  };

  const publishSample = async () => {
    hapticImpact("light");
    setLoading(true);
    try {
      await upsertCalendarSource({
        title: "自定义活动合集",
        description: "App 自定义发布",
        type: "manual_collection",
        visibility: "public",
        publish: true,
        events: [{ title: "自定义活动", eventType: "activity", weekday: 1, startSection: 1, endSection: 1, weekExpr: "1-25", location: "待定" }],
      });
      setMessage("已发布自定义日程源。");
      await load(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(false); }, []);
  return (
    <View style={styles.settingsRoot}>
      {!nativeNav ? (
        <View style={styles.settingsNavBar}>
          {onBack ? <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>‹ 我的</Text></Pressable> : <View style={styles.navRightButton} />}
          <Text style={styles.settingsNavTitle}>我的订阅</Text>
          <Pressable onPress={() => void load()} style={styles.navRightButton}>{loading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.navRightText}>刷新</Text>}</Pressable>
        </View>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{
          top: edgeToEdge ? edgeTopBarInset(insets.top, IOS_NATIVE_NAV_BAR_HEIGHT, 0) : 0,
          bottom: edgeToEdge ? edgeBottomInset(insets.bottom, 8) : 0,
        }}
        contentContainerStyle={[
          styles.settingsContent,
          nativeNav ? styles.nativeNavContent : undefined,
          edgeToEdge ? {
            paddingTop: edgeTopBarInset(insets.top, IOS_NATIVE_NAV_BAR_HEIGHT, 12),
            paddingBottom: edgeBottomInset(insets.bottom, 24),
          } : undefined,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.settingsFooter}>{message}</Text>

        <SettingsGroup title="已订阅">
          {subscriptions.length <= 0 ? <SettingsCell title="暂无订阅" value="从下方日程源添加" /> : null}
          {subscriptions.map((item) => (
            <View style={styles.sourceCell} key={item.id}>
              <View style={styles.sourceMain}>
                <Text style={styles.settingsCellTitle}>{item.sourceTitle || item.classLabel || item.sourceId}</Text>
                <Text style={styles.settingsCellValue}>{item.classLabel || item.sourceType || "已启用"}</Text>
              </View>
              <Pressable style={styles.subscribeButtonDisabled} onPress={() => cancelSubscription(item.id)}>
                <Text style={styles.subscribeButtonTextDisabled}>取消</Text>
              </Pressable>
            </View>
          ))}
        </SettingsGroup>

        <SettingsGroup title="自定义发布">
          <View style={styles.sourceCell}>
            <View style={styles.sourceMain}>
              <Text style={styles.settingsCellTitle}>发布公开日程源</Text>
              <Text style={styles.settingsCellValue}>示例创建一个可订阅活动源</Text>
            </View>
            <Pressable style={styles.subscribeButton} onPress={publishSample}><Text style={styles.subscribeButtonText}>发布</Text></Pressable>
          </View>
        </SettingsGroup>

        <SettingsGroup title="可订阅日程源">
          {sources.length <= 0 ? <SettingsCell title="暂无日程源" value="管理员发布后显示" /> : null}
          {sources.map((source) => {
            const subscribed = subscribedIds.has(source.id);
            const disabled = subscribed || source.status !== "published" || loading;
            return (
              <View style={styles.sourceCell} key={source.id}>
                <View style={styles.sourceMain}>
                  <Text style={styles.settingsCellTitle}>{source.title}</Text>
                  <Text style={styles.settingsCellValue}>{source.classLabel || sourceTypeLabel(source.type)} · 事件 {source.eventCount || 0}</Text>
                </View>
                <Pressable disabled={disabled} style={[styles.subscribeButton, disabled ? styles.subscribeButtonDisabled : undefined]} onPress={() => subscribe(source.id)}>
                  <Text style={[styles.subscribeButtonText, disabled ? styles.subscribeButtonTextDisabled : undefined]}>{subscribed ? "已订阅" : source.status === "published" ? "订阅" : "未发布"}</Text>
                </Pressable>
              </View>
            );
          })}
        </SettingsGroup>
        <Text style={styles.settingsFooter}>支持查看、新增、取消订阅；自定义发布后可被其他用户订阅。</Text>
      </ScrollView>
    </View>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.settingsGroupWrap}>
      <Text style={styles.settingsGroupTitle}>{title}</Text>
      <View style={styles.settingsGroup}>{children}</View>
    </View>
  );
}

function SettingsCell({
  title,
  value,
  destructive,
  onPress,
}: {
  title: string;
  value?: string;
  destructive?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.settingsCell}>
      <Text style={[styles.settingsCellTitle, destructive ? styles.destructiveText : undefined]}>{title}</Text>
      <View style={styles.settingsCellRight}>
        {value ? <Text style={styles.settingsCellValue} numberOfLines={1}>{value}</Text> : null}
        {onPress ? <Text style={styles.settingsChevron}>›</Text> : null}
      </View>
    </View>
  );
  if (!onPress) return content;
  return <Pressable onPress={() => {
    hapticSelection();
    onPress();
  }}>{content}</Pressable>;
}

function ReminderManagerScreen() {
  const [rules, setRules] = useState<ReminderRuleRow[]>([]);
  const [offset, setOffset] = useState(15);
  const [message, setMessage] = useState("编辑具体提醒信息，保存后会影响候选提醒。");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listMyReminderRules();
      setRules(data.items || []);
      setMessage(`已配置 ${data.items?.length || 0} 条提醒规则`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const saveGlobal = async () => {
    setLoading(true);
    try {
      const data = await upsertMyReminderRule({
        targetType: "global",
        targetId: "global",
        enabled: true,
        offsetMinutes: offset,
        templateKey: "calendar.event.reminder",
        channelStrategy: "primary_then_fallback",
        quietHoursRespect: true,
      });
      setMessage(`已保存：提前 ${data.item.offsetMinutes} 分钟提醒`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <SettingsGroup title="提醒">
      <View style={styles.sourceCell}>
        <View style={styles.sourceMain}>
          <Text style={styles.settingsCellTitle}>默认提前分钟</Text>
          <Text style={styles.settingsCellValue}>{message}</Text>
        </View>
        <TextInput style={styles.smallInput} value={String(offset)} keyboardType="number-pad" onChangeText={(value) => setOffset(Math.max(0, Number(value) || 0))} />
        <Pressable style={styles.subscribeButton} onPress={saveGlobal} disabled={loading}><Text style={styles.subscribeButtonText}>保存</Text></Pressable>
      </View>
      {rules.map((rule) => (
        <SettingsCell key={rule.id} title={`${rule.targetType} · 提前 ${rule.offsetMinutes} 分钟`} value={rule.enabled ? rule.channelStrategy : "已关闭"} />
      ))}
    </SettingsGroup>
  );
}

function WechatBindingScreen() {
  const [bindings, setBindings] = useState<NotificationBindingRow[]>([]);
  const [qrImageUrl, setQrImageUrl] = useState("");
  const [message, setMessage] = useState("生成二维码后用微信 ClawDBot 扫码绑定。");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const data = await listNotificationBindings();
      setBindings(data.items || []);
    } catch {
      setBindings([]);
    }
  };

  const createQr = async () => {
    setLoading(true);
    try {
      const data = await createWechatClawDBotBindingQr();
      setQrImageUrl(data.qrImageUrl);
      setMessage("二维码已生成，请扫码绑定。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  const unbind = async () => {
    setLoading(true);
    try {
      await unbindWechatClawDBot();
      setQrImageUrl("");
      setMessage("已取消绑定。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "解绑失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  const bound = bindings.some((item) => item.channelType === "wechat_clawdbot" && item.status === "active");

  return (
    <SettingsGroup title="微信 ClawDBot">
      <View style={styles.wechatBox}>
        <Text style={styles.settingsCellTitle}>状态：{bound ? "已绑定" : "未绑定"}</Text>
        <Text style={styles.settingsCellValue}>{message}</Text>
        {qrImageUrl ? <View style={styles.qrPlaceholder}><Text style={styles.qrText}>二维码已生成</Text><Text style={styles.qrPayload}>{qrImageUrl.slice(0, 54)}…</Text></View> : null}
        <View style={styles.inlineActions}>
          <Pressable style={styles.primaryButton} onPress={createQr} disabled={loading}><Text style={styles.primaryButtonText}>{bound ? "重新生成" : "生成二维码"}</Text></Pressable>
          {bound ? <Pressable style={styles.secondaryButton} onPress={unbind}><Text style={styles.secondaryButtonText}>取消绑定</Text></Pressable> : null}
        </View>
      </View>
    </SettingsGroup>
  );
}

function ProfileScreen({ user, onLogout, onRefreshAuth, nativeNav = false, edgeToEdge = false }: { user: MiniappUser; onLogout: () => void; onRefreshAuth: () => void; nativeNav?: boolean; edgeToEdge?: boolean }) {
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<ProfileRoute>("main");
  const [loggingOut, setLoggingOut] = useState(false);

  const submitLogout = async () => {
    hapticSelection();
    setLoggingOut(true);
    try {
      if (getSessionToken()) await logout();
    } catch {
      // 本地退出必须可用，远端会话清理失败不阻断用户重新登录。
    } finally {
      clearAuthState();
      notifyNativeAuthState(false);
      hapticNotification("success");
      setLoggingOut(false);
      onLogout();
    }
  };

  const openSubscriptions = () => {
    hapticSelection();
    if (nativeNav && pushNativeScreen("subscriptions", "我的订阅")) return;
    smoothLayout();
    setRoute("subscriptions");
  };

  if (route === "subscriptions") {
    return <SubscriptionManagerScreen onBack={() => {
      hapticSelection();
      smoothLayout();
      setRoute("main");
    }} />;
  }

  return (
    <View style={styles.settingsRoot}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: edgeToEdge ? insets.top : 0, bottom: edgeToEdge ? edgeBottomBarInset(insets.bottom, IOS_NATIVE_TAB_BAR_HEIGHT, 8) : 0 }}
        contentContainerStyle={[
          styles.settingsContent,
          edgeToEdge ? {
            paddingTop: edgeTopInset(insets.top, 12),
            paddingBottom: edgeBottomBarInset(insets.bottom, IOS_NATIVE_TAB_BAR_HEIGHT, 24),
          } : undefined,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loggingOut} onRefresh={onRefreshAuth} />}
      >
        <Text style={styles.settingsLargeTitle}>我的</Text>
        <SettingsGroup title="账号">
          <SettingsCell title="昵称" value={user.nickname || user.name || "未设置"} onPress={() => {
            Alert.prompt?.("修改昵称", "输入新的昵称", async (value) => {
              if (!value?.trim()) return;
              await updateAuthProfile({ nickname: value.trim() });
              onRefreshAuth();
            });
          }} />
          <SettingsCell title="账号" value={user.accountName || user.studentNo || "未设置"} />
          <SettingsCell title="班级" value={user.classLabel || "未设置"} />
        </SettingsGroup>

        <SettingsGroup title="日程">
          <SettingsCell title="我的订阅" value="管理" onPress={openSubscriptions} />
          <SettingsCell title="日程表" value="可切换课表模式" />
        </SettingsGroup>

        <ReminderManagerScreen />
        <WechatBindingScreen />

        <SettingsGroup title="应用">
          <SettingsCell title="刷新登录态" value="重新校验" onPress={() => {
            hapticImpact("light");
            onRefreshAuth();
          }} />
          <SettingsCell title="外观" value="浅色" />
        </SettingsGroup>

        <SettingsGroup title=" ">
          <SettingsCell
            title={loggingOut ? "退出中…" : "退出登录"}
            destructive
            onPress={() => {
              hapticImpact("medium");
              Alert.alert("退出登录", "确认退出当前账号？", [
                { text: "取消", style: "cancel" },
                { text: "退出", style: "destructive", onPress: submitLogout },
              ]);
            }}
          />
        </SettingsGroup>
      </ScrollView>
    </View>
  );
}

function AppContent({ tabKey, nativeTabBar = false, nativeStackScreen }: AppProps) {
  const loginRoot = isLoginRoot(tabKey);
  const initialTab = resolveTabKey(tabKey);
  const [fallbackTab, setFallbackTab] = useState<TabKey>(initialTab);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [authUser, setAuthUser] = useState<MiniappUser | null>(getStoredUser());
  const [authChecking, setAuthChecking] = useState(Boolean(getSessionToken() && !getStoredUser()));
  const activeTab = nativeTabBar ? initialTab : fallbackTab;
  const useAndroidNativeTabBar = !nativeTabBar && Platform.OS === "android" && isNativeLiquidTabBarAvailable();

  const bumpRefresh = () => setRefreshSignal((value) => value + 1);

  const refreshAuth = async () => {
    if (!getSessionToken()) {
      setAuthUser(null);
      setAuthChecking(false);
      return;
    }
    setAuthChecking(true);
    try {
      const data = await getAuthMe();
      setStoredUser(data.user);
      setAuthUser(data.user);
      bumpRefresh();
    } catch {
      clearAuthState();
      setAuthUser(null);
    } finally {
      setAuthChecking(false);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeAuthState((authenticated) => {
      if (authenticated) {
        setAuthUser(getStoredUser());
        bumpRefresh();
        void refreshAuth();
        return;
      }
      clearAuthState();
      setAuthUser(null);
      bumpRefresh();
    });
    return unsubscribe;
  }, []);

  useEffect(() => { void refreshAuth(); }, []);

  const handleLoggedIn = (user: MiniappUser) => {
    setAuthUser(user);
    bumpRefresh();
  };

  const handleLogout = () => {
    setAuthUser(null);
    bumpRefresh();
  };

  if (authChecking && !authUser) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        <View style={styles.loadingScreen}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>正在检查登录状态…</Text></View>
      </View>
    );
  }

  if (nativeStackScreen === "subscriptions") {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        <SubscriptionManagerScreen nativeNav edgeToEdge={nativeTabBar} />
      </View>
    );
  }

  if (loginRoot) {
    return <LoginScreen onLoggedIn={handleLoggedIn} />;
  }

  if (!authUser || !getSessionToken()) {
    return <View style={styles.authRequiredPlaceholder} />;
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <View style={styles.frame}>
        {activeTab === "today" ? <TodayScreen refreshSignal={refreshSignal} edgeToEdge={nativeTabBar} /> : null}
        {activeTab === "schedule" ? <ScheduleScreen refreshSignal={refreshSignal} edgeToEdge={nativeTabBar} /> : null}
        {activeTab === "profile" ? <ProfileScreen user={authUser} onLogout={handleLogout} onRefreshAuth={() => void refreshAuth()} nativeNav={nativeTabBar} edgeToEdge={nativeTabBar} /> : null}

        {!nativeTabBar ? (
          useAndroidNativeTabBar ? (
            <NativeLiquidTabBar
              style={styles.nativeLiquidTabBar}
              selectedIndex={tabItems.findIndex((item) => item.key === fallbackTab)}
              labels={tabItems.map((item) => item.label)}
              onTabPress={(index) => {
                hapticSelection();
                smoothLayout();
                setFallbackTab(tabItems[index]?.key || "today");
              }}
              accentColor={colors.accent}
              textColor={colors.text}
              mutedColor={colors.subText}
              surfaceColor="rgba(255,255,255,0.90)"
            />
          ) : (
            <View style={styles.jsTabBar}>
              {tabItems.map((item) => {
                const selected = fallbackTab === item.key;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      hapticSelection();
                      smoothLayout();
                      setFallbackTab(item.key);
                    }}
                    style={styles.jsTabItem}
                  >
                    <Text style={[styles.jsTabText, selected ? styles.jsTabTextActive : undefined]}>{item.label}</Text>
                    <View style={[styles.jsTabLine, selected ? styles.jsTabLineActive : undefined]} />
                  </Pressable>
                );
              })}
            </View>
          )
        ) : null}
      </View>
    </View>
  );
}

export default function App(props: AppProps) {
  return (
    <SafeAreaProvider>
      <AppContent {...props} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  frame: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: colors.subText,
    fontSize: 14,
  },
  authRequiredPlaceholder: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loginRoot: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: colors.groupedBackground,
    paddingHorizontal: 24,
  },
  loginCard: {
    borderRadius: 28,
    backgroundColor: colors.card,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  loginMark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  loginMarkText: {
    color: colors.onAccent,
    fontSize: 30,
    fontWeight: "900",
  },
  loginTitle: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  loginSubtitle: {
    marginTop: 8,
    marginBottom: 10,
    color: colors.subText,
    fontSize: 15,
    lineHeight: 22,
  },
  loginInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.groupedBackground,
    color: colors.text,
    paddingHorizontal: 14,
    marginTop: 12,
    fontSize: 16,
  },
  loginButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  loginButtonText: {
    color: colors.onAccent,
    fontSize: 16,
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.6,
  },
  authSegment: {
    flexDirection: "row",
    backgroundColor: colors.groupedBackground,
    borderRadius: 14,
    padding: 4,
    marginTop: 10,
    marginBottom: 2,
  },
  authSegmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  authSegmentItemActive: {
    backgroundColor: colors.card,
  },
  authSegmentText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 36,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 4,
    paddingBottom: 16,
  },
  greetingCopy: { flex: 1 },
  greeting: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1,
  },
  greetingSub: {
    marginTop: 6,
    color: colors.subText,
    fontSize: 13,
    lineHeight: 18,
  },
  roundIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  roundIconText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  androidCard: {
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  sectionSub: {
    marginTop: 6,
    color: colors.subText,
    fontSize: 13,
    lineHeight: 19,
  },
  tip: {
    marginTop: 12,
    color: colors.subText,
    fontSize: 14,
  },
  pill: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    color: colors.subText,
    fontSize: 12,
    marginTop: 8,
  },
  pillActive: {
    borderColor: colors.strongLine,
    color: colors.strongLine,
    fontWeight: "700",
  },
  lessonHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  lessonTitle: {
    color: colors.subText,
    fontSize: 14,
    opacity: 0.75,
  },
  lessonCount: {
    color: colors.subText,
    fontSize: 13,
    fontWeight: "700",
  },
  lessonList: {
    gap: 10,
    paddingRight: 16,
    paddingBottom: 14,
  },
  lessonItem: {
    width: 176,
    minHeight: 82,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  lessonMark: {
    width: 4,
    borderRadius: 999,
  },
  lessonMain: {
    flex: 1,
    minWidth: 0,
  },
  lessonName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  lessonReminder: {
    marginTop: 5,
    color: colors.subText,
    fontSize: 12,
    lineHeight: 17,
  },
  lessonTime: {
    color: colors.subText,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyInline: {
    color: colors.subText,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingBottom: 14,
  },
  eventCard: {
    marginTop: 12,
    minHeight: 70,
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  eventMark: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 999,
  },
  eventMain: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 21,
  },
  eventMeta: {
    marginTop: 5,
    color: colors.subText,
    fontSize: 12,
    lineHeight: 17,
  },
  eventType: {
    fontSize: 12,
    fontWeight: "800",
  },
  input: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.muted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    color: colors.text,
    paddingHorizontal: 14,
    marginTop: 12,
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: colors.strongLine,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginTop: 12,
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: colors.muted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  todoRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: eventTypeSoftColors.todo,
  },
  todoMain: { flex: 1, minWidth: 0 },
  todoTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  todoMeta: { marginTop: 4, color: colors.subText, fontSize: 12 },
  scheduleScreen: {
    flex: 1,
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  weekHeader: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    gap: 10,
  },
  weekButton: {
    width: 42,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  weekButtonText: { color: colors.text, fontSize: 30, lineHeight: 32 },
  weekTitleWrap: { flex: 1, alignItems: "center" },
  weekTitle: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  weekSubtitle: { marginTop: 2, color: colors.subText, fontSize: 12 },
  scheduleToolbar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  modeButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  modeButtonActive: {
    backgroundColor: colors.card,
    borderColor: colors.accent,
  },
  modeButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  scheduleSettingsCard: {
    marginBottom: 10,
  },
  settingsInlineRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchPill: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 14,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  switchPillActive: {
    backgroundColor: colors.successSoft,
  },
  switchPillText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  inlineActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    alignItems: "center",
  },
  timelineScroll: {
    flex: 1,
  },
  timelineContent: {
    paddingBottom: 24,
  },
  timelineDay: {
    marginBottom: 18,
  },
  timelineDayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  timelineDayTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  timelineDayCount: {
    color: colors.subText,
    fontSize: 12,
  },
  timelineEvent: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  timelineTimeRail: {
    width: 52,
    alignItems: "flex-end",
    paddingTop: 14,
  },
  timelineTimeMain: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  timelineTimeSub: {
    marginTop: 2,
    color: colors.subText,
    fontSize: 10,
  },
  timelineEventCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    overflow: "hidden",
  },
  timelineEventMark: {
    position: "absolute",
    left: 0,
    top: 12,
    bottom: 12,
    width: 4,
    borderRadius: 4,
  },
  expandedBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  expandHint: {
    marginTop: 6,
    color: colors.secondaryText,
    fontSize: 11,
  },
  tableWrap: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: colors.muted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  tableRowHead: { minHeight: 58, flexDirection: "row" },
  tableRow: { minHeight: 74, flexDirection: "row" },
  timeCol: {
    width: 58,
    backgroundColor: eventTypeSoftColors.course,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  dayCol: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 3,
  },
  headCell: { backgroundColor: colors.muted },
  headText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  todayColumn: { backgroundColor: colors.todayColumn },
  todayHeadText: { color: colors.green },
  sectionNo: { color: colors.text, fontSize: 13, fontWeight: "800" },
  sectionTime: { marginTop: 2, color: colors.subText, fontSize: 10 },
  cell: {},
  cellCard: {
    width: "100%",
    minHeight: 64,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
  },
  cellTitle: { color: colors.text, fontSize: 10.5, fontWeight: "800", textAlign: "center", lineHeight: 14 },
  cellRoom: { marginTop: 2, color: colors.subText, fontSize: 9, textAlign: "center" },
  settingsRoot: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  settingsContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 36,
  },
  nativeNavContent: {
    paddingTop: 18,
  },
  settingsLargeTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: colors.text,
    marginBottom: 18,
    letterSpacing: -0.8,
  },
  settingsGroupWrap: {
    marginBottom: 22,
  },
  settingsGroupTitle: {
    marginLeft: 16,
    marginBottom: 7,
    color: colors.secondaryText,
    fontSize: 13,
    textTransform: "uppercase",
  },
  settingsGroup: {
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  settingsCell: {
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  settingsCellTitle: {
    flexShrink: 0,
    color: colors.text,
    fontSize: 16,
  },
  settingsCellRight: {
    marginLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  settingsCellValue: {
    color: colors.secondaryText,
    fontSize: 14,
  },
  settingsChevron: {
    marginLeft: 8,
    color: colors.secondaryText,
    fontSize: 24,
    lineHeight: 24,
  },
  destructiveText: {
    color: colors.red,
  },
  settingsFooter: {
    marginHorizontal: 16,
    marginBottom: 10,
    color: colors.secondaryText,
    fontSize: 13,
    lineHeight: 18,
  },
  settingsNavBar: {
    minHeight: 54,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.groupedBackground,
  },
  settingsNavTitle: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  backButton: {
    zIndex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backButtonText: {
    color: colors.accent,
    fontSize: 18,
  },
  navRightButton: {
    zIndex: 1,
    minWidth: 52,
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  navRightText: {
    color: colors.accent,
    fontSize: 16,
  },
  sourceCell: {
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  sourceMain: {
    flex: 1,
    minWidth: 0,
  },
  smallInput: {
    width: 58,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: colors.muted,
    color: colors.text,
    paddingHorizontal: 8,
    marginHorizontal: 8,
    textAlign: "center",
  },
  wechatBox: {
    padding: 16,
    gap: 8,
  },
  qrPlaceholder: {
    marginTop: 8,
    minHeight: 120,
    borderRadius: 16,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  qrText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  qrPayload: {
    marginTop: 6,
    color: colors.secondaryText,
    fontSize: 11,
    textAlign: "center",
  },
  subscribeButton: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  subscribeButtonDisabled: {
    backgroundColor: colors.muted,
  },
  subscribeButtonText: {
    color: colors.onAccent,
    fontSize: 13,
    fontWeight: "700",
  },
  subscribeButtonTextDisabled: {
    color: colors.secondaryText,
  },
  nativeLiquidTabBar: {
    height: 88,
    backgroundColor: "transparent",
  },
  jsTabBar: {
    minHeight: 72,
    paddingBottom: Platform.OS === "ios" ? 10 : 0,
    flexDirection: "row",
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  jsTabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 20,
    gap: 7,
  },
  jsTabText: {
    color: colors.subText,
    fontSize: 13,
  },
  jsTabTextActive: {
    color: colors.text,
    fontWeight: "800",
  },
  jsTabLine: {
    width: 22,
    height: 4,
    borderRadius: 4,
    opacity: 0,
    backgroundColor: colors.strongLine,
  },
  jsTabLineActive: {
    opacity: 1,
  },
});
