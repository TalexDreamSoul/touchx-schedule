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
      <p v-if="errorText" class="nexus-alert">{{ errorText }}</p>
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
          <h2>飞书应用用户级接收人绑定</h2>
          <p>企业自建应用发送时会优先使用用户绑定的 open_id / user_id / union_id；没有绑定才回退到通道 defaultReceiveId。</p>
        </div>
      </header>
      <div class="nexus-form binding-form">
        <select v-model="bindingForm.userId">
          <option value="">选择用户</option>
          <option v-for="user in users" :key="user.userId" :value="user.userId">
            {{ userLabel(user) }}
          </option>
        </select>
        <select v-model="bindingForm.channelType">
          <option value="feishu">飞书</option>
          <option value="wechat_clawdbot">微信 ClawDBot</option>
        </select>
        <input v-model.trim="bindingForm.externalOpenId" placeholder="open_id（飞书 open_id 推荐填这里）" />
        <input v-model.trim="bindingForm.externalUserId" placeholder="user_id / email / chat_id / fallback ID" />
        <input v-model.trim="bindingForm.externalUnionId" placeholder="union_id，可空" />
        <select v-model="bindingForm.status">
          <option value="active">active</option>
          <option value="disabled">disabled</option>
          <option value="expired">expired</option>
        </select>
        <button class="rx-btn" type="button" :disabled="loading || !bindingForm.userId" @click="saveBinding">
          {{ bindingForm.id ? "保存绑定" : "新增绑定" }}
        </button>
        <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="resetBindingForm">清空</button>
      </div>
      <div class="rx-table-wrap binding-table">
        <table class="rx-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>通道</th>
              <th>状态</th>
              <th>externalUserId</th>
              <th>openId</th>
              <th>unionId</th>
              <th>更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in bindings" :key="item.id">
              <td>{{ bindingUserLabel(item) }}</td>
              <td><span class="rx-pill">{{ item.channelType }}</span></td>
              <td>{{ item.status }}</td>
              <td>{{ item.externalUserId || "-" }}</td>
              <td>{{ item.externalOpenId || "-" }}</td>
              <td>{{ item.externalUnionId || "-" }}</td>
              <td>{{ toDisplayDate(item.updatedAt) }}</td>
              <td>
                <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="editBinding(item)">编辑</button>
                <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="deleteBinding(item.id)">删除</button>
              </td>
            </tr>
            <tr v-if="bindings.length <= 0"><td colspan="8" class="rx-muted">暂无通知绑定</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>最近测试投递</h2>
          <p>测试发送会创建 NotificationDelivery 并立即走真实 adapter；飞书企业应用会自动读取用户级绑定。</p>
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
type BindingStatus = "active" | "disabled" | "expired";

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

interface UserRow {
  userId: string;
  studentNo: string;
  studentId?: string;
  accountName?: string;
  name?: string;
  nickname?: string;
  classLabel?: string;
}

interface BindingRow {
  id: string;
  userId: string;
  channelType: ChannelType;
  externalUserId: string;
  externalOpenId?: string;
  externalUnionId?: string;
  status: BindingStatus;
  updatedAt: string;
  user?: UserRow | null;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const channels = ref<ChannelRow[]>([]);
const deliveries = ref<DeliveryRow[]>([]);
const users = ref<UserRow[]>([]);
const bindings = ref<BindingRow[]>([]);
const bindingForm = reactive({
  id: "",
  userId: "",
  channelType: "feishu" as ChannelType,
  externalUserId: "",
  externalOpenId: "",
  externalUnionId: "",
  status: "active" as BindingStatus,
});

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

const userLabel = (user: UserRow) => {
  return [user.name || user.nickname || user.accountName || user.studentNo || user.userId, user.classLabel].filter(Boolean).join(" · ");
};

const bindingUserLabel = (binding: BindingRow) => {
  if (binding.user) {
    return userLabel(binding.user);
  }
  const user = users.value.find((item) => item.userId === binding.userId) || null;
  return user ? userLabel(user) : binding.userId;
};

const resetBindingForm = () => {
  bindingForm.id = "";
  bindingForm.userId = "";
  bindingForm.channelType = "feishu";
  bindingForm.externalUserId = "";
  bindingForm.externalOpenId = "";
  bindingForm.externalUnionId = "";
  bindingForm.status = "active";
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const [channelData, deliveryData, userData, bindingData] = await Promise.all([
      request<{ items: ChannelRow[] }>("/api/v1/admin/notification-channels"),
      request<{ items: DeliveryRow[] }>("/api/v1/admin/notification-deliveries?limit=20"),
      request<{ items: UserRow[] }>("/api/v1/admin/users?limit=200&includeGhost=true"),
      request<{ items: BindingRow[] }>("/api/v1/admin/notification-bindings?limit=200"),
    ]);
    channels.value = channelData.items || [];
    deliveries.value = deliveryData.items || [];
    users.value = userData.items || [];
    bindings.value = bindingData.items || [];
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

const editBinding = (item: BindingRow) => {
  bindingForm.id = item.id;
  bindingForm.userId = item.userId;
  bindingForm.channelType = item.channelType;
  bindingForm.externalUserId = item.externalUserId || "";
  bindingForm.externalOpenId = item.externalOpenId || "";
  bindingForm.externalUnionId = item.externalUnionId || "";
  bindingForm.status = item.status;
};

const saveBinding = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/notification-bindings", {
      method: "POST",
      body: { ...bindingForm },
    });
    resetBindingForm();
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存绑定失败";
  } finally {
    loading.value = false;
  }
};

const deleteBinding = async (bindingId: string) => {
  if (!window.confirm("确认删除该通知绑定？")) {
    return;
  }
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/notification-bindings/${encodeURIComponent(bindingId)}/delete`, {
      method: "POST",
      body: {},
    });
    resetBindingForm();
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "删除绑定失败";
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

<style scoped>
.binding-form {
  grid-template-columns: minmax(12rem, 1.2fr) 9rem minmax(12rem, 1fr) minmax(12rem, 1fr) minmax(12rem, 1fr) 8rem auto auto;
  align-items: start;
  margin-top: 1rem;
}

.binding-table {
  margin-top: 1rem;
}

.rx-btn + .rx-btn {
  margin-left: 0.35rem;
}

@media (max-width: 1200px) {
  .binding-form {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 720px) {
  .binding-form {
    grid-template-columns: 1fr;
  }
}
</style>
