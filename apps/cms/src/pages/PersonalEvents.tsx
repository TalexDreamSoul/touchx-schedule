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

type Priority = "low" | "normal" | "high";

interface EventFormState {
  id: string;
  title: string;
  description: string;
  eventType: "todo" | "exam" | "activity";
  date: string;
  weekday: string;
  startSection: string;
  endSection: string;
  priority: Priority;
  tags: string;
}

const emptyForm: EventFormState = {
  id: "",
  title: "",
  description: "",
  eventType: "todo",
  date: "",
  weekday: "1",
  startSection: "1",
  endSection: "1",
  priority: "normal",
  tags: "个人",
};

const toForm = (item: PersonalEventRow): EventFormState => ({
  id: item.id,
  title: item.title,
  description: item.description || "",
  eventType: item.source === "exam" ? "exam" : item.source === "activity" ? "activity" : "todo",
  date: item.examDate || "",
  weekday: String(item.day || 1),
  startSection: String(item.startSection || 1),
  endSection: String(item.endSection || item.startSection || 1),
  priority: item.priorityLabel === "high" || item.priorityLabel === "low" ? item.priorityLabel : "normal",
  tags: (item.tags || []).join(", ") || "个人",
});

const formToPayload = (form: EventFormState) => ({
  title: form.title.trim(),
  description: form.description.trim(),
  eventType: form.eventType,
  date: form.date.trim(),
  weekday: Math.max(1, Math.min(7, Number(form.weekday || 1))),
  startSection: Math.max(1, Number(form.startSection || 1)),
  endSection: Math.max(1, Number(form.endSection || form.startSection || 1)),
  priority: form.priority,
  tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
});

export function PersonalEvents() {
  const [items, setItems] = useState<PersonalEventRow[]>([]);
  const [form, setForm] = useState<EventFormState>(emptyForm);
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

  const save = async () => {
    const payload = formToPayload(form);
    if (!payload.title) {
      setError("标题不能为空");
      return;
    }
    if (form.id) {
      await adminApi.updatePersonalEvent(form.id, payload);
    } else {
      await adminApi.createPersonalEvent(payload);
    }
    setForm(emptyForm);
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

  const updateForm = (patch: Partial<EventFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head"><div><h2>个人事项 / Todo</h2><p>个人事项会进入 EffectiveCalendarEvent 合成。</p></div><button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button></div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <input className="input" value={form.title} onChange={(event: any) => updateForm({ title: event.target.value })} placeholder="标题" />
        <input className="input" value={form.description} onChange={(event: any) => updateForm({ description: event.target.value })} placeholder="描述" />
        <select className="input" value={form.eventType} onChange={(event: any) => updateForm({ eventType: event.target.value })}>
          <option value="todo">Todo</option>
          <option value="exam">考试</option>
          <option value="activity">活动</option>
        </select>
        <input className="input" value={form.date} onChange={(event: any) => updateForm({ date: event.target.value })} placeholder="日期 YYYY-MM-DD，可选" />
        <input className="input" value={form.weekday} onChange={(event: any) => updateForm({ weekday: event.target.value })} placeholder="周几 1-7" />
        <input className="input" value={form.startSection} onChange={(event: any) => updateForm({ startSection: event.target.value })} placeholder="开始节次" />
        <input className="input" value={form.endSection} onChange={(event: any) => updateForm({ endSection: event.target.value })} placeholder="结束节次" />
        <select className="input" value={form.priority} onChange={(event: any) => updateForm({ priority: event.target.value })}>
          <option value="normal">普通</option>
          <option value="high">高优先级</option>
          <option value="low">低优先级</option>
        </select>
        <input className="input" value={form.tags} onChange={(event: any) => updateForm({ tags: event.target.value })} placeholder="标签，用逗号分隔" />
      </div>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="button" onClick={() => void save()}>{form.id ? "保存修改" : "创建"}</button>
        {form.id ? <button className="button ghost" onClick={() => setForm(emptyForm)}>取消编辑</button> : null}
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>标题</th><th>来源</th><th>时间</th><th>优先级</th><th>标签</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><div className="muted">{item.description}</div></td><td>{item.source}</td><td>{item.examDate || `周${item.day} 第${item.startSection}-${item.endSection}节`}</td><td>{item.priorityLabel}</td><td>{(item.tags || []).join(" / ") || "-"}</td><td><button className="button ghost" onClick={() => setForm(toForm(item))}>编辑</button><button className="button ghost" onClick={() => void done(item.id)}>完成</button><button className="button ghost" onClick={() => void archive(item.id)}>归档</button></td></tr>)}
            {items.length === 0 ? <tr><td colSpan={6} className="muted">暂无数据或未登录</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
