<template>
  <NexusAdminShell title="Foods" description="食物库、候选审核、分类统计、热量校正与价格曲线管理。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Foods</span>
        <strong>{{ foods.length }}</strong>
        <p>当前筛选食物</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Candidates</span>
        <strong>{{ candidates.length }}</strong>
        <p>候选记录</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Pending</span>
        <strong>{{ pendingCandidateCount }}</strong>
        <p>待审核候选</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Rules</span>
        <strong>{{ rules.length }}</strong>
        <p>价格规则</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>
    <section v-if="successText" class="nexus-alert">{{ successText }}</section>

    <section class="foods-layout">
      <article class="rx-card main-card">
        <header class="rx-card-head">
          <div>
            <h2>食物主列表</h2>
            <p>支持分类与关键词筛选，编辑会同步影响活动候选。</p>
          </div>
          <div class="rx-actions">
            <button class="rx-btn rx-btn-ghost" type="button" @click="showCreate = !showCreate">{{ showCreate ? "收起新增" : "新增食物" }}</button>
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
          </div>
        </header>

        <div class="filter-row">
          <select v-model="foodQuery.categoryKey">
            <option value="">全部分类</option>
            <option v-for="item in categoryOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <input v-model.trim="foodQuery.keyword" placeholder="关键词：食物 / 商家 / 分类" @keyup.enter="loadData" />
          <button class="rx-btn" type="button" :disabled="loading" @click="loadData">筛选</button>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="resetFoodFilter">重置</button>
        </div>

        <form v-if="showCreate" class="nexus-form inline-form" @submit.prevent="createFood">
          <input v-model.trim="createFoodForm.foodName" placeholder="食物名称" />
          <input v-model.trim="createFoodForm.merchantName" placeholder="商家" />
          <input v-model.trim="createFoodForm.categoryKey" placeholder="分类键" />
          <input v-model.trim="createFoodForm.categoryName" placeholder="分类名" />
          <input v-model.number="createFoodForm.basePriceMin" type="number" min="0" step="0.1" placeholder="最低价" />
          <input v-model.number="createFoodForm.basePriceMax" type="number" min="0" step="0.1" placeholder="最高价" />
          <input v-model.number="createFoodForm.caloriesKcal" type="number" min="0" step="1" placeholder="热量 kcal" />
          <button class="rx-btn" type="submit" :disabled="loading || !createFoodForm.foodName || !createFoodForm.categoryKey">创建</button>
        </form>

        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>食物</th><th>分类</th><th>商家</th><th>价格</th><th>热量</th><th>坐标</th><th>活动</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in foods" :key="item.foodId" :class="{ 'selected-row': item.foodId === editFoodForm.foodId }">
                <td><strong>{{ item.foodName }}</strong><div class="rx-muted">{{ item.foodId }}</div></td>
                <td>{{ item.categoryName || item.categoryKey }}</td>
                <td>{{ item.merchantName }}</td>
                <td>{{ item.basePriceMin }} ~ {{ item.basePriceMax }}</td>
                <td>{{ item.caloriesKcal }} kcal</td>
                <td>{{ item.latitude }}, {{ item.longitude }}</td>
                <td>{{ item.linkedCampaignCount }}</td>
                <td class="action-cell">
                  <button class="rx-btn rx-btn-ghost" type="button" @click="selectFood(item)">编辑</button>
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="deleteFood(item)">删除</button>
                </td>
              </tr>
              <tr v-if="foods.length <= 0"><td colspan="8" class="rx-muted">暂无食物</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>编辑食物</h2><p>{{ editFoodForm.foodId || "请选择食物" }}</p></div></header>
          <div class="nexus-form">
            <input v-model.trim="editFoodForm.foodName" placeholder="食物名称" :disabled="!editFoodForm.foodId" />
            <input v-model.trim="editFoodForm.merchantName" placeholder="商家" :disabled="!editFoodForm.foodId" />
            <input v-model.trim="editFoodForm.categoryKey" placeholder="分类键" :disabled="!editFoodForm.foodId" />
            <input v-model.trim="editFoodForm.categoryName" placeholder="分类名" :disabled="!editFoodForm.foodId" />
            <div class="two-col">
              <input v-model.number="editFoodForm.basePriceMin" type="number" min="0" step="0.1" placeholder="最低价" :disabled="!editFoodForm.foodId" />
              <input v-model.number="editFoodForm.basePriceMax" type="number" min="0" step="0.1" placeholder="最高价" :disabled="!editFoodForm.foodId" />
            </div>
            <div class="two-col">
              <input v-model.number="editFoodForm.caloriesKcal" type="number" min="0" step="1" placeholder="热量" :disabled="!editFoodForm.foodId" />
              <input v-model.number="editFoodForm.distanceKm" type="number" min="0" step="0.1" placeholder="距离 km，仅展示兼容" disabled />
            </div>
            <div class="two-col">
              <input v-model.number="editFoodForm.latitude" type="number" step="0.000001" placeholder="纬度" :disabled="!editFoodForm.foodId" />
              <input v-model.number="editFoodForm.longitude" type="number" step="0.000001" placeholder="经度" :disabled="!editFoodForm.foodId" />
            </div>
            <button class="rx-btn" type="button" :disabled="loading || !editFoodForm.foodId || !editFoodForm.foodName || !editFoodForm.categoryKey" @click="saveFood">保存食物</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>CSV 导入</h2><p>支持 append / upsert。</p></div></header>
          <div class="nexus-form">
            <select v-model="csvForm.mode"><option value="append">append</option><option value="upsert">upsert</option></select>
            <textarea v-model.trim="csvForm.csvText" rows="6" placeholder="name,merchantName,categoryKey,..." />
            <div class="rx-actions left-actions">
              <button class="rx-btn rx-btn-ghost" type="button" @click="useCsvSample">样例</button>
              <button class="rx-btn" type="button" :disabled="loading || !csvForm.csvText" @click="importCsv">导入</button>
            </div>
            <pre v-if="csvSummary" class="mini-json">{{ toJson(csvSummary) }}</pre>
          </div>
        </article>
      </aside>
    </section>

    <section class="foods-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>候选审核</h2>
            <p>审核用户提交或文案抽取的候选食物。</p>
          </div>
          <span class="rx-pill">{{ filteredCandidates.length }} / {{ candidates.length }}</span>
        </header>
        <div class="filter-row candidate-filter-row">
          <select v-model="candidateQuery.status">
            <option value="pending_review">待审核</option>
            <option value="pending_eat">待体验</option>
            <option value="approved">已通过</option>
            <option value="rejected">已拒绝</option>
            <option value="all">全部</option>
          </select>
          <input v-model.trim="candidateQuery.keyword" placeholder="候选关键词" />
          <button class="rx-btn" type="button" @click="applyCandidateFilter">筛选</button>
          <button class="rx-btn rx-btn-ghost" type="button" @click="resetCandidateFilter">重置</button>
        </div>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>店铺</th><th>分类</th><th>来源</th><th>状态</th><th>提交人</th><th>凭证</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in filteredCandidates" :key="item.foodKey" :class="{ 'selected-row': item.foodKey === candidateForm.foodKey }">
                <td><strong>{{ item.name || item.foodKey }}</strong><div v-if="item.rawTextPreview" class="rx-muted raw-preview">{{ item.rawTextPreview }}</div></td>
                <td>{{ item.categoryName || item.categoryKey }}</td>
                <td>{{ formatCandidateSource(item.submissionMode) }}</td>
                <td><span class="rx-pill">{{ formatCandidateStatus(item.candidateStatus) }}</span></td>
                <td>{{ item.createdByStudentId || "-" }}</td>
                <td>{{ item.evidenceUrls?.length || 0 }}</td>
                <td><button class="rx-btn rx-btn-ghost" type="button" @click="selectCandidate(item)">审核</button></td>
              </tr>
              <tr v-if="filteredCandidates.length <= 0"><td colspan="7" class="rx-muted">暂无候选</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>候选详情</h2><p>{{ candidateForm.foodKey || "请选择候选" }}</p></div></header>
          <div class="nexus-form">
            <input v-model.trim="candidateForm.name" placeholder="店铺名称" :disabled="!candidateForm.foodKey" />
            <div class="two-col"><input v-model.trim="candidateForm.categoryKey" placeholder="分类键" :disabled="!candidateForm.foodKey" /><input v-model.trim="candidateForm.categoryName" placeholder="分类名" :disabled="!candidateForm.foodKey" /></div>
            <div class="two-col"><input v-model.trim="candidateForm.brandKey" placeholder="品牌键" :disabled="!candidateForm.foodKey" /><input v-model.trim="candidateForm.brandName" placeholder="品牌名" :disabled="!candidateForm.foodKey" /></div>
            <input v-model.trim="candidateForm.brandCombo" placeholder="热销搭配" :disabled="!candidateForm.foodKey" />
            <div class="two-col"><input v-model.number="candidateForm.dailyPriceMin" type="number" min="0" step="0.1" placeholder="日常最低价" :disabled="!candidateForm.foodKey" /><input v-model.number="candidateForm.dailyPriceMax" type="number" min="0" step="0.1" placeholder="日常最高价" :disabled="!candidateForm.foodKey" /></div>
            <div class="two-col"><input v-model.number="candidateForm.partyPriceMin" type="number" min="0" step="0.1" placeholder="聚会最低价" :disabled="!candidateForm.foodKey" /><input v-model.number="candidateForm.partyPriceMax" type="number" min="0" step="0.1" placeholder="聚会最高价" :disabled="!candidateForm.foodKey" /></div>
            <div class="two-col"><input v-model.number="candidateForm.distanceKm" type="number" min="0" step="0.1" placeholder="距离 km" :disabled="!candidateForm.foodKey" /><input v-model.number="candidateForm.caloriesKcal" type="number" min="0" step="1" placeholder="热量 kcal" :disabled="!candidateForm.foodKey" /></div>
            <textarea v-model.trim="candidateForm.rawText" rows="4" placeholder="原始文案" :disabled="!candidateForm.foodKey" />
            <textarea v-model.trim="candidateForm.note" rows="2" placeholder="备注" :disabled="!candidateForm.foodKey" />
            <textarea v-model.trim="candidateForm.reviewNote" rows="2" placeholder="审核备注" :disabled="!candidateForm.foodKey" />
            <div class="rx-actions left-actions">
              <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading || !candidateForm.foodKey || candidateForm.candidateStatus === 'approved'" @click="reviewCandidate('reject')">拒绝</button>
              <button class="rx-btn" type="button" :disabled="loading || !candidateForm.foodKey || !candidateForm.name || !candidateForm.categoryKey" @click="reviewCandidate('approve')">审核通过</button>
            </div>
          </div>
        </article>
      </aside>
    </section>

    <section class="analytics-grid">
      <article class="rx-card">
        <header class="rx-card-head"><div><h2>分类统计</h2><p>当前食物筛选范围内的分类聚合。</p></div></header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>分类</th><th>食物</th><th>商家</th><th>价格区间</th><th>均价</th><th>均热量</th><th>零热量</th></tr></thead>
            <tbody>
              <tr v-for="item in categoryStats" :key="item.categoryKey">
                <td><strong>{{ item.categoryName || item.categoryKey }}</strong><div class="rx-muted">{{ item.categoryKey }}</div></td>
                <td>{{ item.foodCount }}</td>
                <td>{{ item.merchantCount }}</td>
                <td>{{ item.minPrice }} ~ {{ item.maxPrice }}</td>
                <td>{{ item.avgPrice }}</td>
                <td>{{ item.avgCaloriesKcal }} kcal</td>
                <td>{{ item.zeroCaloriesCount }}</td>
              </tr>
              <tr v-if="categoryStats.length <= 0"><td colspan="7" class="rx-muted">暂无统计</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head"><div><h2>热量批量校正</h2><p>可 dry-run 预览或 commit 写入。</p></div></header>
        <div class="nexus-form">
          <div class="two-col"><select v-model="caloriesForm.scope"><option value="category">按分类</option><option value="all">全部</option></select><input v-model.trim="caloriesForm.categoryKey" placeholder="分类键" :disabled="caloriesForm.scope !== 'category'" /></div>
          <input v-model.trim="caloriesForm.keyword" placeholder="关键词，可空" />
          <div class="two-col"><select v-model="caloriesForm.writeMode"><option value="fill_missing">仅填空</option><option value="overwrite">覆盖</option></select><select v-model="caloriesForm.applyAction"><option value="dry_run">dry_run</option><option value="commit">commit</option></select></div>
          <div class="two-col"><input v-model.number="caloriesForm.priceWeight" type="number" step="1" placeholder="价格权重" /><input v-model.number="caloriesForm.baseShift" type="number" step="1" placeholder="基础偏移" /></div>
          <div class="two-col"><input v-model.number="caloriesForm.minKcal" type="number" step="1" placeholder="最小 kcal" /><input v-model.number="caloriesForm.maxKcal" type="number" step="1" placeholder="最大 kcal" /></div>
          <button class="rx-btn" type="button" :disabled="loading || (caloriesForm.scope === 'category' && !caloriesForm.categoryKey)" @click="recalculateCalories">执行校正</button>
          <pre v-if="caloriesSummary" class="mini-json">{{ toJson({ summary: caloriesSummary, examples: caloriesExamples.slice(0, 8) }) }}</pre>
        </div>
      </article>
    </section>

    <section class="analytics-grid">
      <article class="rx-card">
        <header class="rx-card-head"><div><h2>价格规则</h2><p>按分类保存价格曲线规则并形成历史版本。</p></div></header>
        <div class="rx-table-wrap compact-table">
          <table class="rx-table">
            <thead><tr><th>分类</th><th>模式</th><th>锚点</th><th>斜率</th><th>范围</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in rules" :key="item.categoryKey" :class="{ 'selected-row': item.categoryKey === pricingForm.categoryKey }">
                <td><strong>{{ item.categoryName }}</strong><div class="rx-muted">{{ item.categoryKey }}</div></td>
                <td>{{ item.trendMode }}</td>
                <td>{{ item.anchorHeadcount }}</td>
                <td>{{ item.slope }}</td>
                <td>{{ item.minFactor }} ~ {{ item.maxFactor }}</td>
                <td><button class="rx-btn rx-btn-ghost" type="button" @click="selectRule(item)">编辑</button></td>
              </tr>
              <tr v-if="rules.length <= 0"><td colspan="6" class="rx-muted">暂无规则</td></tr>
            </tbody>
          </table>
        </div>
        <div class="nexus-form rule-editor">
          <input v-model.trim="pricingForm.categoryKey" placeholder="分类键" />
          <input v-model.trim="pricingForm.categoryName" placeholder="分类名" />
          <div class="two-col"><select v-model="pricingForm.trendMode"><option value="down">down</option><option value="up">up</option></select><input v-model.number="pricingForm.anchorHeadcount" type="number" min="1" placeholder="锚点人数" /></div>
          <div class="three-col"><input v-model.number="pricingForm.slope" type="number" step="0.001" placeholder="斜率" /><input v-model.number="pricingForm.minFactor" type="number" step="0.01" placeholder="最小因子" /><input v-model.number="pricingForm.maxFactor" type="number" step="0.01" placeholder="最大因子" /></div>
          <button class="rx-btn" type="button" :disabled="loading || !pricingForm.categoryKey" @click="saveRule">保存规则</button>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head"><div><h2>曲线预览 / 历史</h2><p>预览人数变化价格，支持历史版本回滚。</p></div></header>
        <div class="nexus-form">
          <input v-model.trim="previewForm.categoryKey" placeholder="分类键" />
          <div class="two-col"><input v-model.number="previewForm.basePriceMin" type="number" step="0.1" placeholder="基础最低价" /><input v-model.number="previewForm.basePriceMax" type="number" step="0.1" placeholder="基础最高价" /></div>
          <div class="three-col"><input v-model.number="previewForm.headcountStart" type="number" min="1" placeholder="起点" /><input v-model.number="previewForm.headcountEnd" type="number" min="1" placeholder="终点" /><input v-model.number="previewForm.headcountStep" type="number" min="1" placeholder="步长" /></div>
          <button class="rx-btn" type="button" :disabled="loading" @click="previewRule">预览曲线</button>
        </div>
        <div v-if="previewPoints.length > 0" class="rx-table-wrap compact-table preview-table">
          <table class="rx-table">
            <thead><tr><th>人数</th><th>因子</th><th>最低价</th><th>最高价</th></tr></thead>
            <tbody><tr v-for="point in previewPoints" :key="point.headcount"><td>{{ point.headcount }}</td><td>{{ point.factor }}</td><td>{{ point.priceMin }}</td><td>{{ point.priceMax }}</td></tr></tbody>
          </table>
        </div>
        <div class="rx-table-wrap compact-table history-table">
          <table class="rx-table">
            <thead><tr><th>版本</th><th>分类</th><th>模式</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in ruleHistory" :key="item.versionId"><td>{{ item.versionId }}</td><td>{{ item.categoryName }}</td><td>{{ item.trendMode }}</td><td>{{ toDisplayDate(item.createdAt) }}</td><td><button class="rx-btn rx-btn-ghost" type="button" @click="rollbackRule(item.versionId)">回滚</button></td></tr>
              <tr v-if="ruleHistory.length <= 0"><td colspan="5" class="rx-muted">暂无历史版本</td></tr>
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

