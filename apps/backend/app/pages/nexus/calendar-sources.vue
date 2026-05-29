<template>
  <NexusAdminShell title="Calendar Sources" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card">
        <span class="rx-pill">Sources</span>
        <h2>{{ sources.length }}</h2>
        <p>由旧 Schedule 兼容映射出的通用日程源。</p>
      </article>
      <article class="rx-card">
        <span class="rx-pill">Published Events</span>
        <h2>{{ eventCount }}</h2>
        <p>当前发布版本下的源事件数量。</p>
      </article>
      <article class="rx-card">
        <span class="rx-pill">Subscriptions</span>
        <h2>{{ subscriptionCount }}</h2>
        <p>基于 CalendarSubscription 的新 API 视角。</p>
      </article>
      <article class="rx-card">
        <span class="rx-pill">Admin</span>
        <h2>shadcn</h2>
        <p>新后台页面不再写入旧 NexusConsole。</p>
      </article>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>日程源列表</h2>
          <p>CalendarSource / Version / Event 兼容层已接入。</p>
        </div>
        <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">
          {{ loading ? "加载中..." : "刷新" }}
        </button>
      </header>

      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>类型</th>
              <th>归属</th>
              <th>状态</th>
              <th>版本</th>
              <th>事件</th>
              <th>订阅</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in sources" :key="item.id">
              <td>
                <strong>{{ item.title }}</strong>
                <div class="rx-muted">{{ item.id }}</div>
              </td>
              <td><span class="rx-pill">{{ item.type }}</span></td>
              <td>{{ item.classLabel || item.ownerId }}</td>
              <td>{{ item.status }}</td>
              <td>v{{ item.currentVersionNo || 0 }} / {{ item.versionCount }}</td>
              <td>{{ item.eventCount }}</td>
              <td>{{ item.subscriptionCount }}</td>
              <td>{{ toDisplayDate(item.updatedAt) }}</td>
              <td><button class="rx-btn rx-btn-ghost" type="button" @click="showVersions(item.id)">版本</button></td>
            </tr>
            <tr v-if="sources.length === 0">
              <td colspan="9" class="rx-muted">暂无日程源</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rx-card" v-if="selectedSourceId">
      <header class="rx-card-head">
        <div>
          <h2>版本列表</h2>
          <p>{{ selectedSourceId }}</p>
        </div>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>版本</th><th>状态</th><th>创建人</th><th>发布时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="version in versions" :key="version.id">
              <td><strong>v{{ version.versionNo }}</strong><div class="rx-muted">{{ version.id }}</div></td>
              <td><span class="rx-pill">{{ version.status }}</span></td>
              <td>{{ version.createdBy || '-' }}</td>
              <td>{{ toDisplayDate(version.publishedAt || version.createdAt) }}</td>
              <td><button class="rx-btn rx-btn-ghost" type="button" :disabled="loading || version.status === 'published'" @click="publishVersion(version.versionNo)">发布</button></td>
            </tr>
            <tr v-if="versions.length === 0"><td colspan="5" class="rx-muted">暂无版本</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

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

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const sources = ref<CalendarSourceRow[]>([]);
const selectedSourceId = ref("");
const versions = ref<any[]>([]);

const eventCount = computed(() => sources.value.reduce((sum, item) => sum + Number(item.eventCount || 0), 0));
const subscriptionCount = computed(() => sources.value.reduce((sum, item) => sum + Number(item.subscriptionCount || 0), 0));

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return String(value || "");
  }
  return new Date(parsed).toLocaleString("zh-CN");
};

const showVersions = async (sourceId: string) => {
  selectedSourceId.value = sourceId;
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ versions: any[] }>(`/api/v1/calendar/sources/${encodeURIComponent(sourceId)}`);
    versions.value = data.versions || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载版本失败";
  } finally {
    loading.value = false;
  }
};

const publishVersion = async (versionNo: number) => {
  if (!selectedSourceId.value) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/calendar/sources/${encodeURIComponent(selectedSourceId.value)}/versions/${versionNo}/publish`, { method: "POST", body: {} });
    await loadData();
    await showVersions(selectedSourceId.value);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "发布失败";
  } finally {
    loading.value = false;
  }
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: CalendarSourceRow[] }>("/api/v1/calendar/sources");
    sources.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
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
