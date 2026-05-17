import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

interface CandidateRow {
  id: string;
  eventId: string;
  scheduledAt: string;
  offsetMinutes: number;
  templateKey: string;
  title: string;
  body: string;
}

export function ReminderCandidates() {
  const [items, setItems] = useState<CandidateRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.listReminderCandidates() as { items: CandidateRow[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const enqueue = async () => {
    await adminApi.enqueueReminderCandidates({ limit: 50 });
    await load();
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head"><div><h2>提醒候选</h2><p>EffectiveCalendarEvent + ReminderRule 计算结果。</p></div><div className="actions"><button className="button ghost" onClick={() => void enqueue()}>入队</button><button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button></div></div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap"><table><thead><tr><th>事件</th><th>计划时间</th><th>提前</th><th>模板</th><th>内容</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><div className="muted">{item.eventId}</div></td><td>{item.scheduledAt}</td><td>{item.offsetMinutes} 分钟</td><td>{item.templateKey}</td><td className="muted">{item.body}</td></tr>)}
        {items.length === 0 ? <tr><td colSpan={5} className="muted">暂无候选</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}
