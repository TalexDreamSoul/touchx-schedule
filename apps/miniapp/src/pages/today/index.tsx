import { View, Text } from "@tarojs/components";
import { calendarEventColors } from "@touchx/ui-tokens";

const events = [
  { title: "高等数学", time: "08:30 - 10:05", location: "教学楼 A201", type: "course" as const },
  { title: "完成英语 Todo", time: "今天", location: "个人事项", type: "todo" as const },
];

export default function TodayPage() {
  return (
    <View className="tx-page">
      <View className="tx-hero">
        <Text className="tx-kicker">TouchX Calendar</Text>
        <Text className="tx-title">今日视图</Text>
        <Text className="tx-subtitle">Taro React 小程序骨架，后续接入 /api/v1/calendar/me/effective。</Text>
      </View>
      {events.map((event) => (
        <View className="tx-card" key={event.title}>
          <Text className="tx-card-title">{event.title}</Text>
          <Text className="tx-muted">{event.time} · {event.location}</Text>
          <View className="tx-pill-row">
            <Text className="tx-pill" style={{ color: calendarEventColors[event.type] }}>{event.type}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
