import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

type TargetType = "subscription" | "source_event" | "personal_event" | "global";
type Strategy = "both" | "primary_then_fallback" | "primary_only";

interface RuleRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  enabled: boolean;
  offsetMinutes: number;
  templateKey: string;
  channelStrategy: Strategy;
}

export function ReminderRules() {
  const [items, setItems] = useState<RuleRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [offsetMinutes, setOffsetMinutes] = useState("15");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.listReminderRules() as { items: RuleRow[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    await adminApi.upsertReminderRule({
      targetType: "global",
      targetId: "global",
      offsetMinutes: Number(offsetMinutes || 15),
      templateKey: "calendar.event.reminder",
      channelStrategy: "primary_then_fallback",
      quietHoursRespect: true,
      enabled: true,
    });
    await load();
  };

  const toggle = async (item: RuleRow) => {
    await adminApi.upsertReminderRule({ ...item, enabled: !item.enabled });
    await load();
  };

  const remove = async (id: string) => {
    await adminApi.deleteReminderRule(id);
    await load();
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head"><div><h2>提醒规则</h2><p>ReminderRule 策略配置。</p></div><button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button></div>
      <div className="actions" style={{ marginBottom: 12 }}>
        <input className="input" value={offsetMinutes} onChange={(event: any) => setOffsetMinutes(event.target.value)} placeholder="提前分钟" />
        <button className="button" onClick={() => void create()}>创建全局规则</button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap"><table><thead><tr><th>目标</th><th>提前</th><th>模板</th><th>策略</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><strong>{item.targetType}</strong><div className="muted">{item.targetId}</div></td><td>{item.offsetMinutes} 分钟</td><td>{item.templateKey}</td><td>{item.channelStrategy}</td><td><span className="pill">{item.enabled ? "启用" : "停用"}</span></td><td><button className="button ghost" onClick={() => void toggle(item)}>{item.enabled ? "停用" : "启用"}</button><button className="button ghost" onClick={() => void remove(item.id)}>删除</button></td></tr>)}
        {items.length === 0 ? <tr><td colSpan={6} className="muted">暂无规则</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}
