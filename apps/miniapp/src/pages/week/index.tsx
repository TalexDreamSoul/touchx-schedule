import { useEffect, useMemo, useState } from "react";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { View, Text, Button, Picker, ScrollView, Switch, Input } from "@tarojs/components";
import {
  getCalendarSettings,
  getSessionToken,
  listMyEffectiveCalendar,
  updateCalendarSettings,
  type EffectiveCalendarItem,
} from "../../lib/api";
import {
  eventTypeLabels,
  formatDateLabel,
  formatEventDateTime,
  formatEventTime,
  formatSectionRange,
  formatWeekRange,
  getEventClassName,
  getEventEndSection,
  getEventLocation,
  getEventStartSection,
  getEventType,
  getEventWeekday,
  getTodayInfo,
  resolveDateByWeekday,
  sectionTimes,
  sortEvents,
  termMeta,
  weekdayLabels,
} from "../../lib/schedule";

type PickerEvent = { detail: { value: string | number } };
type InputEvent = { detail: { value: string } };
type SwitchEvent = { detail: { value: boolean } };
type TouchEventLike = { changedTouches?: Array<{ clientX?: number; clientY?: number }>; touches?: Array<{ clientX?: number; clientY?: number }> };

type ViewMode = "timeline" | "course";

const weekOptions = Array.from({ length: termMeta.maxWeek }, (_, index) => `第 ${index + 1} 周`);
const days = [1, 2, 3, 4, 5, 6, 7] as const;

const clampWeek = (value: number) => Math.max(1, Math.min(termMeta.maxWeek, value));

const groupByDate = (items: EffectiveCalendarItem[]) => {
  const map = new Map<string, EffectiveCalendarItem[]>();
  sortEvents(items).forEach((event) => {
    const key = event.date || resolveDateByWeekday(1, getEventWeekday(event));
    map.set(key, [...(map.get(key) || []), event]);
  });
  return Array.from(map.entries()).sort((left, right) => left[0].localeCompare(right[0]));
};

const groupByWeekdayAndSection = (items: EffectiveCalendarItem[]) => {
  const map = new Map<string, EffectiveCalendarItem[]>();
  sortEvents(items).forEach((event) => {
    const key = `${getEventWeekday(event)}-${getEventStartSection(event)}`;
    map.set(key, [...(map.get(key) || []), event]);
  });
  return map;
};

const resolvePeriodLabel = (event: EffectiveCalendarItem) => {
  if (event.startTime || event.endTime) return formatEventTime(event);
  return `${formatSectionRange(event.startSection, event.endSection)} · ${sectionTimes.find((item) => item.section === getEventStartSection(event))?.part || "时间段"}`;
};