type CandidateAction = "approve" | "reject";

interface FoodRow {
  foodId: string;
  foodName: string;
  merchantName: string;
  categoryKey: string;
  categoryName: string;
  basePriceMin: number;
  basePriceMax: number;
  caloriesKcal: number;
  latitude: number;
  longitude: number;
  linkedCampaignCount?: number;
}

interface CandidateRow {
  foodKey: string;
  sourceFoodId: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  brandKey: string;
  brandName: string;
  brandCombo: string;
  candidateStatus: string;
  submissionMode: string;
  createdByStudentId: string;
  dailyPriceMin: number;
  dailyPriceMax: number;
  partyPriceMin: number;
  partyPriceMax: number;
  distanceKm: number;
  caloriesKcal: number;
  note: string;
  reviewNote: string;
  rawText: string;
  rawTextPreview: string;
  evidenceUrls: string[];
  extractionWarnings: string[];
  isCaloriesEstimated: boolean;
}

interface CategoryStatRow {
  categoryKey: string;
  categoryName: string;
  foodCount: number;
  merchantCount: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  avgCaloriesKcal: number;
  zeroCaloriesCount: number;
}

interface PricingRuleRow {
  categoryKey: string;
  categoryName: string;
  trendMode: "down" | "up";
  anchorHeadcount: number;
  slope: number;
  minFactor: number;
  maxFactor: number;
  updatedAt?: string;
}

