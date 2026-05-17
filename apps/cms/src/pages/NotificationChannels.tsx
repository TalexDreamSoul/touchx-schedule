import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

type ChannelType = "wechat_clawdbot" | "feishu";

interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
}

export function NotificationChannels() {
  const [items, setItems] = useState<ChannelRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.listNotificationChannels() as unknown as { items: ChannelRow[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };
  const toggle = async (item: ChannelRow) => {
    await adminApi.upsertNotificationChannel({ type: item.type, name: item.name, enabled: !item.enabled });
    await load();
  };
  const sendTest = async (type: ChannelType) => {
    await adminApi.testNotificationChannel(type);
    await load();
  };
  const dispatchPending = async () => {
    await adminApi.dispatchPendingNotificationDeliveries(20);
    await load();
  };
  useEffect(() => { void load(); }, []);
  return (
    <section className="card">
      <div className="card-head"><div><h2>通知通道</h2><p>ClawDBot + 飞书模型已进入 API 与 notification-core。</p></div><div className="actions"><button className="button ghost" onClick={() => void dispatchPending()}>投递 pending</button><button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button></div></div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>通道</th><th>类型</th><th>状态</th><th>配置</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.type}</td><td><span className="pill">{item.enabled ? "已启用" : "未启用"}</span></td><td className="muted">{Object.keys(item.config || {}).filter((key) => item.config[key]).join(" / ") || "未配置"}</td><td><button className="button ghost" onClick={() => void toggle(item)}>{item.enabled ? "停用" : "启用"}</button><button className="button ghost" onClick={() => void sendTest(item.type)}>测试</button></td></tr>)}
            {items.length === 0 ? <tr><td colSpan={5} className="muted">暂无数据或未登录</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
