<template>
  <NexusAdminShell title="Schedules" description="班级课表、订阅、补丁与冲突处理。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Schedules</span>
        <strong>{{ schedules.length }}</strong>
        <p>课表总数</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Subscriptions</span>
        <strong>{{ subscriptions.length }}</strong>
        <p>当前管理员订阅</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Conflicts</span>
        <strong>{{ conflicts.length }}</strong>
        <p>待处理冲突</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Patches</span>
        <strong>{{ patches.length }}</strong>
        <p>个人补丁</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="schedule-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>课表列表</h2>
            <p>班级课表版本、发布状态与条目数量。</p>
          </div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
        </header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>课表</th><th>班级</th><th>发布版本</th><th>最新版本</th><th>条目</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in schedules" :key="item.scheduleId">
                <td><strong>{{ item.title }}</strong><div class="rx-muted">{{ item.scheduleId }}</div></td>
                <td>{{ item.classLabel || item.classId }}</td>
                <td>v{{ item.publishedVersionNo || 0 }}</td>
                <td>v{{ item.latestVersionNo || 0 }} / {{ item.latestStatus }}</td>
                <td>{{ item.latestEntryCount || 0 }}</td>
                <td class="action-cell">
                  <button class="rx-btn rx-btn-ghost" type="button" @click="preparePublish(item.scheduleId)">发布</button>
                  <button class="rx-btn rx-btn-ghost" type="button" @click="subscribeSchedule(item.scheduleId)">订阅</button>
                </td>
              </tr>
              <tr v-if="schedules.length <= 0"><td colspan="6" class="rx-muted">暂无课表</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head">
            <div>
              <h2>创建课表</h2>
              <p>可立即发布初始版本。</p>
            </div>
          </header>
          <div class="nexus-form">
            <select v-model="createForm.classId">
              <option value="">选择班级</option>
              <option v-for="item in classes" :key="item.classId" :value="item.classId">{{ item.classLabel }}</option>
            </select>
            <input v-model.trim="createForm.title" placeholder="课表标题" />
            <input v-model.trim="createForm.description" placeholder="描述" />
            <label class="check-row"><input v-model="createForm.publishNow" type="checkbox" /><span>立即发布</span></label>
            <textarea v-model.trim="createForm.entriesText" rows="8" placeholder="课程条目 JSON 数组" />
            <button class="rx-btn" type="button" :disabled="loading || !createForm.classId" @click="createSchedule">创建课表</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head">
            <div>
              <h2>发布版本</h2>
              <p>entries 可空；为空时复制最新版本。</p>
            </div>
          </header>
          <div class="nexus-form">
            <select v-model="publishForm.scheduleId">
              <option value="">选择课表</option>
              <option v-for="item in schedules" :key="item.scheduleId" :value="item.scheduleId">{{ item.title }}</option>
            </select>
            <textarea v-model.trim="publishForm.entriesText" rows="6" placeholder="覆盖条目 JSON 数组，可空" />
            <button class="rx-btn" type="button" :disabled="loading || !publishForm.scheduleId" @click="publishSchedule">发布版本</button>
          </div>
        </article>
      </aside>
    </section>

    <section class="schedule-lower-grid">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>订阅列表</h2>
            <p>当前管理员账号下的订阅。</p>
          </div>
        </header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>课表</th><th>跟随模式</th><th>补丁</th><th>冲突</th></tr></thead>
            <tbody>
              <tr v-for="item in subscriptions" :key="item.id">
                <td><strong>{{ item.scheduleTitle }}</strong><div class="rx-muted">{{ item.id }}</div></td>
                <td><span class="rx-pill">{{ item.followMode }}</span></td>
                <td>{{ item.patchCount }}</td>
                <td>{{ item.pendingConflictCount }}</td>
              </tr>
              <tr v-if="subscriptions.length <= 0"><td colspan="4" class="rx-muted">暂无订阅</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>创建个人补丁</h2>
            <p>为当前管理员订阅添加 add / update / remove 补丁。</p>
          </div>
        </header>
        <div class="nexus-form patch-form">
          <select v-model="patchForm.subscriptionId">
            <option value="">选择订阅</option>
            <option v-for="item in subscriptions" :key="item.id" :value="item.id">{{ item.scheduleTitle }} / {{ item.id }}</option>
          </select>
          <input v-model.trim="patchForm.entryId" placeholder="entryId" />
          <select v-model="patchForm.opType">
            <option value="update">update</option>
            <option value="add">add</option>
            <option value="remove">remove</option>
          </select>
          <textarea v-model.trim="patchForm.patchPayloadText" rows="5" placeholder="补丁 JSON 对象" />
          <button class="rx-btn" type="button" :disabled="loading || !patchForm.subscriptionId || !patchForm.entryId" @click="createPatch">创建补丁</button>
        </div>
      </article>
    </section>

    <section class="schedule-lower-grid">
      <article class="rx-card">
        <header class="rx-card-head"><div><h2>冲突处理</h2><p>保留补丁或恢复跟随。</p></div></header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>冲突</th><th>课表</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in conflicts" :key="item.id">
                <td><strong>{{ item.entryId }}</strong><div class="rx-muted">{{ item.id }}</div></td>
                <td>{{ item.scheduleTitle }}</td>
                <td><span class="rx-pill">{{ item.resolutionStatus }}</span></td>
                <td class="action-cell">
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="resolveConflict(item.id, 'keep_patch')">保留补丁</button>
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="resolveConflict(item.id, 'relink')">恢复跟随</button>
                </td>
              </tr>
              <tr v-if="conflicts.length <= 0"><td colspan="4" class="rx-muted">暂无冲突</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head"><div><h2>补丁列表</h2><p>可将补丁恢复跟随。</p></div></header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>补丁</th><th>课表</th><th>条目</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in patches" :key="item.id">
                <td><strong>{{ item.opType }}</strong><div class="rx-muted">{{ item.id }}</div></td>
                <td>{{ item.scheduleTitle }}</td>
                <td>{{ item.entryId }}</td>
                <td><button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="relinkPatch(item.id)">恢复跟随</button></td>
              </tr>
              <tr v-if="patches.length <= 0"><td colspan="4" class="rx-muted">暂无补丁</td></tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface ScheduleRow {
  scheduleId: string;
  classId: string;
  classLabel: string;
  title: string;
  description: string;
  publishedVersionNo: number;
  latestVersionNo: number;
  latestStatus: string;
  latestEntryCount: number;
}