interface PricingHistoryRow extends PricingRuleRow {
  versionId: string;
  createdAt: string | number;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const successText = ref("");
const showCreate = ref(false);
const foods = ref<FoodRow[]>([]);
const candidates = ref<CandidateRow[]>([]);
const categoryStats = ref<CategoryStatRow[]>([]);
const rules = ref<PricingRuleRow[]>([]);
const ruleHistory = ref<PricingHistoryRow[]>([]);
const previewPoints = ref<any[]>([]);
const csvSummary = ref<any>(null);
const caloriesSummary = ref<any>(null);
const caloriesExamples = ref<any[]>([]);

const foodQuery = reactive({ categoryKey: "", keyword: "" });
const candidateQuery = reactive({ status: "pending_review", keyword: "" });
const candidateApplied = reactive({ status: "pending_review", keyword: "" });
const createFoodForm = reactive({ foodName: "", merchantName: "", categoryKey: "", categoryName: "", basePriceMin: 10, basePriceMax: 20, caloriesKcal: 0, latitude: 31.23, longitude: 121.47 });
const editFoodForm = reactive({ foodId: "", foodName: "", merchantName: "", categoryKey: "", categoryName: "", basePriceMin: 10, basePriceMax: 20, caloriesKcal: 0, latitude: 31.23, longitude: 121.47, distanceKm: 0 });
const candidateForm = reactive<CandidateRow>({ foodKey: "", sourceFoodId: "", name: "", categoryKey: "", categoryName: "", brandKey: "", brandName: "", brandCombo: "", candidateStatus: "", submissionMode: "structured", createdByStudentId: "", dailyPriceMin: 0, dailyPriceMax: 0, partyPriceMin: 0, partyPriceMax: 0, distanceKm: 0, caloriesKcal: 0, note: "", reviewNote: "", rawText: "", rawTextPreview: "", evidenceUrls: [], extractionWarnings: [], isCaloriesEstimated: false });
const csvForm = reactive({ mode: "append", csvText: "" });
const caloriesForm = reactive({ scope: "category", categoryKey: "", keyword: "", writeMode: "fill_missing", applyAction: "dry_run", baseShift: 0, priceWeight: 16, minKcal: 120, maxKcal: 1500 });
const pricingForm = reactive<PricingRuleRow>({ categoryKey: "", categoryName: "", trendMode: "down", anchorHeadcount: 10, slope: 0.03, minFactor: 0.8, maxFactor: 1.2 });
const previewForm = reactive({ categoryKey: "", basePriceMin: 10, basePriceMax: 20, headcountStart: 1, headcountEnd: 30, headcountStep: 1 });

const pendingCandidateCount = computed(() => candidates.value.filter((item) => item.candidateStatus === "pending_review").length);
const categoryOptions = computed(() => {
  const map = new Map<string, string>();
  foods.value.forEach((item) => {
    if (item.categoryKey && !map.has(item.categoryKey)) map.set(item.categoryKey, item.categoryName || item.categoryKey);
  });
  categoryStats.value.forEach((item) => {
    if (item.categoryKey && !map.has(item.categoryKey)) map.set(item.categoryKey, item.categoryName || item.categoryKey);
  });
  return Array.from(map.entries()).map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
});
const filteredCandidates = computed(() => {
  const status = candidateApplied.status.trim().toLowerCase();
  const keyword = candidateApplied.keyword.trim().toLowerCase();
  return candidates.value.filter((item) => {
    if (status && status !== "all" && item.candidateStatus !== status) return false;
    if (!keyword) return true;
    return [item.name, item.categoryName, item.categoryKey, item.brandName, item.note, item.rawText, item.rawTextPreview, item.reviewNote]
      .map((entry) => String(entry || "").toLowerCase())
      .join(" ")
      .includes(keyword);
  });
});

const toJson = (value: unknown) => JSON.stringify(value || {}, null, 2);
const toDisplayDate = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0 && raw.length <= 13) return new Date(numeric).toLocaleString("zh-CN");
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : raw;
};

