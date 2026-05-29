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

interface ChannelFormState {
  type: ChannelType;
  name: string;
  provider: "webhook_bot" | "tenant_app";
  webhookUrl: string;
  appId: string;
  appSecret: string;
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
  defaultReceiveId: string;
  signingSecret: string;
  enabled: boolean;
}

const defaultForm: ChannelFormState = {
  type: "wechat_clawdbot",
  name: "微信 ClawDBot",
  provider: "webhook_bot",
  webhookUrl: "",
  appId: "",
  appSecret: "",
  receiveIdType: "open_id",
  defaultReceiveId: "",
  signingSecret: "",
  enabled: true,
};

const defaultNameForType = (type: ChannelType) => type === "wechat_clawdbot" ? "微信 ClawDBot" : "飞书";

export function NotificationChannels() {
  const [items, setItems] = useState<ChannelRow[]>([]);
  const [form, setForm] = useState<ChannelFormState>(defaultForm);
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
  const edit = (item: ChannelRow) => {
    setForm({
      type: item.type,
      name: item.name,
      provider: (item.config?.provider as ChannelFormState["provider"]) || "webhook_bot",
      webhookUrl: item.config?.webhookUrl || "",
      appId: item.config?.appId || "",
      appSecret: item.config?.appSecret || "",
      receiveIdType: (item.config?.receiveIdType as ChannelFormState["receiveIdType"]) || "open_id",
      defaultReceiveId: item.config?.defaultReceiveId || "",
      signingSecret: item.config?.signingSecret || "",
      enabled: item.enabled,
    });
  };
  const save = async () => {
    if (!form.name.trim()) {
      setError("通道名称不能为空");
      return;
    }
    if (form.enabled && (form.type !== "feishu" || form.provider === "webhook_bot") && !form.webhookUrl.trim()) {
      setError("启用 webhook 通道前需要配置 webhookUrl");
      return;
    }
    if (form.enabled && form.type === "feishu" && form.provider === "tenant_app" && (!form.appId.trim() || !form.appSecret.trim() || !form.defaultReceiveId.trim())) {
      setError("启用飞书应用前需要配置 appId、appSecret 和默认接收 ID");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await adminApi.upsertNotificationChannel({
        type: form.type,
        name: form.name.trim(),
        enabled: form.enabled,
        config: {
          provider: form.type === "feishu" ? form.provider : undefined,
          webhookUrl: form.webhookUrl.trim(),
          appId: form.appId.trim(),
          appSecret: form.appSecret.trim(),
          receiveIdType: form.receiveIdType,
          defaultReceiveId: form.defaultReceiveId.trim(),
          signingSecret: form.signingSecret.trim(),
        },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };
  const dispatchPending = async () => {
    await adminApi.dispatchPendingNotificationDeliveries(20);
    await load();
  };
  useEffect(() => { void load(); }, []);
  return (
    <section className="card">
      <div className="card-head"><div><h2>通知通道</h2><p>ClawDBot + 飞书模型已进入 API 与 notification-core；飞书支持自定义机器人和企业自建应用两种 provider。</p></div><div className="actions"><button className="button ghost" onClick={() => void dispatchPending()}>投递 pending</button><button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button></div></div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <select className="input" value={form.type} onChange={(event: any) => {
          const type = event.target.value as ChannelType;
          setForm((current) => ({ ...current, type, name: defaultNameForType(type), provider: type === "feishu" ? current.provider : "webhook_bot" }));
        }}>
          <option value="wechat_clawdbot">微信 ClawDBot</option>
          <option value="feishu">飞书</option>
        </select>
        <input className="input" value={form.name} onChange={(event: any) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="通道名称" />
        {form.type === "feishu" ? (
          <select className="input" value={form.provider} onChange={(event: any) => setForm((current) => ({ ...current, provider: event.target.value }))}>
            <option value="webhook_bot">飞书自定义机器人</option>
            <option value="tenant_app">飞书企业自建应用</option>
          </select>
        ) : null}
        <select className="input" value={form.enabled ? "enabled" : "disabled"} onChange={(event: any) => setForm((current) => ({ ...current, enabled: event.target.value === "enabled" }))}>
          <option value="enabled">启用</option>
          <option value="disabled">停用</option>
        </select>
      </div>
      {form.type !== "feishu" || form.provider === "webhook_bot" ? (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <input className="input" value={form.webhookUrl} onChange={(event: any) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))} placeholder={form.type === "feishu" ? "飞书机器人 Webhook URL" : "ClawDBot Webhook URL"} />
          {form.type === "feishu" ? <input className="input" value={form.signingSecret} onChange={(event: any) => setForm((current) => ({ ...current, signingSecret: event.target.value }))} placeholder="飞书机器人签名密钥（可选）" /> : null}
        </div>
      ) : (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <input className="input" value={form.appId} onChange={(event: any) => setForm((current) => ({ ...current, appId: event.target.value }))} placeholder="飞书应用 App ID" />
          <input className="input" value={form.appSecret} onChange={(event: any) => setForm((current) => ({ ...current, appSecret: event.target.value }))} placeholder="飞书应用 App Secret" />
          <select className="input" value={form.receiveIdType} onChange={(event: any) => setForm((current) => ({ ...current, receiveIdType: event.target.value }))}>
            <option value="open_id">open_id</option>
            <option value="user_id">user_id</option>
            <option value="union_id">union_id</option>
            <option value="email">email</option>
            <option value="chat_id">chat_id</option>
          </select>
          <input className="input" value={form.defaultReceiveId} onChange={(event: any) => setForm((current) => ({ ...current, defaultReceiveId: event.target.value }))} placeholder="默认接收 ID（测试发送使用）" />
        </div>
      )}
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="button" onClick={() => void save()}>保存通道配置</button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>通道</th><th>类型</th><th>状态</th><th>配置</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.type}</td><td><span className="pill">{item.enabled ? "已启用" : "未启用"}</span></td><td className="muted">{Object.keys(item.config || {}).filter((key) => item.config[key]).join(" / ") || "未配置"}</td><td><button className="button ghost" onClick={() => edit(item)}>编辑</button><button className="button ghost" onClick={() => void toggle(item)}>{item.enabled ? "停用" : "启用"}</button><button className="button ghost" onClick={() => void sendTest(item.type)}>测试</button></td></tr>)}
            {items.length === 0 ? <tr><td colSpan={5} className="muted">暂无数据或未登录</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
