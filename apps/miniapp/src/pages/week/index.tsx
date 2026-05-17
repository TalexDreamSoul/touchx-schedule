import { View, Text } from "@tarojs/components";

const days = ["一", "二", "三", "四", "五", "六", "日"];

export default function WeekPage() {
  return (
    <View className="tx-page">
      <View className="tx-hero">
        <Text className="tx-kicker">Week</Text>
        <Text className="tx-title">周日程网格</Text>
        <Text className="tx-subtitle">核心日历 UI 分端实现，小程序使用 Taro 原生组件。</Text>
      </View>
      <View className="tx-card">
        <Text className="tx-card-title">第 12 周</Text>
        <View className="tx-pill-row">
          {days.map((day) => (
            <Text className="tx-pill" key={day}>周{day}</Text>
          ))}
        </View>
        <Text className="tx-muted">下一步实现滚动课表网格、冲突标识与个人覆盖。</Text>
      </View>
    </View>
  );
}
