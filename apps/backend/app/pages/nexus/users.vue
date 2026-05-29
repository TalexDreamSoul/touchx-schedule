<template>
  <NexusAdminShell title="Users" description="账号、角色与提醒配置。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Users</span>
        <strong>{{ total }}</strong>
        <p>当前可见用户</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Admins</span>
        <strong>{{ adminCount }}</strong>
        <p>operator / super_admin</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Reminders</span>
        <strong>{{ reminderEnabledCount }}</strong>
        <p>已启用提醒</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Selected</span>
        <strong>{{ selectedUser ? 1 : 0 }}</strong>
        <p>{{ selectedUser?.studentNo || "未选择" }}</p>
      </article>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>用户列表</h2>
          <p>搜索学号、账号、姓名或班级，选择后可在右侧快速编辑。</p>
        </div>
        <div class="rx-actions">
          <input v-model.trim="keyword" class="nexus-input compact" placeholder="搜索用户" />
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
        </div>
      </header>
      <p v-if="errorText" class="nexus-alert">{{ errorText }}</p>
      <div class="users-layout">
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>用户</th><th>班级</th><th>角色</th><th>提醒</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in filteredUsers" :key="item.userId">
                <td>
                  <strong>{{ item.name || item.nickname || item.accountName || item.studentNo }}</strong>
                  <div class="rx-muted">{{ item.studentNo }} · {{ item.accountName || "legacy" }}</div>
                </td>
                <td>{{ item.classLabel || "-" }}<div class="rx-muted">{{ item.classCount }} classes / {{ item.subscriptionCount }} subs</div></td>
                <td><span class="rx-pill">{{ item.adminRole }}</span></td>
                <td>{{ item.reminderEnabled ? "启用" : "关闭" }}</td>
                <td><button class="rx-btn rx-btn-ghost" type="button" @click="selectUser(item)">编辑</button></td>
              </tr>
              <tr v-if="filteredUsers.length <= 0"><td colspan="5" class="rx-muted">暂无用户</td></tr>
            </tbody>
          </table>
        </div>

        <aside class="rx-card editor-card">
          <header class="rx-card-head compact-head">
            <div>
              <h2>快速编辑</h2>
              <p>{{ selectedUser ? selectedUser.userId : "请选择左侧用户" }}</p>
            </div>
          </header>
          <div class="nexus-form user-form">
            <input v-model.trim="form.name" placeholder="姓名" :disabled="!selectedUser" />
            <input v-model.trim="form.nickname" placeholder="昵称" :disabled="!selectedUser" />
            <input v-model.trim="form.classLabel" placeholder="班级标签" :disabled="!selectedUser" />
            <input v-model.trim="form.studentId" placeholder="studentId" :disabled="!selectedUser" />
            <select v-model="form.adminRole" :disabled="!selectedUser">
              <option value="none">none</option>
              <option value="operator">operator</option>
              <option value="super_admin">super_admin</option>
            </select>
            <label class="check-row">
              <input v-model="form.reminderEnabled" type="checkbox" :disabled="!selectedUser" />
              <span>启用提醒</span>
            </label>
            <input v-model.trim="form.reminderWindowMinutes" placeholder="提醒窗口，例如 30,15" :disabled="!selectedUser" />
            <button class="rx-btn" type="button" :disabled="loading || !selectedUser" @click="saveUser">保存用户</button>
          </div>
        </aside>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

type AdminRole = "none" | "operator" | "super_admin";

interface UserRow {
  userId: string;
  accountName: string;
  studentNo: string;
  studentId: string;
  name: string;
  nickname: string;
  classLabel: string;
  adminRole: AdminRole;
  reminderEnabled: boolean;
  reminderWindowMinutes: number[];
  classCount: number;
  subscriptionCount: number;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const keyword = ref("");
const users = ref<UserRow[]>([]);
const selectedUser = ref<UserRow | null>(null);
const total = ref(0);
const form = reactive({
  name: "",
  nickname: "",
  classLabel: "",
  studentId: "",
  adminRole: "none" as AdminRole,
  reminderEnabled: true,
  reminderWindowMinutes: "30,15",
});

const adminCount = computed(() => users.value.filter((item) => item.adminRole === "operator" || item.adminRole === "super_admin").length);
const reminderEnabledCount = computed(() => users.value.filter((item) => item.reminderEnabled).length);
const filteredUsers = computed(() => {
  const text = keyword.value.toLowerCase();
  if (!text) return users.value;
  return users.value.filter((item) => `${item.studentNo} ${item.accountName} ${item.name} ${item.nickname} ${item.classLabel} ${item.adminRole}`.toLowerCase().includes(text));
});

const applyForm = (item: UserRow) => {
  form.name = item.name || "";
  form.nickname = item.nickname || "";
  form.classLabel = item.classLabel || "";
  form.studentId = item.studentId || "";
  form.adminRole = item.adminRole || "none";
  form.reminderEnabled = Boolean(item.reminderEnabled);
  form.reminderWindowMinutes = Array.isArray(item.reminderWindowMinutes) ? item.reminderWindowMinutes.join(",") : "30,15";
};

const selectUser = (item: UserRow) => {
  selectedUser.value = item;
  applyForm(item);
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: UserRow[]; total: number }>("/api/v1/admin/users?limit=500");
    users.value = data.items || [];
    total.value = Number(data.total || users.value.length);
    const selectedId = selectedUser.value?.userId;
    const nextSelected = (selectedId && users.value.find((item) => item.userId === selectedId)) || users.value[0] || null;
    selectedUser.value = nextSelected;
    if (nextSelected) applyForm(nextSelected);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载用户失败";
  } finally {
    loading.value = false;
  }
};

const saveUser = async () => {
  if (!selectedUser.value) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/users/${encodeURIComponent(selectedUser.value.userId)}/update`, {
      method: "POST",
      body: { ...form },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存用户失败";
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
.users-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.35fr);
  gap: 1rem;
}

.editor-card {
  align-self: start;
}

.compact-head {
  margin-bottom: 0.75rem;
}

.nexus-input.compact {
  min-height: 2.25rem;
  width: min(16rem, 100%);
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 0.25rem);
  padding: 0.45rem 0.75rem;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.check-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
}

@media (max-width: 1080px) {
  .users-layout {
    grid-template-columns: 1fr;
  }
}
</style>