const setSuccess = (text: string) => {
  successText.value = text;
};

const normalizeStringList = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];

const normalizeCandidate = (item: any): CandidateRow => ({
  ...item,
  foodKey: String(item?.foodKey || ""),
  sourceFoodId: String(item?.sourceFoodId || ""),
  name: String(item?.name || ""),
  categoryKey: String(item?.categoryKey || ""),
  categoryName: String(item?.categoryName || ""),
  brandKey: String(item?.brandKey || ""),
  brandName: String(item?.brandName || ""),
  brandCombo: String(item?.brandCombo || ""),
  candidateStatus: String(item?.candidateStatus || ""),
  submissionMode: String(item?.submissionMode || "structured"),
  createdByStudentId: String(item?.createdByStudentId || ""),
  dailyPriceMin: Number(item?.dailyPriceMin || 0),
  dailyPriceMax: Number(item?.dailyPriceMax || 0),
  partyPriceMin: Number(item?.partyPriceMin || 0),
  partyPriceMax: Number(item?.partyPriceMax || 0),
  distanceKm: Number(item?.distanceKm || 0),
  caloriesKcal: Number(item?.caloriesKcal || 0),
  note: String(item?.note || ""),
  reviewNote: String(item?.reviewNote || ""),
  rawText: String(item?.rawText || ""),
  rawTextPreview: String(item?.rawTextPreview || ""),
  evidenceUrls: normalizeStringList(item?.evidenceUrls),
  extractionWarnings: normalizeStringList(item?.extractionWarnings),
  isCaloriesEstimated: Boolean(item?.isCaloriesEstimated),
});

