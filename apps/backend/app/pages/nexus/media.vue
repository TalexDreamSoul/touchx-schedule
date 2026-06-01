<template>
  <NexusAdminShell title="Media" description="头像、壁纸和其他媒体资源管理。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Assets</span>
        <strong>{{ assets.length }}</strong>
        <p>当前筛选资产</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Referenced</span>
        <strong>{{ referencedCount }}</strong>
        <p>已被用户引用</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Orphans</span>
        <strong>{{ orphanCount }}</strong>
        <p>未引用资产</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Usage</span>
        <strong>{{ query.usage || "all" }}</strong>
        <p>当前用途筛选</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="media-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>媒体资产列表</h2>
            <p>按 owner 和 usage 过滤，支持对账与孤儿资源清理。</p>
          </div>
          <div class="rx-actions">
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="reconcileAssets">引用对账</button>
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
          </div>
        </header>
        <div class="filter-row">
          <input v-model.trim="query.ownerUserId" placeholder="ownerUserId，可空" />
          <select v-model="query.usage">
            <option value="">全部用途</option>
            <option value="avatar">avatar</option>
            <option value="wallpaper">wallpaper</option>
            <option value="other">other</option>
          </select>
          <button class="rx-btn" type="button" :disabled="loading" @click="loadData">应用筛选</button>
        </div>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>ID</th><th>Owner</th><th>Usage</th><th>Size</th><th>Referenced</th><th>URL</th></tr></thead>
            <tbody>
              <tr v-for="item in assets" :key="item.id">
                <td><strong>{{ item.id }}</strong><div class="rx-muted">{{ item.objectKey }}</div></td>
                <td>{{ item.ownerUserId }}</td>
                <td><span class="rx-pill">{{ item.usage }}</span></td>
                <td>{{ item.size }}</td>
                <td>{{ item.referenced ? "true" : "false" }}</td>
                <td><a :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a></td>
              </tr>
              <tr v-if="assets.length <= 0"><td colspan="6" class="rx-muted">暂无媒体资产</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>创建资源</h2><p>创建一条媒体记录。</p></div></header>
          <div class="nexus-form">
            <select v-model="createForm.usage">
              <option value="avatar">avatar</option>
              <option value="wallpaper">wallpaper</option>
              <option value="other">other</option>
            </select>
            <input v-model.trim="createForm.mime" placeholder="mime，例如 image/png" />
            <input v-model.number="createForm.size" type="number" min="0" placeholder="size" />
            <input v-model.trim="createForm.fileName" placeholder="fileName" />
            <button class="rx-btn" type="button" :disabled="loading" @click="createAsset">创建资源</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>绑定当前账号</h2><p>绑定头像 / 壁纸资源。</p></div></header>
          <div class="nexus-form">
            <input v-model.trim="bindForm.avatarAssetId" placeholder="avatarAssetId" />
            <input v-model.trim="bindForm.wallpaperAssetId" placeholder="wallpaperAssetId" />
            <button class="rx-btn" type="button" :disabled="loading || (!bindForm.avatarAssetId && !bindForm.wallpaperAssetId)" @click="bindProfileMedia">绑定资源</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>清理资源</h2><p>默认仅清理超过 24 小时的孤儿资源。</p></div></header>
          <div class="nexus-form">
            <label class="check-row"><input v-model="cleanupForm.onlyOrphans" type="checkbox" /><span>仅孤儿资源</span></label>
            <input v-model.number="cleanupForm.olderThanHours" type="number" min="0" placeholder="olderThanHours" />
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="cleanupAssets">执行清理</button>
          </div>
        </article>
      </aside>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

type MediaUsage = "avatar" | "wallpaper" | "other";

interface MediaAssetRow {
  id: string;
  ownerUserId: string;
  usage: MediaUsage;
  objectKey: string;
  url: string;
  mime: string;
  size: number;
  referenced: boolean;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const assets = ref<MediaAssetRow[]>([]);
const query = reactive({ ownerUserId: "", usage: "" });
const createForm = reactive({ usage: "other" as MediaUsage, mime: "image/png", size: 0, fileName: "" });
const bindForm = reactive({ avatarAssetId: "", wallpaperAssetId: "" });
const cleanupForm = reactive({ onlyOrphans: true, olderThanHours: 24 });

const referencedCount = computed(() => assets.value.filter((item) => item.referenced).length);
const orphanCount = computed(() => assets.value.filter((item) => !item.referenced).length);

const buildQuery = () => {
  const params = new URLSearchParams();
  if (query.ownerUserId.trim()) params.set("ownerUserId", query.ownerUserId.trim());
  if (query.usage) params.set("usage", query.usage);
  const text = params.toString();
  return text ? `?${text}` : "";
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: MediaAssetRow[] }>(`/api/v1/admin/media-assets${buildQuery()}`);
    assets.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载媒体资产失败";
  } finally {
    loading.value = false;
  }
};

const createAsset = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/media/assets", { method: "POST", body: createForm });
    createForm.fileName = "";
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建媒体资源失败";
  } finally {
    loading.value = false;
  }
};

const bindProfileMedia = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/me/profile/media", {
      method: "POST",
      body: {
        avatarAssetId: bindForm.avatarAssetId || undefined,
        wallpaperAssetId: bindForm.wallpaperAssetId || undefined,
      },
    });
    bindForm.avatarAssetId = "";
    bindForm.wallpaperAssetId = "";
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "绑定媒体资源失败";
  } finally {
    loading.value = false;
  }
};

const reconcileAssets = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/media-assets/reconcile", { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "媒体对账失败";
  } finally {
    loading.value = false;
  }
};

const cleanupAssets = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/media-assets/cleanup", { method: "POST", body: cleanupForm });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "清理媒体资源失败";
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
.media-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.35fr);
  gap: 1rem;
}

.filter-row {
  grid-template-columns: minmax(12rem, 1fr) 10rem auto;
  margin-bottom: 1rem;
}

@media (max-width: 1080px) {
  .media-layout,
  .filter-row {
    grid-template-columns: 1fr;
  }
}
</style>
