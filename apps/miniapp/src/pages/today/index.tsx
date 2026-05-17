import { useEffect, useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import { calendarEventColors } from "@touchx/ui-tokens";
import { getSessionToken, listMyEffectiveCalendar, mockLogin, setSessionToken, setStoredUser } from "../../lib/api";

interface TodayEvent {
  id?: string;
  title?: string;
  location?: string;
  eventType?: keyof typeof calendarEventColors;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  sourceId?: string;
}

const fallbackEvents: TodayEvent[] = [
  { title: "高等数学", startTime: "08:30", endTime: "10:05", location: "教学楼 A201", eventType: "course" },
  { title: "完成英语 Todo", location: "个人事项", eventType: "todo" },
];

const formatTime = (event: TodayEvent) => {
  if (event.startTime || event.endTime) return `${event.startTime || "--:--"} - ${event.endTime || "--:--"}`;
  if (event.startSection || event.endSection) return `第 ${event.startSection || "?"}-${event.endSection || "?"} 节`;
  return "今天";
};

export default function TodayPage() {
  const [events, setEvents] = useState<TodayEvent[]>(fallbackEvents);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("未登录时展示静态样例；点击模拟登录后读取真实日程。");

  const load = async () => {
    if (!getSessionToken()) {
      setEvents(fallbackEvents);
      setMessage("未登录时展示静态样例；点击模拟登录后读取真实日程。");
      return;
    }
    setLoading(true);
    try {
      const data = await listMyEffectiveCalendar();
      setEvents(data.items?.length ? data.items : fallbackEvents);
      setMessage(data.items?.length ? `已加载 ${data.items.length} 条真实日程` : "真实账号暂无今日日程，展示样例。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
      setEvents(fallbackEvents);
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    setLoading(true);
    try {
      const data = await mockLogin({ studentNo: "2305100613", nickname: "TouchX 体验用户", classLabel: "软件工程23(5)班" });
      setSessionToken(data.sessionToken);
      setStoredUser(data.user);
      setMessage("模拟登录成功，正在加载真实日程...");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <View className="tx-page">
      <View className="tx-hero">
        <Text className="tx-kicker">TouchX Calendar</Text>
        <Text className="tx-title">今日视图</Text>
        <Text className="tx-subtitle">{message}</Text>
        <View className="tx-pill-row">
          <Button className="tx-button" loading={loading} onClick={login}>模拟登录</Button>
          <Button className="tx-button tx-button-secondary" loading={loading} onClick={load}>刷新</Button>
        </View>
      </View>
      {events.map((event: TodayEvent, index: number) => {
        const type: keyof typeof calendarEventColors = event.eventType && calendarEventColors[event.eventType] ? event.eventType : "custom";
        return (
          <View className="tx-card" key={event.id || `${event.title}-${index}`}>
            <Text className="tx-card-title">{event.title || "未命名日程"}</Text>
            <Text className="tx-muted">{formatTime(event)} · {event.location || "未设置地点"}</Text>
            <View className="tx-pill-row">
              <Text className="tx-pill" style={{ color: calendarEventColors[type] || calendarEventColors.custom }}>{type}</Text>
              {event.sourceId ? <Text className="tx-pill">{event.sourceId}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
