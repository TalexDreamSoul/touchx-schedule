import { useEffect, useMemo, useState } from "react";
import { View, Text, Button, Input, Picker, ScrollView } from "@tarojs/components";
import {
  archivePersonalEvent,
  createPersonalEvent,
  getSessionToken,
  listMyEffectiveCalendar,
  listPersonalEvents,
  markPersonalEventDone,
  updatePersonalEvent,
  type EffectiveCalendarItem,
  type PersonalEventRow,
} from "../../lib/api";
import {
  eventTypeLabels,
  formatEventDateTime,
  formatEventTime,
  formatPersonalEventTime,
  formatSectionRange,
  getEventClassName,
  getEventLocation,
  getEventTeacher,
  getEventType,
  getTodayInfo,
  isArchivedPersonalEvent,
  isDonePersonalEvent,
  isEventFutureOrOngoing,
  priorityLabel,
  resolveSemesterElapsed,
  sectionTimes,
  sortEvents,
  weekdayLabels,
} from "../../lib/schedule";
import { miniappPageThemeStyles } from "../../lib/theme";

type InputEvent = { detail: { value: string } };
type PickerEvent = { detail: { value: string | number } };

const priorityOptions = ["normal", "high", "low"] as const;
const priorityPickerLabels = ["普通", "高优先级", "低优先级"];

const resolveGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
};

const isCourseLike = (event: EffectiveCalendarItem) => getEventType(event) === "course";

