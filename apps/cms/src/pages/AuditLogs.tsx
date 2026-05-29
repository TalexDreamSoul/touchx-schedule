import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

interface AuditLogRow {
  id: string;
  action: string;
  actorUserId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const formatPayload = (payload: Record<string, unknown>) => {
  const text = JSON.stringify(payload || {});
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
};

export function AuditLogs() {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.listAuditLogs({ limit: 80 }) as { items: AuditLogRow[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>审计日志</h2>
          <p>管理操作、导入确认、订阅、提醒与投递动作的基础审计。</p>
        </div>
        <button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>动作</th><th>操作者</th><th>时间</th><th>载荷</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.action}</strong><div className="muted">{item.id}</div></td>
                <td>{item.actorUserId}</td>
                <td>{item.createdAt}</td>
                <td className="muted">{formatPayload(item.payload)}</td>
              </tr>
            ))}
            {items.length === 0 ? <tr><td colSpan={4} className="muted">暂无审计记录</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
