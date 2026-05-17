import { View, Text } from "@tarojs/components";

const sources = ["班级课表", "考试安排", "社团活动"];

export default function SourcesPage() {
  return (
    <View className="tx-page">
      <View className="tx-hero">
        <Text className="tx-kicker">Sources</Text>
        <Text className="tx-title">日程源订阅</Text>
        <Text className="tx-subtitle">CalendarSource 是新核心，课表只是其中一种源。</Text>
      </View>
      {sources.map((source) => (
        <View className="tx-card" key={source}>
          <Text className="tx-card-title">{source}</Text>
          <Text className="tx-muted">订阅、暂停、版本跟随策略后续接入。</Text>
        </View>
      ))}
    </View>
  );
}
