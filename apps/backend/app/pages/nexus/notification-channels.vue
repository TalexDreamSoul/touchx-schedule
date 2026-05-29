<template>
  <NexusAdminShell title="Notification Channels" @refresh="loadData">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>通知通道重构</h2>
          <p>目标通道：微信 ClawDBot + 飞书。飞书支持自定义机器人 webhook 与企业自建应用两种 provider。</p>
        </div>
        <div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="dispatchPending">投递 pending</button>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">
            {{ loading ? "加载中..." : "刷新" }}
          </button>
        </div>
      </header>
      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead>
            <tr>
              <th>通道</th>
              <th>类型</th>
              <th>状态</th>
              <th>配置摘要</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in channels" :key="item.id">
              <td>{{ item.name }}</td>
              <td><span class="rx-pill">{{ item.type }}</span></td>
              <td>{{ item.enabled ? "已启用" : "未启用" }}</td>
              <td class="rx-muted">{{ formatConfig(item.config) }}</td>
              <td>
                <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="toggleChannel(item)">
                  {{ item.enabled ? "停用" : "启用" }}
                </button>
                <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="sendTest(item.type)">测试</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>最近测试投递</h2>
          <p>当前测试发送先写入 NotificationDelivery，后续接真实 adapter。</p>
        </div>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead>
            <tr><th>标题</th><th>通道</th><th>状态</th><th>时间</th><th>错误</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in deliveries" :key="item.id">
              <td>{{ item.title }}</td>
              <td>{{ item.channelType }}</td>
              <td>{{ item.status }}</td>
              <td>{{ toDisplayDate(item.createdAt) }}</td>
              <td class="rx-muted">{{ item.errorMessage || "-" }}</td>
            </tr>
            <tr v-if="deliveries.length <= 0"><td colspan="5" class="rx-muted">暂无投递记录</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

type ChannelType = "wechat_clawdbot" | "feishu";
type FeishuProvider = "webhook_bot" | "tenant_app";

interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, string | undefined> & { provider?: FeishuProvider };
}

interface DeliveryRow {
  id: string;
  channelType: ChannelType;
  title: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const channels = ref<ChannelRow[]>([]);
const deliveries = ref<DeliveryRow[]>([]);

const formatConfig = (config: ChannelRow["config"]) => {
  const provider = config?.provider === "tenant_app" ? "飞书应用" : config?.provider === "webhook_bot" ? "飞书机器人" : "";
  const active = Object.entries(config || {}).filter(([, value]) => String(value || "").trim());
  const summary = active.length > 0 ? active.map(([key, value]) => `${key}: ${value}`).join(" / ") : "未配置密钥";
  return provider ? `${provider} / ${summary}` : summary;
};

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const [channelData, deliveryData] = await Promise.all([
      request<{ items: ChannelRow[] }>("/api/v1/admin/notification-channels"),
      request<{ items: DeliveryRow[] }>("/api/v1/admin/notification-deliveries?limit=20"),
    ]);
    channels.value = channelData.items || [];
    deliveries.value = deliveryData.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
};

const toggleChannel = async (item: ChannelRow) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/notification-channels", {
      method: "POST",
      body: {
        type: item.type,
        name: item.name,
        enabled: !item.enabled,
      },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存失败";
  } finally {
    loading.value = false;
  }
};

const dispatchPending = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/notification-deliveries/dispatch-pending", {
      method: "POST",
      body: { limit: 20 },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "投递失败";
  } finally {
    loading.value = false;
  }
};

const sendTest = async (type: ChannelType) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/notification-channels/${encodeURIComponent(type)}/test`, {
      method: "POST",
      body: {},
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "测试失败";
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  if (!ensureSessionToken()) {
    await goToLogin();
    return;
  }
  await loadData();
});
</script>