const formatCandidateStatus = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "approved") return "已通过";
  if (value === "pending_eat") return "待体验";
  if (value === "pending_review") return "待审核";
  if (value === "rejected") return "已拒绝";
  return value || "未标记";
};
const formatCandidateSource = (mode: unknown) => String(mode || "").trim().toLowerCase() === "raw_text" ? "文案抽取" : "手动填写";

const buildFoodQuery = () => {
  const params = new URLSearchParams();
  if (foodQuery.categoryKey.trim()) params.set("categoryKey", foodQuery.categoryKey.trim());
  if (foodQuery.keyword.trim()) params.set("keyword", foodQuery.keyword.trim());
  const text = params.toString();
  return text ? `?${text}` : "";
};

const selectFood = (item: FoodRow) => {
  editFoodForm.foodId = item.foodId || "";
  editFoodForm.foodName = item.foodName || "";
  editFoodForm.merchantName = item.merchantName || "";
  editFoodForm.categoryKey = item.categoryKey || "";
  editFoodForm.categoryName = item.categoryName || "";
  editFoodForm.basePriceMin = Number(item.basePriceMin || 0);
  editFoodForm.basePriceMax = Number(item.basePriceMax || 0);
  editFoodForm.caloriesKcal = Number(item.caloriesKcal || 0);
  editFoodForm.latitude = Number(item.latitude || 31.23);
  editFoodForm.longitude = Number(item.longitude || 121.47);
};

