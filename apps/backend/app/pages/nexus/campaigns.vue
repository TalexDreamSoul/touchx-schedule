<template>
  <NexusAdminShell title="Campaigns" description="食物投票活动运营，创建活动、查看结果并执行调试投票。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Campaigns</span>
        <strong>{{ campaigns.length }}</strong>
        <p>活动总数</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Open</span>
        <strong>{{ openCount }}</strong>
        <p>进行中</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Votes</span>
        <strong>{{ voteCount }}</strong>
        <p>投票聚合</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Foods</span>
        <strong>{{ foods.length }}</strong>
        <p>可选食物</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="campaign-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>活动列表</h2>
            <p>管理员可结束活动；详情接口会使用当前管理员身份预览投票结果。</p>
          </div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
        </header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead>
              <tr><th>活动</th><th>状态</th><th>匿名</th><th>候选</th><th>投票</th><th>截止</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in campaigns" :key="item.campaignId" :class="{ 'selected-row': item.campaignId === detailForm.campaignId }">
                <td><strong>{{ item.title }}</strong><div class="rx-muted">{{ item.campaignId }}</div></td>
                <td><span class="rx-pill">{{ item.status }}</span></td>
                <td>{{ item.isAnonymous ? "匿名" : "实名" }}</td>
                <td>{{ item.optionCount }}</td>
                <td>{{ item.voteCount }}</td>
                <td>{{ toDisplayDate(item.deadlineAtIso) }}</td>
                <td class="action-cell">
                  <button class="rx-btn rx-btn-ghost" type="button" @click="selectCampaign(item.campaignId)">详情</button>
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading || item.status !== 'open'" @click="closeCampaign(item)">结束</button>
                </td>
              </tr>
              <tr v-if="campaigns.length <= 0"><td colspan="7" class="rx-muted">暂无活动</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>创建活动</h2><p>候选食物为空时后端自动选择。</p></div></header>
          <div class="nexus-form">
            <input v-model.trim="createForm.title" placeholder="标题，可空自动生成" />
            <select v-model="createForm.classId">
              <option value="">不绑定班级</option>
              <option v-for="item in classes" :key="item.classId" :value="item.classId">{{ item.classLabel }}</option>
            </select>
            <input v-model.trim="createForm.deadlineAtIso" placeholder="截止时间 ISO，可空默认 +24h" />
            <label class="check-row"><input v-model="createForm.isAnonymous" type="checkbox" /><span>匿名投票</span></label>
            <input v-model.trim="createForm.optionFoodIdsText" placeholder="食物 ID，英文逗号分隔；可空" />
            <button class="rx-btn" type="button" :disabled="loading" @click="createCampaign">创建活动</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>详情与投票</h2><p>{{ detailForm.campaignId || "请选择活动" }}</p></div></header>
          <div class="nexus-form">
            <select v-model="detailForm.campaignId" @change="loadDetail">
              <option value="">选择活动</option>
              <option v-for="item in campaigns" :key="item.campaignId" :value="item.campaignId">{{ item.title }} / {{ item.campaignId }}</option>
            </select>
            <input v-model.trim="detailForm.shareToken" placeholder="shareToken，可空" />
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading || !detailForm.campaignId" @click="loadDetail">刷新详情</button>
            <select v-model="voteForm.foodId">
              <option value="">选择投票食物</option>
              <option v-for="item in detailOptions" :key="item.foodId" :value="item.foodId">{{ item.foodName || item.name }} / {{ item.foodId }}</option>
            </select>
            <input v-model.number="voteForm.score" type="number" min="1" max="10" placeholder="分值 1-10" />
            <button class="rx-btn" type="button" :disabled="loading || !detailForm.campaignId || !voteForm.foodId" @click="voteCampaign">提交调试投票</button>
          </div>
        </article>
      </aside>
    </section>

    <section class="detail-grid" v-if="campaignDetail">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>活动详情</h2>
            <p>{{ campaignDetail.title || campaignDetail.campaign?.title || detailForm.campaignId }}</p>
          </div>
          <span class="rx-pill">{{ campaignDetail.status || campaignDetail.campaign?.status || "detail" }}</span>
        </header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>选项</th><th>分类</th><th>价格</th><th>得票/分</th><th>ID</th></tr></thead>
            <tbody>
              <tr v-for="item in detailOptions" :key="item.foodId">
                <td><strong>{{ item.foodName || item.name }}</strong><div class="rx-muted">{{ item.merchantName || item.brandName }}</div></td>
                <td>{{ item.categoryName || item.categoryKey }}</td>
                <td>{{ formatPrice(item) }}</td>
                <td>{{ item.voteCount ?? item.totalVotes ?? item.score ?? "-" }}</td>
                <td>{{ item.foodId }}</td>
              </tr>
              <tr v-if="detailOptions.length <= 0"><td colspan="5" class="rx-muted">详情中暂无候选选项</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head"><div><h2>原始响应</h2><p>用于兼容调试。</p></div></header>
        <pre class="json-box">{{ toJson(campaignDetail) }}</pre>
      </article>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface CampaignRow {
  campaignId: string;
  title: string;
  status: string;
  isAnonymous: boolean;
  deadlineAtIso: string;
  optionCount: number;
  voteCount: number;
}

interface ClassRow {
  classId: string;
  classLabel: string;
}