interface ClassRow { classId: string; classLabel: string }
interface SubscriptionRow { id: string; scheduleTitle: string; followMode: string; patchCount: number; pendingConflictCount: number }
interface ConflictRow { id: string; entryId: string; scheduleTitle: string; resolutionStatus: string }
interface PatchRow { id: string; entryId: string; scheduleTitle: string; opType: string }

const defaultEntriesJson = JSON.stringify([
  { day: 1, startSection: 1, endSection: 2, weekExpr: "1-18", parity: "all", courseName: "课程名称", classroom: "教室", teacher: "教师" },
], null, 2);

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const schedules = ref<ScheduleRow[]>([]);
const classes = ref<ClassRow[]>([]);
const subscriptions = ref<SubscriptionRow[]>([]);
const conflicts = ref<ConflictRow[]>([]);
const patches = ref<PatchRow[]>([]);
const createForm = reactive({ classId: "", title: "", description: "", publishNow: true, entriesText: defaultEntriesJson });
const publishForm = reactive({ scheduleId: "", entriesText: "" });
const patchForm = reactive({ subscriptionId: "", entryId: "", opType: "update", patchPayloadText: "{}" });

const parseJsonArray = (text: string) => {
  const source = String(text || "").trim();
  if (!source) return [];
  const value = JSON.parse(source);
  if (!Array.isArray(value)) throw new Error("请输入 JSON 数组");
  return value;
};

const parseJsonObject = (text: string) => {
  const source = String(text || "").trim();
  if (!source) return {};
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请输入 JSON 对象");
  return value;
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const [scheduleData, classData, subscriptionData, conflictData, patchData] = await Promise.all([
      request<{ items: ScheduleRow[] }>("/api/v1/admin/schedules"),
      request<{ items: ClassRow[] }>("/api/v1/admin/classes"),
      request<{ items: SubscriptionRow[] }>("/api/v1/me/schedule-subscriptions"),
      request<{ items: ConflictRow[] }>("/api/v1/me/schedule-conflicts"),
      request<{ items: PatchRow[] }>("/api/v1/me/schedule-patches"),
    ]);
    schedules.value = scheduleData.items || [];
    classes.value = classData.items || [];
    subscriptions.value = subscriptionData.items || [];
    conflicts.value = conflictData.items || [];
    patches.value = patchData.items || [];
    if (!createForm.classId && classes.value[0]) createForm.classId = classes.value[0].classId;
    if (!publishForm.scheduleId && schedules.value[0]) publishForm.scheduleId = schedules.value[0].scheduleId;
    if (!patchForm.subscriptionId && subscriptions.value[0]) patchForm.subscriptionId = subscriptions.value[0].id;
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载课表失败";
  } finally {
    loading.value = false;
  }
};

const createSchedule = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/classes/${encodeURIComponent(createForm.classId)}/schedules`, {
      method: "POST",
      body: {
        title: createForm.title,
        description: createForm.description,
        publishNow: createForm.publishNow,
        entries: parseJsonArray(createForm.entriesText),
      },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建课表失败";
  } finally {
    loading.value = false;
  }
};

const preparePublish = (scheduleId: string) => {
  publishForm.scheduleId = scheduleId;
  publishForm.entriesText = "";
};

const publishSchedule = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const body = publishForm.entriesText.trim() ? { entries: parseJsonArray(publishForm.entriesText) } : {};
    await request(`/api/v1/schedules/${encodeURIComponent(publishForm.scheduleId)}/publish`, { method: "POST", body });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "发布课表失败";
  } finally {
    loading.value = false;
  }
};

const subscribeSchedule = async (scheduleId: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/schedules/${encodeURIComponent(scheduleId)}/subscribe`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "订阅课表失败";
  } finally {
    loading.value = false;
  }
};

const createPatch = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/me/schedule-patches", {
      method: "POST",
      body: {
        subscriptionId: patchForm.subscriptionId,
        entryId: patchForm.entryId,
        opType: patchForm.opType,
        patchPayload: parseJsonObject(patchForm.patchPayloadText),
      },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建补丁失败";
  } finally {
    loading.value = false;
  }
};

const resolveConflict = async (conflictId: string, action: "keep_patch" | "relink") => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/me/schedule-conflicts/${encodeURIComponent(conflictId)}/resolve`, { method: "POST", body: { action } });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "处理冲突失败";
  } finally {
    loading.value = false;
  }
};

const relinkPatch = async (patchId: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/me/schedule-patches/${encodeURIComponent(patchId)}/relink`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "恢复跟随失败";
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
.schedule-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.35fr);
  gap: 1rem;
}

.schedule-lower-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.side-stack {
  display: grid;
  gap: 1rem;
  align-self: start;
}

.compact-head {
  margin-bottom: 0.75rem;
}

.action-cell {
  white-space: nowrap;
}

.action-cell .rx-btn + .rx-btn {
  margin-left: 0.35rem;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
}

@media (max-width: 1100px) {
  .schedule-layout,
  .schedule-lower-grid {
    grid-template-columns: 1fr;
  }
}
</style>