const resetEditFood = () => {
  editFoodForm.foodId = "";
  editFoodForm.foodName = "";
  editFoodForm.merchantName = "";
  editFoodForm.categoryKey = "";
  editFoodForm.categoryName = "";
};

const selectCandidate = (item: CandidateRow) => {
  Object.assign(candidateForm, normalizeCandidate(item));
};

const resetCandidateForm = () => {
  Object.assign(candidateForm, normalizeCandidate({}));
};

const syncSelections = () => {
  const matchedFood = foods.value.find((item) => item.foodId === editFoodForm.foodId) || foods.value[0] || null;
  if (matchedFood) selectFood(matchedFood); else resetEditFood();
  const matchedCandidate = filteredCandidates.value.find((item) => item.foodKey === candidateForm.foodKey) || filteredCandidates.value[0] || null;
  if (matchedCandidate) selectCandidate(matchedCandidate); else resetCandidateForm();
  if (rules.value.length > 0 && !pricingForm.categoryKey) selectRule(rules.value[0]);
  if (!caloriesForm.categoryKey && categoryOptions.value[0]) caloriesForm.categoryKey = categoryOptions.value[0].value;
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  successText.value = "";
  try {
    const foodQueryText = buildFoodQuery();
    const [foodData, candidateData, statsData, ruleData, historyData] = await Promise.all([
      request<{ items: FoodRow[] }>(`/api/v1/admin/foods${foodQueryText}`),
      request<{ items: CandidateRow[] }>("/api/v1/admin/food-candidates?status=all"),
      request<{ items: CategoryStatRow[] }>(`/api/v1/admin/foods/category-stats${foodQueryText}`),
      request<{ items: PricingRuleRow[] }>("/api/v1/admin/food-pricing-rules"),
      request<{ items: PricingHistoryRow[] }>("/api/v1/admin/food-pricing-rules/history"),
    ]);
    foods.value = foodData.items || [];
    candidates.value = (candidateData.items || []).map(normalizeCandidate);
    categoryStats.value = statsData.items || [];
    rules.value = ruleData.items || [];
    ruleHistory.value = historyData.items || [];
    syncSelections();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载食物模块失败";
  } finally {
    loading.value = false;
  }
};

const resetFoodFilter = async () => {
  foodQuery.categoryKey = "";
  foodQuery.keyword = "";
  await loadData();
};

