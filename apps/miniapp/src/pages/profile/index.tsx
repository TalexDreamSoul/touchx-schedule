import { View, Text, Button } from "@tarojs/components";

export default function ProfilePage() {
  return (
    <View className="tx-page">
      <View className="tx-hero">
        <Text className="tx-kicker">Profile</Text>
        <Text className="tx-title">我的</Text>
        <Text className="tx-subtitle">登录态、提醒绑定、主题偏好与个人 Todo 入口。</Text>
      </View>
      <View className="tx-card">
        <Text className="tx-card-title">未登录</Text>
        <Text className="tx-muted">后续复用 @touchx/api-client 接入 auth/me。</Text>
        <View className="tx-pill-row">
          <Button className="tx-button">模拟登录</Button>
        </View>
      </View>
    </View>
  );
}
