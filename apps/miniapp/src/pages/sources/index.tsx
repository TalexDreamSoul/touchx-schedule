import { useEffect, useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import { listCalendarSources } from "../../lib/api";

interface SourceRow {
  id: string;
  title: string;
  type: string;
  status: string;
  eventCount?: number;
  subscriptionCount?: number;
  classLabel?: string;
  ownerId?: string;
}

const fallbackSources: SourceRow[] = [
  { id: "demo:class", title: "班级课表", type: "class_schedule", status: "demo" },
  { id: "demo:exam", title: "考试安排", type: "exam", status: "demo" },
  { id: "demo:activity", title: "社团活动", type: "activity", status: "demo" },
];

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceRow[]>(fallbackSources);
  const [message, setMessage] = useState("CalendarSource 是新核心，课表只是其中一种源。");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listCalendarSources();
      setSources(data.items?.length ? data.items : fallbackSources);
      setMessage(data.items?.length ? `已加载 ${data.items.length} 个日程源` : "暂无真实日程源，展示样例。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败，展示样例。");
      setSources(fallbackSources);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <View className="tx-page">
      <View className="tx-hero">
        <Text className="tx-kicker">Sources</Text>
        <Text className="tx-title">日程源订阅</Text>
        <Text className="tx-subtitle">{message}</Text>
        <View className="tx-pill-row"><Button className="tx-button" loading={loading} onClick={load}>刷新日程源</Button></View>
      </View>
      {sources.map((source: SourceRow) => (
        <View className="tx-card" key={source.id}>
          <Text className="tx-card-title">{source.title}</Text>
          <Text className="tx-muted">{source.classLabel || source.ownerId || source.id}</Text>
          <View className="tx-pill-row">
            <Text className="tx-pill">{source.type}</Text>
            <Text className="tx-pill">{source.status}</Text>
            <Text className="tx-pill">事件 {source.eventCount || 0}</Text>
            <Text className="tx-pill">订阅 {source.subscriptionCount || 0}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