const applyCandidateFilter = () => {
  candidateApplied.status = candidateQuery.status || "pending_review";
  candidateApplied.keyword = candidateQuery.keyword.trim();
  syncSelections();
};
const resetCandidateFilter = () => {
  candidateQuery.status = "pending_review";
  candidateQuery.keyword = "";
  candidateApplied.status = "pending_review";
  candidateApplied.keyword = "";
  syncSelections();
};

const normalizePriceRange = (target: { basePriceMin: number; basePriceMax: number }) => {
  const min = Math.max(0, Number(target.basePriceMin || 0));
  const max = Math.max(min, Number(target.basePriceMax || 0));
  target.basePriceMin = min;
  target.basePriceMax = max;
};

const createFood = async () => {
  if (!createFoodForm.foodName.trim() || !createFoodForm.categoryKey.trim()) return;
  loading.value = true;
  errorText.value = "";
  try {
    normalizePriceRange(createFoodForm);
    await request("/api/v1/admin/foods", {
      method: "POST",
      body: {
        name: createFoodForm.foodName.trim(),
        merchantName: createFoodForm.merchantName.trim() || undefined,
        categoryKey: createFoodForm.categoryKey.trim().toLowerCase(),
        categoryName: createFoodForm.categoryName.trim() || undefined,
        basePriceMin: createFoodForm.basePriceMin,
        basePriceMax: createFoodForm.basePriceMax,
        caloriesKcal: Math.max(0, Number(createFoodForm.caloriesKcal || 0)),
        latitude: createFoodForm.latitude,
        longitude: createFoodForm.longitude,
      },
    });
    Object.assign(createFoodForm, { foodName: "", merchantName: "", categoryKey: "", categoryName: "", basePriceMin: 10, basePriceMax: 20, caloriesKcal: 0, latitude: 31.23, longitude: 121.47 });
    await loadData();
    setSuccess("食物已创建");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建食物失败";
  } finally {
    loading.value = false;
  }
};

const saveFood = async () => {
  if (!editFoodForm.foodId || !editFoodForm.foodName.trim() || !editFoodForm.categoryKey.trim()) return;
  loading.value = true;
  errorText.value = "";
  try {
    normalizePriceRange(editFoodForm);
    await request(`/api/v1/admin/foods/${encodeURIComponent(editFoodForm.foodId)}/update`, {
      method: "POST",
      body: {
        name: editFoodForm.foodName.trim(),
        merchantName: editFoodForm.merchantName.trim() || undefined,
        categoryKey: editFoodForm.categoryKey.trim().toLowerCase(),
        categoryName: editFoodForm.categoryName.trim() || undefined,
        basePriceMin: editFoodForm.basePriceMin,
        basePriceMax: editFoodForm.basePriceMax,
        caloriesKcal: Math.max(0, Number(editFoodForm.caloriesKcal || 0)),
        latitude: editFoodForm.latitude,
        longitude: editFoodForm.longitude,
      },
    });
    await loadData();
    setSuccess("食物已更新");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存食物失败";
  } finally {
    loading.value = false;
  }
};

const deleteFood = async (item: FoodRow) => {
  if (!window.confirm(`确认删除「${item.foodName || item.foodId}」吗？关联活动候选会自动重排。`)) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/foods/${encodeURIComponent(item.foodId)}/delete`, { method: "POST" });
    await loadData();
    setSuccess("食物已删除");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "删除食物失败";
  } finally {
    loading.value = false;
  }
};

const reviewCandidate = async (action: CandidateAction) => {
  if (!candidateForm.foodKey) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/food-candidates/${encodeURIComponent(candidateForm.foodKey)}/review`, {
      method: "POST",
      body: {
        action,
        name: action === "approve" ? candidateForm.name.trim() : undefined,
        categoryKey: action === "approve" ? candidateForm.categoryKey.trim().toLowerCase() : undefined,
        categoryName: action === "approve" ? candidateForm.categoryName.trim() || undefined : undefined,
        brandKey: action === "approve" ? candidateForm.brandKey.trim() || undefined : undefined,
        brandName: action === "approve" ? candidateForm.brandName.trim() || undefined : undefined,
        brandCombo: action === "approve" ? candidateForm.brandCombo.trim() || undefined : undefined,
        dailyPriceMin: action === "approve" ? Number(candidateForm.dailyPriceMin || 0) : undefined,
        dailyPriceMax: action === "approve" ? Number(candidateForm.dailyPriceMax || 0) : undefined,
        partyPriceMin: action === "approve" ? Number(candidateForm.partyPriceMin || 0) : undefined,
        partyPriceMax: action === "approve" ? Number(candidateForm.partyPriceMax || 0) : undefined,
        distanceKm: action === "approve" ? Number(candidateForm.distanceKm || 0) : undefined,
        caloriesKcal: action === "approve" ? Number(candidateForm.caloriesKcal || 0) : undefined,
        note: action === "approve" ? candidateForm.note.trim() || undefined : undefined,
        rawText: action === "approve" ? candidateForm.rawText.trim() || undefined : undefined,
        reviewNote: candidateForm.reviewNote.trim() || undefined,
      },
    });
    await loadData();
    setSuccess(action === "approve" ? "候选已通过" : "候选已拒绝");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "审核候选失败";
  } finally {
    loading.value = false;
  }
};

