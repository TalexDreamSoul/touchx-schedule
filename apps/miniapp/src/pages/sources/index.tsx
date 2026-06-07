import { useEffect, useState } from "react";
import { View, Text, Button, Input, Picker } from "@tarojs/components";
import {
  cancelCalendarSubscription,
  getSessionToken,
  listCalendarSources,
  listMyCalendarSubscriptions,
  subscribeCalendarSource,
  upsertCalendarSource,
  type CalendarSourceRow,
  type CalendarSubscriptionRow,
} from "../../lib/api";
import { miniappPageThemeStyles } from "../../lib/theme";

type InputEvent = { detail: { value: string } };
type PickerEvent = { detail: { value: string | number } };

const customTypeOptions = ["custom", "activity", "exam", "deadline"] as const;
const customTypeLabels = ["普通日程", "活动", "考试", "截止日期"];

const sourceTypeLabel = (type: string) => {
  if (type === "class_schedule") return "班级课表";
  if (type === "exam_schedule") return "考试安排";
  if (type === "club_activity") return "社团活动";
  if (type === "school_calendar") return "校历";
  return type || "日程源";
};

export default function SourcesPage() {
  const [sources, setSources] = useState<CalendarSourceRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<CalendarSubscriptionRow[]>([]);
  const [subscribedSourceIds, setSubscribedSourceIds] = useState<string[]>([]);
  const [message, setMessage] = useState("CalendarSource 是新核心，课表只是其中一种源。");
  const [loading, setLoading] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [customTypeIndex, setCustomTypeIndex] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listCalendarSources();
      const subscriptionData = getSessionToken() ? await listMyCalendarSubscriptions() : { items: [] };
      setSources(data.items || []);
      setSubscriptions(subscriptionData.items || []);
      setSubscribedSourceIds((subscriptionData.items || []).map((item) => item.sourceId));
      setMessage(data.items?.length ? `已加载 ${data.items.length} 个日程源` : "暂无可订阅日程源。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
      setSources([]);
      setSubscriptions([]);
      setSubscribedSourceIds([]);
    } finally {
      setLoading(false);
    }
  };

  const subscribe = async (sourceId: string) => {
    if (!getSessionToken()) {
      setMessage("请先到“我的”完成账号密码登录。");
      return;
    }
    setLoading(true);
    try {
      const result = await subscribeCalendarSource(sourceId);
      setMessage(result.duplicated ? "此前已订阅该日程源。" : "订阅成功，今日/日程表会自动合成。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "订阅失败");
    } finally {
      setLoading(false);
    }
  };

  const cancel = async (subscriptionId: string) => {
    setLoading(true);
    try {
      await cancelCalendarSubscription(subscriptionId);
      setMessage("已取消订阅。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消订阅失败");
    } finally {
      setLoading(false);
    }
  };

  const publishCustom = async () => {
    if (!getSessionToken()) {
      setMessage("请先登录后发布自定义日程源。");
      return;
    }
    if (!customTitle.trim()) {
      setMessage("请输入自定义日程标题。");
      return;
    }
    setLoading(true);
    try {
      const type = customTypeOptions[customTypeIndex] || "custom";
      await upsertCalendarSource({
        title: `${customTitle.trim()}合集`,
        description: "小程序自定义发布",
        type: type === "activity" ? "club_activity" : type === "exam" ? "exam_schedule" : "manual_collection",
        visibility: "public",
        events: [{
          title: customTitle.trim(),
          eventType: type,
          weekday: 1,
          startSection: 1,
          endSection: 1,
          weekExpr: "1-25",
          location: customLocation.trim(),
        }],
        publish: true,
      });
      setCustomTitle("");
      setCustomLocation("");
      setShowPublish(false);
      setMessage("自定义日程源已发布，可被订阅。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <View className="tx-page" style={miniappPageThemeStyles.green}>
      <View className="tx-safe-top">
        <Text className="tx-safe-title">订阅</Text>
      </View>
      <View className="tx-scroll-page">
        <View className="tx-greeting-row">
          <View>
            <Text className="tx-greeting-main">日程源</Text>
            <Text className="tx-greeting-sub">{message}</Text>
          </View>
          <View className="tx-icon-btn" onClick={() => setShowPublish((value) => !value)}>+</View>
        </View>

        {showPublish ? (
          <View className="tx-card">
            <Text className="tx-section-title">自定义发布</Text>
            <Text className="tx-section-sub">发布一个公开日程源，其他账号可以订阅。</Text>
            <Input className="tx-input" value={customTitle} placeholder="日程标题，例如：社团例会" onInput={(event: InputEvent) => setCustomTitle(event.detail.value)} />
            <Input className="tx-input" value={customLocation} placeholder="地点，可选" onInput={(event: InputEvent) => setCustomLocation(event.detail.value)} />
            <Picker mode="selector" range={customTypeLabels} value={customTypeIndex} onChange={(event: PickerEvent) => setCustomTypeIndex(Number(event.detail.value) || 0)}>
              <View className="tx-select">{customTypeLabels[customTypeIndex]}</View>
            </Picker>
            <View className="tx-action-row">
              <Button className="tx-button" loading={loading} onClick={publishCustom}>发布</Button>
              <Button className="tx-button tx-button-secondary" onClick={() => setShowPublish(false)}>取消</Button>
            </View>
          </View>
        ) : null}

        <View className="tx-card">
          <View className="tx-card-head">
            <View>
              <Text className="tx-section-title">订阅中心</Text>
              <Text className="tx-section-sub">班级课表、考试、活动都可以像旧版课表一样合并展示。</Text>
            </View>
            <Button className="tx-button tx-button-compact" loading={loading} onClick={load}>刷新</Button>
          </View>
        </View>

        {subscriptions.length > 0 ? (
          <View className="tx-card">
            <Text className="tx-section-title">已订阅</Text>
            <Text className="tx-section-sub">可以随时取消，取消后日程表不再合成该源。</Text>
            {subscriptions.map((item) => (
              <View className="tx-action-item" key={item.id}>
                <View className="tx-action-icon">订</View>
                <View className="tx-action-main">
                  <Text className="tx-action-title">{item.sourceTitle || item.classLabel || item.sourceId}</Text>
                  <Text className="tx-action-sub">{item.sourceType || "日程源"}</Text>
                </View>
                <Button className="tx-button tx-button-secondary tx-button-compact" loading={loading} onClick={() => void cancel(item.id)}>取消</Button>
              </View>
            ))}
          </View>
        ) : null}

        {sources.length <= 0 ? <View className="tx-empty-card">暂无真实日程源。管理员或用户发布日程源后，可在这里订阅。</View> : null}
        {sources.map((source: CalendarSourceRow) => {
          const subscribed = subscribedSourceIds.includes(source.id);
          return (
            <View className="tx-card tx-card-pressable" key={source.id}>
              <View className="tx-card-head">
                <View>
                  <Text className="tx-card-title">{source.title}</Text>
                  <Text className="tx-muted">{source.classLabel || source.ownerId || source.id}</Text>
                </View>
                {subscribed ? <Text className="tx-pill tx-pill-active">已订阅</Text> : null}
              </View>
              <View className="tx-pill-row">
                <Text className="tx-pill">{sourceTypeLabel(source.type)}</Text>
                <Text className="tx-pill">{source.status === "published" ? "已发布" : "草稿"}</Text>
                <Text className="tx-pill">事件 {source.eventCount || 0}</Text>
                <Text className="tx-pill">订阅 {source.subscriptionCount || 0}</Text>
              </View>
              <View className="tx-action-row">
                <Button
                  className={`tx-button ${subscribed ? "tx-button-secondary" : ""}`}
                  disabled={subscribed || source.status !== "published"}
                  loading={loading}
                  onClick={() => void subscribe(source.id)}
                >
                  {subscribed ? "已订阅" : source.status === "published" ? "订阅" : "未发布"}
                </Button>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
