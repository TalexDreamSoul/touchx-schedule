import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../lib/api";

interface CalendarSourceRow {
  id: string;
  title: string;
  type: string;
  ownerId: string;
  status: string;
  classLabel?: string;
  currentVersionNo?: number;
  versionCount: number;
  eventCount: number;
  subscriptionCount: number;
  updatedAt: string;
}

interface CalendarSourceEventRow {
  id: string;
  title: string;
  eventType: string;
  location: string;
  weekday?: number;
  weekExpr?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
}

export function CalendarSources() {
  const [items, setItems] = useState<CalendarSourceRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [versions, setVersions] = useState<Array<{ id: string; versionNo: number; status: string; createdBy: string; createdAt: string; publishedAt?: string }>>([]);
  const [events, setEvents] = useState<CalendarSourceEventRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const totals = useMemo(() => ({
    events: items.reduce((sum, item) => sum + item.eventCount, 0),
    subscriptions: items.reduce((sum, item) => sum + item.subscriptionCount, 0),
  }), [items]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.listCalendarSources() as { items: CalendarSourceRow[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const showVersions = async (sourceId: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.getCalendarSource(sourceId) as {
        versions: Array<{ id: string; versionNo: number; status: string; createdBy: string; createdAt: string; publishedAt?: string }>;
        events: CalendarSourceEventRow[];
      };
      setSelectedSourceId(sourceId);
      setVersions(data.versions || []);
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载版本失败");
    } finally {
      setLoading(false);
    }
  };

  const publishVersion = async (versionNo: number) => {
    if (!selectedSourceId) return;
    setLoading(true);
    setError("");
    try {
      await adminApi.publishCalendarSourceVersion(selectedSourceId, versionNo);
      await load();
      await showVersions(selectedSourceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head">
        <div><h2>日程源</h2><p>GET /api/v1/calendar/sources · 旧 Schedule 兼容映射。</p></div>
        <button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button>
      </div>
      <div className="actions" style={{ marginBottom: 12 }}>
        <span className="pill">Sources {items.length}</span>
        <span className="pill">Events {totals.events}</span>
        <span className="pill">Subscriptions {totals.subscriptions}</span>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>标题</th><th>类型</th><th>归属</th><th>状态</th><th>版本</th><th>事件</th><th>订阅</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.title}</strong><div className="muted">{item.id}</div></td>
                <td><span className="pill">{item.type}</span></td>
                <td>{item.classLabel || item.ownerId}</td>
                <td>{item.status}</td>
                <td>v{item.currentVersionNo || 0} / {item.versionCount}</td>
                <td>{item.eventCount}</td>
                <td>{item.subscriptionCount}</td>
                <td><button className="button ghost" onClick={() => void showVersions(item.id)}>详情</button></td>
              </tr>
            ))}
            {items.length === 0 ? <tr><td colSpan={8} className="muted">暂无数据或未登录</td></tr> : null}
          </tbody>
        </table>
      </div>
      {selectedSourceId ? <><h2 style={{ marginTop: 18 }}>版本列表</h2><p className="muted">{selectedSourceId}</p><div className="table-wrap"><table><thead><tr><th>版本</th><th>状态</th><th>创建人</th><th>时间</th><th>操作</th></tr></thead><tbody>
        {versions.map((version) => <tr key={version.id}><td><strong>v{version.versionNo}</strong><div className="muted">{version.id}</div></td><td><span className="pill">{version.status}</span></td><td>{version.createdBy || "-"}</td><td>{version.publishedAt || version.createdAt}</td><td><button className="button ghost" disabled={loading || version.status === "published"} onClick={() => void publishVersion(version.versionNo)}>发布</button></td></tr>)}
        {versions.length === 0 ? <tr><td colSpan={5} className="muted">暂无版本</td></tr> : null}
      </tbody></table></div>
      <h2 style={{ marginTop: 18 }}>已发布事件</h2>
      <div className="table-wrap"><table><thead><tr><th>事件</th><th>类型</th><th>时间</th><th>地点</th><th>周次</th></tr></thead><tbody>
        {events.map((event) => <tr key={event.id}><td><strong>{event.title}</strong><div className="muted">{event.id}</div></td><td><span className="pill">{event.eventType}</span></td><td>{event.startTime || event.startSection ? `${event.startTime || `第${event.startSection}节`} - ${event.endTime || `第${event.endSection}节`}` : "-"}</td><td>{event.location || "-"}</td><td>{event.weekday ? `周${event.weekday}` : "-"} · {event.weekExpr || "全周"}</td></tr>)}
        {events.length === 0 ? <tr><td colSpan={5} className="muted">暂无已发布事件</td></tr> : null}
      </tbody></table></div></> : null}
    </section>
  );
}