const useCsvSample = () => {
  csvForm.csvText = [
    "name,merchantName,categoryKey,categoryName,basePriceMin,basePriceMax,caloriesKcal,latitude,longitude",
    "黑椒鸡腿饭,食光小馆,main-meal,正餐,22,30,680,31.2301,121.4731",
    "青提轻乳茶,果饮站,drink,饮品,14,19,260,31.2298,121.4723",
  ].join("\n");
};

const importCsv = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ summary: any; errors: any[] }>("/api/v1/admin/foods/import-csv", { method: "POST", body: { mode: csvForm.mode, csvText: csvForm.csvText } });
    csvSummary.value = data;
    await loadData();
    setSuccess("CSV 导入完成");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "CSV 导入失败";
  } finally {
    loading.value = false;
  }
};

const recalculateCalories = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ summary: any; examples: any[]; categoryStats: CategoryStatRow[] }>("/api/v1/admin/foods/calories/recalculate", { method: "POST", body: caloriesForm });
    caloriesSummary.value = data.summary;
    caloriesExamples.value = data.examples || [];
    categoryStats.value = data.categoryStats || categoryStats.value;
    await loadData();
    setSuccess("热量校正已执行");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "热量校正失败";
  } finally {
    loading.value = false;
  }
};

function selectRule(item: PricingRuleRow) {
  pricingForm.categoryKey = item.categoryKey || "";
  pricingForm.categoryName = item.categoryName || "";
  pricingForm.trendMode = item.trendMode === "up" ? "up" : "down";
  pricingForm.anchorHeadcount = Number(item.anchorHeadcount || 10);
  pricingForm.slope = Number(item.slope || 0.03);
  pricingForm.minFactor = Number(item.minFactor || 0.8);
  pricingForm.maxFactor = Number(item.maxFactor || 1.2);
  previewForm.categoryKey = pricingForm.categoryKey;
}

const saveRule = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/food-pricing-rules", { method: "POST", body: pricingForm });
    await loadData();
    setSuccess("价格规则已保存");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存价格规则失败";
  } finally {
    loading.value = false;
  }
};

const previewRule = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ preview: { points: any[] } }>("/api/v1/admin/food-pricing-rules/preview", { method: "POST", body: previewForm });
    previewPoints.value = data.preview?.points || [];
    setSuccess("曲线预览已更新");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "预览曲线失败";
  } finally {
    loading.value = false;
  }
};

const rollbackRule = async (versionId: string) => {
  if (!window.confirm(`确认回滚到版本 ${versionId} 吗？`)) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/food-pricing-rules/rollback", { method: "POST", body: { versionId } });
    await loadData();
    setSuccess("价格规则已回滚");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "回滚价格规则失败";
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
.foods-layout,
.analytics-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.35fr);
  gap: 1rem;
}

.main-card {
  min-width: 0;
}

.side-stack {
  display: grid;
  gap: 1rem;
  align-self: start;
}

.filter-row {
  display: grid;
  grid-template-columns: 12rem minmax(14rem, 1fr) auto auto;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.candidate-filter-row {
  grid-template-columns: 10rem minmax(14rem, 1fr) auto auto;
}

.filter-row input,
.filter-row select {
  min-height: 2.5rem;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 0.25rem);
  padding: 0.55rem 0.75rem;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.inline-form {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 1rem;
}

.two-col,
.three-col {
  display: grid;
  gap: 0.5rem;
}

.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.three-col {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.compact-head {
  margin-bottom: 0.75rem;
}

.left-actions {
  justify-content: flex-start;
}

.action-cell {
  white-space: nowrap;
}

.selected-row {
  background: hsl(var(--muted) / 0.55);
}

.raw-preview {
  max-width: 22rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-json {
  max-height: 14rem;
  overflow: auto;
  margin: 0;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.2rem);
  padding: 0.75rem;
  background: hsl(var(--muted) / 0.35);
  color: hsl(var(--foreground));
  font-size: 0.75rem;
  white-space: pre-wrap;
}

.rule-editor,
.preview-table,
.history-table {
  margin-top: 1rem;
}

.compact-table {
  max-height: 22rem;
}

@media (max-width: 1180px) {
  .foods-layout,
  .analytics-grid,
  .filter-row,
  .candidate-filter-row,
  .inline-form {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .two-col,
  .three-col {
    grid-template-columns: 1fr;
  }
}
</style>