export default function TodayPage() {
  const todayInfo = useMemo(() => getTodayInfo(), []);
  const [events, setEvents] = useState<EffectiveCalendarItem[]>([]);
  const [todoItems, setTodoItems] = useState<PersonalEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("登录后展示课程、订阅日程与个人 Todo。");
  const [todoTitle, setTodoTitle] = useState("");
  const [todoWeekday, setTodoWeekday] = useState(Math.max(0, todayInfo.weekday - 1));
  const [todoPriority, setTodoPriority] = useState<(typeof priorityOptions)[number]>("normal");
  const [editingTodoId, setEditingTodoId] = useState("");

  const sortedEvents = useMemo(() => sortEvents(events), [events]);
  const todayCourses = useMemo(() => sortedEvents.filter(isCourseLike), [sortedEvents]);
  const pendingCourses = useMemo(() => todayCourses.filter((item) => isEventFutureOrOngoing(item)), [todayCourses]);
  const nonCourseEvents = useMemo(() => sortedEvents.filter((item) => !isCourseLike(item)), [sortedEvents]);
  const semesterElapsed = useMemo(() => resolveSemesterElapsed(), []);
  const todaySectionLoad = todayCourses.reduce((sum, item) => sum + Math.max(1, Number(item.endSection || item.startSection || 1) - Number(item.startSection || 1) + 1), 0);

  const load = async () => {
    if (!getSessionToken()) {
      setEvents([]);
      setTodoItems([]);
      setMessage("请先到“我的”完成学号登录。");
      return;
    }
    setLoading(true);
    try {
      const [calendar, personal] = await Promise.all([
        listMyEffectiveCalendar({ date: todayInfo.dateKey }),
        listPersonalEvents(),
      ]);
      const activeTodos = (personal.items || []).filter((item) => !isDonePersonalEvent(item) && !isArchivedPersonalEvent(item));
      setEvents(calendar.items || []);
      setTodoItems(activeTodos);
      setMessage(`今天 ${calendar.items?.length || 0} 条日程，${activeTodos.length} 个待办`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
      setEvents([]);
      setTodoItems([]);
    } finally {
      setLoading(false);
    }
  };

  const resetTodoForm = () => {
    setEditingTodoId("");
    setTodoTitle("");
    setTodoWeekday(Math.max(0, todayInfo.weekday - 1));
    setTodoPriority("normal");
  };

  const editTodo = (item: PersonalEventRow) => {
    const day = Math.max(1, Math.min(7, Number(item.weekday || item.day || todayInfo.weekday)));
    setEditingTodoId(item.id);
    setTodoTitle(item.title || "");
    setTodoWeekday(day - 1);
    setTodoPriority(item.priorityLabel === "high" || item.priorityLabel === "low" ? item.priorityLabel : "normal");
    setMessage("正在编辑 Todo。");
  };

  const saveTodo = async () => {
    if (!getSessionToken()) {
      setMessage("请先到“我的”完成学号登录。");
      return;
    }
    if (!todoTitle.trim()) {
      setMessage("请输入 Todo 标题。");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        title: todoTitle.trim(),
        eventType: "todo" as const,
        weekday: todoWeekday + 1,
        startSection: 1,
        endSection: 1,
        priority: todoPriority,
        tags: ["个人", "todo"],
      };
      if (editingTodoId) {
        await updatePersonalEvent(editingTodoId, payload);
        setMessage("Todo 已更新。");
      } else {
        await createPersonalEvent(payload);
        setMessage("Todo 已创建。");
      }
      resetTodoForm();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const done = async (id: string) => {
    setLoading(true);
    try {
      await markPersonalEventDone(id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "完成失败");
    } finally {
      setLoading(false);
    }
  };

  const archive = async (id: string) => {
    setLoading(true);
    try {
      await archivePersonalEvent(id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "归档失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <View className="tx-page" style={miniappPageThemeStyles.green}>
      <View className="tx-safe-top">
        <Text className="tx-safe-title">今日</Text>
      </View>
      <View className="tx-scroll-page">
        <View className="tx-greeting-row">
          <View>
            <Text className="tx-greeting-main">{resolveGreeting()}</Text>
            <Text className="tx-greeting-sub">第 {todayInfo.week} 周 · 周{todayInfo.weekdayLabel} · {todayInfo.dateKey}</Text>
          </View>
          <View className="tx-icon-btn">🍽️</View>
        </View>

        <View className="tx-lesson-widget-block">
          <View className="tx-lesson-widget-head">
            <Text className="tx-lesson-widget-title">今日待上课程</Text>
            <Text className="tx-lesson-widget-count">{getSessionToken() ? `${pendingCourses.length} 门` : "待授权"}</Text>
          </View>
          {!getSessionToken() ? <View className="tx-auth-gate-line">去“我的”登录后同步课表</View> : null}
          {getSessionToken() && pendingCourses.length > 0 ? (
            <ScrollView scrollX className="tx-lesson-widget-scroll" showScrollbar={false}>
              <View className="tx-lesson-widget-list">
                {pendingCourses.map((event, index) => {
                  const type = getEventType(event);
                  return (
                    <View className={`tx-lesson-widget-item ${getEventClassName(type)}`} key={event.id || `${event.title}-${index}`}>
                      <View className="tx-lesson-widget-mark" />
                      <View className="tx-lesson-widget-main">
                        <Text className="tx-lesson-widget-name">{event.title || "未命名课程"}</Text>
                        <Text className="tx-lesson-widget-reminder">{getEventLocation(event)} · {formatSectionRange(event.startSection, event.endSection)}</Text>
                      </View>
                      <View className="tx-lesson-widget-time">
                        <Text>{event.startTime || sectionTimes.find((item) => item.section === event.startSection)?.start || "--:--"}</Text>
                        <Text>{event.endTime || sectionTimes.find((item) => item.section === event.endSection)?.end || "--:--"}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}
          {getSessionToken() && pendingCourses.length <= 0 ? <Text className="tx-empty-small">今天暂无待上课程。</Text> : null}
        </View>

        <View className="tx-card">
          <View className="tx-card-head">
            <View>
              <Text className="tx-section-title">今日课程</Text>
              <Text className="tx-section-sub">{getSessionToken() ? `今天有 ${todayCourses.length} 门课，共 ${todaySectionLoad} 节` : message}</Text>
            </View>
            <Button className="tx-button tx-button-compact" loading={loading} onClick={load}>刷新</Button>
          </View>
          {todayCourses.length <= 0 ? <Text className="tx-tip">{getSessionToken() ? "今天没有安排课程。" : "登录后这里会按旧版样式展示课程。"}</Text> : null}
          {todayCourses.map((event, index) => {
            const type = getEventType(event);
            const teacher = getEventTeacher(event);
            return (
              <View className={`tx-event-card ${getEventClassName(type)}`} key={event.id || `${event.title}-${index}`}>
                <Text className="tx-event-title">{event.title || "未命名课程"}</Text>
                <Text className="tx-event-meta">{formatEventTime(event)} · {getEventLocation(event)}</Text>
                {teacher ? <Text className="tx-event-meta">教师：{teacher}</Text> : null}
              </View>
            );
          })}
        </View>

        {nonCourseEvents.length > 0 ? (
          <View className="tx-card">
            <Text className="tx-section-title">今日优先事项</Text>
            <Text className="tx-section-sub">课程之外的考试、活动和个人日程</Text>
            {nonCourseEvents.map((event, index) => {
              const type = getEventType(event);
              return (
                <View className={`tx-event-card ${getEventClassName(type)}`} key={event.id || `${event.title}-${index}`}>
                  <Text className="tx-event-title">{event.title || "未命名日程"}</Text>
                  <Text className="tx-event-meta">{eventTypeLabels[type]} · {formatEventDateTime(event)} · {getEventLocation(event)}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View className="tx-card">
          <Text className="tx-section-title">{editingTodoId ? "编辑 Todo" : "新增 Todo"}</Text>
          <Text className="tx-section-sub">个人事项会进入今日/周视图合成</Text>
          <Input
            className="tx-input"
            value={todoTitle}
            placeholder="例如：复习数据结构"
            onInput={(event: InputEvent) => setTodoTitle(event.detail.value)}
          />
          <View className="tx-form-grid">
            <Picker mode="selector" range={weekdayLabels.map((item) => `周${item}`)} value={todoWeekday} onChange={(event: PickerEvent) => setTodoWeekday(Number(event.detail.value) || 0)}>
              <View className="tx-select">周{weekdayLabels[todoWeekday]}</View>
            </Picker>
            <Picker
              mode="selector"
              range={priorityPickerLabels}
              value={priorityOptions.indexOf(todoPriority)}
              onChange={(event: PickerEvent) => setTodoPriority(priorityOptions[Number(event.detail.value)] || "normal")}
            >
              <View className="tx-select">{priorityLabel(todoPriority)}</View>
            </Picker>
          </View>
          <View className="tx-action-row">
            <Button className="tx-button" loading={loading} onClick={saveTodo}>{editingTodoId ? "保存 Todo" : "创建 Todo"}</Button>
            {editingTodoId ? <Button className="tx-button tx-button-secondary" loading={loading} onClick={resetTodoForm}>取消编辑</Button> : null}
          </View>
        </View>

        <View className="tx-card">
          <Text className="tx-section-title">个人 Todo</Text>
          <Text className="tx-section-sub">{todoItems.length > 0 ? `${todoItems.length} 个待办等待完成` : "暂无待办"}</Text>
          {todoItems.map((item) => (
            <View className="tx-event-card event-todo" key={item.id}>
              <Text className="tx-event-title">{item.title}</Text>
              <Text className="tx-event-meta">{formatPersonalEventTime(item)} · {priorityLabel(item.priorityLabel)}</Text>
              <View className="tx-action-row">
                <Button className="tx-button tx-button-secondary tx-button-compact" loading={loading} onClick={() => editTodo(item)}>编辑</Button>
                <Button className="tx-button tx-button-compact" loading={loading} onClick={() => void done(item.id)}>完成</Button>
                <Button className="tx-button tx-button-secondary tx-button-compact" loading={loading} onClick={() => void archive(item.id)}>归档</Button>
              </View>
            </View>
          ))}
        </View>

        <View className="tx-card">
          <View className="tx-card-head">
            <View>
              <Text className="tx-section-title">我的加入</Text>
              <Text className="tx-section-sub">你已经开学 {semesterElapsed.totalDays} 天 {semesterElapsed.totalWeeks} 周 {semesterElapsed.totalHours} 小时</Text>
            </View>
          </View>
          <Text className="tx-tip">* 以 3 月 1 日早上 8:00 作为起始计时</Text>
        </View>
      </View>
    </View>
  );
}