export default function WeekPage() {
  const todayInfo = useMemo(() => getTodayInfo(), []);
  const [weekIndex, setWeekIndex] = useState(Math.max(0, todayInfo.week - 1));
  const [events, setEvents] = useState<EffectiveCalendarItem[]>([]);
  const [message, setMessage] = useState("登录后按周展示课程、订阅事件与个人 Todo。");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ViewMode>("timeline");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderOffsetsText, setReminderOffsetsText] = useState("30,15");
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  const weekNo = weekIndex + 1;
  const groupedTimeline = useMemo(() => groupByDate(events), [events]);
  const groupedGrid = useMemo(() => groupByWeekdayAndSection(events), [events]);

  const load = async (targetWeekNo = weekNo) => {
    if (!getSessionToken()) {
      setEvents([]);
      setMessage("请先到“我的”完成账号密码登录。");
      return;
    }
    setLoading(true);
    try {
      const [calendar, settings] = await Promise.all([
        listMyEffectiveCalendar({ week: targetWeekNo }),
        getCalendarSettings().catch(() => null),
      ]);
      setEvents(calendar.items || []);
      if (settings) {
        setReminderEnabled(Boolean(settings.reminderEnabled));
        setReminderOffsetsText((settings.reminderWindowMinutes || [30, 15]).join(","));
      }
      setMessage(`已加载第 ${calendar.week || targetWeekNo} 周 ${calendar.items?.length || 0} 条日程`);
    } catch (error) {
      setEvents([]);
      setMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  };

  const changeWeek = (event: PickerEvent) => {
    const next = Number(event.detail.value) || 0;
    setWeekIndex(next);
    setExpandedIds([]);
    void load(next + 1);
  };

  const shiftWeek = (delta: number) => {
    const nextWeek = clampWeek(weekNo + delta);
    if (nextWeek === weekNo) return;
    setWeekIndex(nextWeek - 1);
    setExpandedIds([]);
    void load(nextWeek);
  };

  const toggleExpand = (event: EffectiveCalendarItem) => {
    const id = event.id || `${event.title}-${event.date}-${event.startSection}`;
    setExpandedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const saveSettings = async () => {
    const offsets = reminderOffsetsText
      .split(/[,，\s]+/)
      .map((item) => Math.trunc(Number(item)))
      .filter((item) => Number.isFinite(item) && item >= 0);
    setLoading(true);
    try {
      await updateCalendarSettings({ reminderEnabled, reminderWindowMinutes: offsets.length > 0 ? offsets : [30, 15] });
      setMessage("日程表配置已保存。");
      setShowSettings(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const onTouchStart = (event: TouchEventLike) => {
    const point = event.changedTouches?.[0] || event.touches?.[0];
    if (point) setTouchStart({ x: Number(point.clientX || 0), y: Number(point.clientY || 0) });
  };

  const onTouchEnd = (event: TouchEventLike) => {
    const point = event.changedTouches?.[0];
    if (!point || !touchStart) return;
    const dx = Number(point.clientX || 0) - touchStart.x;
    const dy = Number(point.clientY || 0) - touchStart.y;
    setTouchStart(null);
    if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      shiftWeek(dx < 0 ? 1 : -1);
    }
  };

  usePullDownRefresh(() => { void load(weekNo); });
  useEffect(() => { void load(weekIndex + 1); }, []);

  const todayColumnIndex = weekNo === todayInfo.week ? todayInfo.weekday - 1 : -1;
  const todayOutlineStyle = todayColumnIndex >= 0
    ? {
        left: `calc(108rpx + (100% - 108rpx) * ${todayColumnIndex} / ${days.length})`,
        width: `calc((100% - 108rpx) / ${days.length})`,
      }
    : { display: "none" };

  return (
    <View className="tx-page theme-green tx-week-page" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <View className="tx-week-header">
        <Button className="tx-setting-btn" onClick={() => setShowSettings((value) => !value)}><View className="tx-gear-icon" /></Button>
        <View className="tx-week-center">
          <Picker mode="selector" range={weekOptions} value={weekIndex} onChange={changeWeek}>
            <View className="tx-week-info">
              <Text className="tx-week-main">第 {weekNo} 周</Text>
              <Text className="tx-week-sub">{formatWeekRange(weekNo)}</Text>
            </View>
          </Picker>
        </View>
        <Button className="tx-setting-btn" loading={loading} onClick={() => void load()}><Text>↻</Text></Button>
      </View>

      <View className="tx-schedule-toolbar">
        <Button className="tx-button tx-button-compact tx-button-secondary" onClick={() => shiftWeek(-1)}>上一周</Button>
        <View className="tx-mode-segment">
          <Text className={`tx-mode-option ${mode === "timeline" ? "tx-mode-option-active" : ""}`} onClick={() => setMode("timeline")}>日程表</Text>
          <Text className={`tx-mode-option ${mode === "course" ? "tx-mode-option-active" : ""}`} onClick={() => setMode("course")}>课表模式</Text>
        </View>
        <Button className="tx-button tx-button-compact tx-button-secondary" onClick={() => shiftWeek(1)}>下一周</Button>
      </View>

      {showSettings ? (
        <View className="tx-card tx-schedule-settings">
          <Text className="tx-section-title">日程表配置</Text>
          <Text className="tx-section-sub">编辑默认提醒、视图模式；系统日历同步可通过 App 导出 ICS 或原生端自动同步。</Text>
          <View className="tx-setting-line">
            <Text className="tx-setting-label">默认提醒</Text>
            <Switch checked={reminderEnabled} onChange={(event: SwitchEvent) => setReminderEnabled(Boolean(event.detail.value))} />
          </View>
          <Input className="tx-input" value={reminderOffsetsText} placeholder="提醒提前分钟，例如 30,15" onInput={(event: InputEvent) => setReminderOffsetsText(event.detail.value)} />
          <View className="tx-action-row">
            <Button className="tx-button" loading={loading} onClick={saveSettings}>保存配置</Button>
            <Button className="tx-button tx-button-secondary" onClick={() => setShowSettings(false)}>收起</Button>
          </View>
        </View>
      ) : null}

      {mode === "course" ? (
        <View className="tx-schedule-card">
          <View className="tx-table-wrap">
            <View className="tx-table-row tx-head-row">
              <View className="tx-time-col tx-head">节次</View>
              {days.map((day) => (
                <View className={`tx-day-col tx-head ${weekNo === todayInfo.week && day === todayInfo.weekday ? "tx-today-column" : ""}`} key={`head-${day}`}>
                  <Text>周{weekdayLabels[day - 1]}</Text>
                </View>
              ))}
            </View>
            {sectionTimes.map((section) => (
              <View className="tx-table-row" key={section.section}>
                <View className="tx-time-col">
                  <Text className="tx-section-no">{section.section}</Text>
                  <Text className="tx-section-time">{section.start}</Text>
                </View>
                {days.map((day) => {
                  const cellEvents = groupedGrid.get(`${day}-${section.section}`) || [];
                  const event = cellEvents[0];
                  const type = event ? getEventType(event) : "custom";
                  return (
                    <View className={`tx-day-col tx-cell ${weekNo === todayInfo.week && day === todayInfo.weekday ? "tx-today-column" : ""} ${event ? "tx-cell-busy" : ""}`} key={`cell-${section.section}-${day}`}>
                      {event ? (
                        <View className={`tx-cell-card ${getEventClassName(type)}`} onClick={() => toggleExpand(event)}>
                          <Text className="tx-cell-title">{event.title || "未命名"}</Text>
                          <Text className="tx-cell-room">{getEventLocation(event)}</Text>
                          {getEventEndSection(event) > getEventStartSection(event) ? <Text className="tx-cell-room">{getEventStartSection(event)}-{getEventEndSection(event)}节</Text> : null}
                          {cellEvents.length > 1 ? <Text className="tx-cell-room">+{cellEvents.length - 1}</Text> : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
            <View className="tx-today-outline" style={todayOutlineStyle} />
          </View>
        </View>
      ) : (
        <ScrollView scrollY className="tx-timeline-scroll" refresherEnabled refresherTriggered={loading} onRefresherRefresh={() => void load()}>
          <View className="tx-card tx-calendar-summary">
            <Text className="tx-section-title">周日程</Text>
            <Text className="tx-section-sub">{message} · 左右滑动切换周，下拉刷新。</Text>
          </View>
          {events.length <= 0 ? <View className="tx-empty-card">暂无日程。登录后订阅/发布日程源或新增 Todo 即可展示。</View> : null}
          {groupedTimeline.map(([dateKey, dayEvents]) => {
            const parsedDate = new Date(`${dateKey}T00:00:00`);
            const weekday = Number.isFinite(parsedDate.getTime()) ? ((parsedDate.getDay() || 7)) : getEventWeekday(dayEvents[0]);
            return (
              <View className="tx-timeline-day" key={dateKey}>
                <View className="tx-timeline-day-head">
                  <Text className="tx-timeline-day-title">周{weekdayLabels[weekday - 1]} · {formatDateLabel(dateKey)}</Text>
                  <Text className="tx-timeline-day-count">{dayEvents.length} 项</Text>
                </View>
                {dayEvents.map((event, index) => {
                  const type = getEventType(event);
                  const id = event.id || `${event.title}-${dateKey}-${index}`;
                  const expanded = expandedIds.includes(id);
                  return (
                    <View className={`tx-timeline-event ${getEventClassName(type)} ${expanded ? "tx-timeline-event-expanded" : ""}`} key={id} onClick={() => toggleExpand(event)}>
                      <View className="tx-time-rail">
                        <Text className="tx-time-main">{event.startTime || sectionTimes.find((item) => item.section === getEventStartSection(event))?.start || "全天"}</Text>
                        <Text className="tx-time-sub">{event.endTime || sectionTimes.find((item) => item.section === getEventEndSection(event))?.end || ""}</Text>
                      </View>
                      <View className="tx-timeline-card">
                        <View className="tx-timeline-card-head">
                          <Text className="tx-event-title">{event.title || "未命名日程"}</Text>
                          <Text className="tx-pill tx-pill-active">{eventTypeLabels[type]}</Text>
                        </View>
                        <Text className="tx-event-meta">{resolvePeriodLabel(event)} · {getEventLocation(event)}</Text>
                        {expanded ? (
                          <View className="tx-event-expand">
                            <Text className="tx-event-meta">完整时间：{formatEventDateTime(event)}</Text>
                            {event.description ? <Text className="tx-event-meta">说明：{event.description}</Text> : null}
                            <Text className="tx-event-meta">来源：{String(event.metadata?.sourceTitle || event.originType || "TouchX")}</Text>
                            <Text className="tx-event-meta">提醒：{event.reminderEnabled ? "已开启" : "已关闭"}</Text>
                          </View>
                        ) : <Text className="tx-expand-hint">点击展开详情</Text>}
                      </View>
                    </View>
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
