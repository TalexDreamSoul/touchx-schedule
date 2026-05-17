import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

interface PersonalEventRow {
  id: string;
  title: string;
  description: string;
  source: string;
  day: number;
  startSection: number;
  endSection: number;
  priorityLabel: string;
  examDate: string;
  tags: string[];
}

export function PersonalEvents() {
  const [items, setItems] = useState<PersonalEventRow[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.listPersonalEvents() as { items: PersonalEventRow[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!title.trim()) return;
    await adminApi.createPersonalEvent({
      title,
      weekday: 1,
      startSection: 1,
      endSection: 1,
      eventType: "todo",
      priority: "normal",
      tags: ["个人"],
    });
    setTitle("");
    await load();
  };

  const done = async (id: string) => {
    await adminApi.markPersonalEventDone(id);
    await load();
  };

  const archive = async (id: string) => {
    await adminApi.archivePersonalEvent(id);
    await load();
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head"><div><h2>个人事项 / Todo</h2><p>个人事项会进入 EffectiveCalendarEvent 合成。</p></div><button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button></div>
      <div className="actions" style={{ marginBottom: 12 }}>
        <input className="input" value={title} onChange={(event: any) => setTitle(event.target.value)} placeholder="快速创建 Todo" />
        <button className="button" onClick={() => void create()}>创建</button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>标题</th><th>来源</th><th>时间</th><th>优先级</th><th>标签</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><div className="muted">{item.description}</div></td><td>{item.source}</td><td>{item.examDate || `周${item.day} 第${item.startSection}-${item.endSection}节`}</td><td>{item.priorityLabel}</td><td>{(item.tags || []).join(" / ") || "-"}</td><td><button className="button ghost" onClick={() => void done(item.id)}>完成</button><button className="button ghost" onClick={() => void archive(item.id)}>归档</button></td></tr>)}
            {items.length === 0 ? <tr><td colSpan={6} className="muted">暂无数据或未登录</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
