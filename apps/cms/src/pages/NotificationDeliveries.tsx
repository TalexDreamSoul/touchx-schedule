import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

interface DeliveryRow {
  id: string;
  userId: string;
  channelType: string;
  templateKey: string;
  title: string;
  body: string;
  status: string;
  dedupeKey: string;
  scheduledAt: string;
  sentAt?: string;
  externalMessageId?: string;
  errorMessage?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export function NotificationDeliveries() {
  const [items, setItems] = useState<DeliveryRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.listNotificationDeliveries({ limit: 50 }) as { items: DeliveryRow[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const dispatchPending = async () => {
    setLoading(true);
    setError("");
    try {
      await adminApi.dispatchPendingNotificationDeliveries(50);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "投递失败");
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>投递记录</h2>
          <p>NotificationDelivery 入队、发送、失败与外部回执。</p>
        </div>
        <div className="actions">
          <button className="button ghost" onClick={() => void dispatchPending()}>投递 pending</button>
          <button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button>
        </div>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>消息</th>
              <th>通道</th>
              <th>状态</th>
              <th>计划/发送</th>
              <th>重试</th>
              <th>外部结果</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  <div className="muted">{item.body}</div>
                  <div className="muted">{item.dedupeKey}</div>
                </td>
                <td>{item.channelType}<div className="muted">{item.templateKey}</div></td>
                <td><span className="pill">{item.status}</span></td>
                <td>{item.scheduledAt}<div className="muted">{item.sentAt || "未发送"}</div></td>
                <td>{item.attemptCount}</td>
                <td className="muted">{item.errorMessage || item.externalMessageId || "-"}</td>
              </tr>
            ))}
            {items.length === 0 ? <tr><td colSpan={6} className="muted">暂无投递记录</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