interface FoodRow {
  foodId: string;
  foodName: string;
  name?: string;
  merchantName?: string;
  categoryKey?: string;
  categoryName?: string;
  basePriceMin?: number;
  basePriceMax?: number;
  priceMin?: number;
  priceMax?: number;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const campaigns = ref<CampaignRow[]>([]);
const classes = ref<ClassRow[]>([]);
const foods = ref<FoodRow[]>([]);
const campaignDetail = ref<any>(null);
const createForm = reactive({ title: "", classId: "", deadlineAtIso: "", isAnonymous: true, optionFoodIdsText: "" });
const detailForm = reactive({ campaignId: "", shareToken: "" });
const voteForm = reactive({ foodId: "", score: 5 });

const openCount = computed(() => campaigns.value.filter((item) => item.status === "open").length);
const voteCount = computed(() => campaigns.value.reduce((sum, item) => sum + Number(item.voteCount || 0), 0));
const detailOptions = computed<FoodRow[]>(() => {
  const detail = campaignDetail.value || {};
  const candidates = [detail.options, detail.foods, detail.items, detail.campaign?.options, detail.result?.options]
    .find((value) => Array.isArray(value)) as any[] | undefined;
  if (candidates) return candidates.map(normalizeOptionRow);
  return [];
});

const normalizeOptionRow = (item: any): FoodRow => ({
  ...item,
  foodId: String(item?.foodId || item?.id || ""),
  foodName: String(item?.foodName || item?.name || item?.title || ""),
});

const toDisplayDate = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : raw;
};

const toJson = (value: unknown) => JSON.stringify(value || {}, null, 2);

const formatPrice = (item: FoodRow) => {
  const min = item.basePriceMin ?? item.priceMin;
  const max = item.basePriceMax ?? item.priceMax;
  if (typeof min === "number" || typeof max === "number") return `${min ?? "-"} ~ ${max ?? "-"}`;
  return "-";
};

const loadListData = async () => {
  const [campaignData, classData, foodData] = await Promise.all([
    request<{ items: CampaignRow[] }>("/api/v1/admin/food-campaigns"),
    request<{ items: ClassRow[] }>("/api/v1/admin/classes"),
    request<{ items: FoodRow[] }>("/api/v1/admin/foods"),
  ]);
  campaigns.value = campaignData.items || [];
  classes.value = classData.items || [];
  foods.value = foodData.items || [];
  if (!detailForm.campaignId && campaigns.value[0]) detailForm.campaignId = campaigns.value[0].campaignId;
};

const loadDetail = async () => {
  if (!detailForm.campaignId) {
    campaignDetail.value = null;
    return;
  }
  const params = new URLSearchParams();
  if (detailForm.shareToken.trim()) params.set("shareToken", detailForm.shareToken.trim());
  const query = params.toString();
  campaignDetail.value = await request(`/api/v1/food-campaigns/${encodeURIComponent(detailForm.campaignId)}${query ? `?${query}` : ""}`);
  if (!voteForm.foodId && detailOptions.value[0]) voteForm.foodId = detailOptions.value[0].foodId;
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await loadListData();
    if (detailForm.campaignId) await loadDetail();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载活动失败";
  } finally {
    loading.value = false;
  }
};

const selectCampaign = async (campaignId: string) => {
  detailForm.campaignId = campaignId;
  voteForm.foodId = "";
  await loadData();
};

const createCampaign = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const optionFoodIds = createForm.optionFoodIdsText.split(",").map((item) => item.trim()).filter(Boolean);
    await request("/api/v1/food-campaigns", {
      method: "POST",
      body: {
        title: createForm.title || undefined,
        classId: createForm.classId || undefined,
        deadlineAtIso: createForm.deadlineAtIso || undefined,
        isAnonymous: createForm.isAnonymous,
        optionFoodIds,
      },
    });
    createForm.title = "";
    createForm.deadlineAtIso = "";
    createForm.optionFoodIdsText = "";
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建活动失败";
  } finally {
    loading.value = false;
  }
};

const voteCampaign = async () => {
  if (!detailForm.campaignId || !voteForm.foodId) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/food-campaigns/${encodeURIComponent(detailForm.campaignId)}/vote`, {
      method: "POST",
      body: { foodId: voteForm.foodId, score: Math.max(1, Math.min(10, Number(voteForm.score || 1))) },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "提交投票失败";
  } finally {
    loading.value = false;
  }
};

const closeCampaign = async (item: CampaignRow) => {
  if (!window.confirm(`确认结束「${item.title || item.campaignId}」吗？`)) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/food-campaigns/${encodeURIComponent(item.campaignId)}/close`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "结束活动失败";
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
.campaign-layout,
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.35fr);
  gap: 1rem;
}

.detail-grid {
  align-items: start;
}

.side-stack {
  display: grid;
  gap: 1rem;
  align-self: start;
}

.compact-head {
  margin-bottom: 0.75rem;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
}

.selected-row {
  background: hsl(var(--muted) / 0.55);
}

.action-cell {
  white-space: nowrap;
}

.json-box {
  max-height: 32rem;
  overflow: auto;
  margin: 0;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.2rem);
  padding: 1rem;
  background: hsl(var(--muted) / 0.35);
  color: hsl(var(--foreground));
  font-size: 0.8rem;
}

@media (max-width: 1180px) {
  .campaign-layout,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
