<template>
  <NexusAdminShell title="Notification Deliveries" @refresh="loadData">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>投递记录</h2>
          <p>查看 NotificationDelivery 状态、重试次数、外部消息 ID 与失败原因。</p>
        </div>
        <div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="dispatchPending">投递 pending</button>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">
            {{ loading ? "加载中..." : "刷新" }}
          </button>
        </div>
      </header>
      <div class="filter-row">
        <select v-model="statusFilter" :disabled="loading" @change="loadData">
          <option value="all">全部状态</option>
          <option value="pending">pending</option>
          <option value="sending">sending</option>
          <option value="sent">sent</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
        </select>
        <select v-model="sourceQueueFilter" :disabled="loading" @change="loadData">
          <option value="all">全部来源</option>
          <option value="notification">提醒 notification 队列</option>
          <option value="standard">标准通知队列</option>
        </select>
      </div>
      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>用户</th>
              <th>通道</th>
              <th>来源</th>
              <th>状态</th>
              <th>计划时间</th>
              <th>重试</th>
              <th>外部 ID</th>
              <th>错误</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in deliveries" :key="item.id">
              <td><strong>{{ item.title }}</strong><div class="rx-muted">{{ item.templateKey }}</div></td>
              <td>{{ item.userId }}</td>
              <td><span class="rx-pill">{{ item.channelType }}</span></td>
              <td><span class="rx-pill">{{ toSourceLabel(item) }}</span></td>
              <td>{{ item.status }}</td>
              <td>{{ toDisplayDate(item.scheduledAt || item.createdAt) }}</td>
              <td>{{ item.attemptCount || 0 }}</td>
              <td class="rx-muted">{{ item.externalMessageId || "-" }}</td>
              <td class="rx-muted">{{ item.errorMessage || "-" }}</td>
              <td>
                <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading || item.status !== 'failed'" @click="retryDelivery(item)">
                  重试
                </button>
              </td>
            </tr>
            <tr v-if="deliveries.length <= 0"><td colspan="10" class="rx-muted">暂无投递记录</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface DeliveryRow {
  id: string;
  userId: string;
  channelType: string;
  templateKey: string;
  title: string;
  status: string;
  payload?: Record<string, unknown>;
  scheduledAt: string;
  createdAt: string;
  attemptCount: number;
  externalMessageId?: string;
  errorMessage?: string;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const deliveries = ref<DeliveryRow[]>([]);
const statusFilter = ref("all");
const sourceQueueFilter = ref("all");

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const toSourceLabel = (item: DeliveryRow) => {
  const sourceQueue = String(item.payload?.sourceQueue || "");
  return sourceQueue === "notification" ? "reminder" : "standard";
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const query = new URLSearchParams({ limit: "80" });
    if (statusFilter.value !== "all") {
      query.set("status", statusFilter.value);
    }
    if (sourceQueueFilter.value !== "all") {
      query.set("sourceQueue", sourceQueueFilter.value);
    }
    const data = await request<{ items: DeliveryRow[] }>(`/api/v1/admin/notification-deliveries?${query.toString()}`);
    deliveries.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
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
      body: { limit: 50 },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "投递失败";
  } finally {
    loading.value = false;
  }
};

const retryDelivery = async (item: DeliveryRow) => {
  if (item.status !== "failed") return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/notification-deliveries/${encodeURIComponent(item.id)}/retry`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "重试失败";
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
