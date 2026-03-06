<template>
  <PageContainer title="食物候选池">
    <view class="page">
      <!-- 筛选 -->
      <view class="filter-card">
        <view class="filter-header">
          <view class="filter-title">候选食物</view>
          <view class="filter-actions">
            <button class="refresh-btn" @click="loadCandidates">↻</button>
            <button class="add-btn" @click="showSubmitSheet = true">+ 提报</button>
          </view>
        </view>

        <view class="filter-chips">
          <view
            v-for="item in statusOptions"
            :key="`status-${item.value}`"
            class="filter-chip"
            :class="{ active: filters.status === item.value }"
            @click="changeStatus(item.value)"
          >
            {{ item.label }}
          </view>
          <view class="filter-chip" :class="{ active: filters.mineOnly }" @click="toggleMineOnly">我提交的</view>
        </view>

        <view class="search-row">
          <input v-model.trim="filters.categoryKey" class="search-input half" type="text" placeholder="分类筛选" />
          <input v-model.trim="filters.brandKey" class="search-input half" type="text" placeholder="品牌筛选" />
        </view>
        <view class="search-row">
          <input v-model.trim="filters.keyword" class="search-input" type="text" placeholder="搜索店名、备注…" />
          <button class="apply-btn" :class="{ pending: pending.load }" @click="loadCandidates">
            {{ pending.load ? "加载中" : "筛选" }}
          </button>
        </view>
      </view>

      <!-- 列表 -->
      <view class="list-header">
        <view class="list-count">共 {{ candidates.length }} 项</view>
      </view>

      <view v-if="candidates.length === 0" class="empty-state">
        <view class="empty-icon">🍜</view>
        <view class="empty-text">暂无匹配的候选食物</view>
        <view class="empty-sub">点击右上角「提报」添加新店铺</view>
      </view>

      <view v-for="item in candidates" :key="item.foodKey" class="food-item">
        <view class="food-item-top">
          <view class="food-item-name">{{ item.name || item.foodKey }}</view>
          <view class="food-item-status" :class="candidateStatusClass(item.candidateStatus)">
            {{ item.candidateStatusLabel || statusLabel(item.candidateStatus) }}
          </view>
        </view>
        <view class="food-item-meta">
          {{ item.categoryName || item.categoryKey || "未分类" }}
          <text v-if="item.brandName"> · {{ item.brandName }}</text>
          · {{ formatNumber(item.distanceKm) }}km
        </view>
        <view class="food-item-price">
          <view class="price-group">
            <text class="price-label">日常</text>
            <text>¥{{ formatNumber(item.dailyPriceMin) }}~{{ formatNumber(item.dailyPriceMax) }}</text>
          </view>
          <view class="price-group">
            <text class="price-label">聚会</text>
            <text>¥{{ formatNumber(item.partyPriceMin) }}~{{ formatNumber(item.partyPriceMax) }}</text>
          </view>
        </view>
        <view class="food-item-note" v-if="item.brandCombo">热销搭配：{{ item.brandCombo }}</view>
        <view class="food-item-note" v-if="item.note">{{ item.note }}</view>
        <view class="food-item-footer" v-if="item.createdByStudentId">
          <text class="footer-label">提交人 {{ item.createdByStudentId }}</text>
        </view>
      </view>

      <!-- 提报新店铺弹窗 -->
      <view class="sheet-mask" v-if="showSubmitSheet" @click.self="showSubmitSheet = false">
        <view class="sheet-container" @click.stop>
          <view class="sheet-header">
            <view class="sheet-title">提报新店铺</view>
            <view class="sheet-close" @click="showSubmitSheet = false">✕</view>
          </view>
          <scroll-view scroll-y class="sheet-scroll">
            <view class="sheet-body">
              <view class="sheet-desc">提交后需管理员审核通过才会进入候选池</view>

              <view class="sheet-field">
                <view class="sheet-label">店铺名称<text class="sheet-req">*</text></view>
                <input v-model.trim="submitForm.name" class="sheet-input" type="text" placeholder="例如：刘文祥" />
              </view>

              <view class="sheet-field">
                <view class="sheet-label">分类<text class="sheet-req">*</text></view>
                <input v-model.trim="submitForm.categoryKey" class="sheet-input" type="text" placeholder="例如：maocai、hotpot、noodle" />
              </view>

              <view class="sheet-row">
                <view class="sheet-field half">
                  <view class="sheet-label">品牌</view>
                  <input v-model.trim="submitForm.brandKey" class="sheet-input" type="text" placeholder="例如：mixue" />
                </view>
                <view class="sheet-field half">
                  <view class="sheet-label">品牌名</view>
                  <input v-model.trim="submitForm.brandName" class="sheet-input" type="text" placeholder="例如：蜜雪冰城" />
                </view>
              </view>

              <view class="sheet-field">
                <view class="sheet-label">热销搭配</view>
                <input v-model.trim="submitForm.brandCombo" class="sheet-input" type="text" placeholder="例如：冰鲜柠檬水+新鲜冰淇淋" />
              </view>

              <view class="sheet-divider-label">价格信息</view>

              <view class="sheet-row">
                <view class="sheet-field half">
                  <view class="sheet-label">日常最低</view>
                  <input v-model.trim="submitForm.dailyMin" class="sheet-input" type="number" placeholder="¥" />
                </view>
                <view class="sheet-field half">
                  <view class="sheet-label">日常最高</view>
                  <input v-model.trim="submitForm.dailyMax" class="sheet-input" type="number" placeholder="¥" />
                </view>
              </view>

              <view class="sheet-row">
                <view class="sheet-field half">
                  <view class="sheet-label">聚会最低</view>
                  <input v-model.trim="submitForm.partyMin" class="sheet-input" type="number" placeholder="¥" />
                </view>
                <view class="sheet-field half">
                  <view class="sheet-label">聚会最高</view>
                  <input v-model.trim="submitForm.partyMax" class="sheet-input" type="number" placeholder="¥" />
                </view>
              </view>

              <view class="sheet-field">
                <view class="sheet-label">距离（km）</view>
                <input v-model.trim="submitForm.distanceKm" class="sheet-input" type="number" placeholder="例如：1.2" />
              </view>

              <view class="sheet-field">
                <view class="sheet-label">备注</view>
                <textarea v-model.trim="submitForm.note" class="sheet-textarea" placeholder="补充说明…" />
              </view>

              <button class="sheet-submit-btn" :class="{ pending: pending.submit }" @click="submitCandidate">
                {{ pending.submit ? "提交中..." : "提交审核" }}
              </button>
            </view>
          </scroll-view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import {
  guardProfilePageAccess,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

type CandidateStatus = "all" | "approved" | "pending_eat" | "pending_review";

interface FoodCandidateItem {
  foodKey: string;
  name: string;
  categoryKey: string;
  categoryName?: string;
  brandKey?: string;
  brandName?: string;
  brandCombo?: string;
  candidateStatus: string;
  candidateStatusLabel?: string;
  note?: string;
  createdByStudentId?: string;
  distanceKm: number;
  dailyPriceMin: number;
  dailyPriceMax: number;
  partyPriceMin: number;
  partyPriceMax: number;
}

interface FoodCandidateListResponse {
  ok?: boolean;
  items?: FoodCandidateItem[];
}

interface FoodCandidateSubmitResponse {
  ok?: boolean;
  item?: FoodCandidateItem;
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const statusText = ref("准备就绪");
const candidates = ref<FoodCandidateItem[]>([]);
const showSubmitSheet = ref(false);

const pending = ref({
  load: false,
  submit: false,
});

const statusOptions = [
  { value: "all", label: "全部" },
  { value: "approved", label: "已通过" },
  { value: "pending_eat", label: "待体验" },
  { value: "pending_review", label: "待审核" },
] as const;

const filters = ref({
  status: "all" as CandidateStatus,
  categoryKey: "",
  brandKey: "",
  keyword: "",
  mineOnly: false,
});

const submitForm = ref({
  name: "",
  categoryKey: "",
  brandKey: "",
  brandName: "",
  brandCombo: "",
  dailyMin: "",
  dailyMax: "",
  partyMin: "",
  partyMax: "",
  distanceKm: "",
  note: "",
});

const ensureAuthed = () => {
  if (!authSession.value.token || !authSession.value.user) {
    throw new Error("请先在账号页完成登录授权");
  }
};

const formatNumber = (value: unknown) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return "0";
  }
  return `${Math.round(num * 100) / 100}`;
};

const statusLabel = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "approved") return "已通过";
  if (value === "pending_eat") return "待体验";
  if (value === "pending_review") return "待审核";
  if (value === "rejected") return "已拒绝";
  return value || "未标记";
};

const candidateStatusClass = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "approved") return "cs-approved";
  if (value === "pending_eat") return "cs-pending";
  if (value === "pending_review") return "cs-review";
  if (value === "rejected") return "cs-rejected";
  return "";
};

const normalizeItems = (items: FoodCandidateItem[]) => {
  const result: FoodCandidateItem[] = [];
  for (const item of items || []) {
    const foodKey = String(item.foodKey || "").trim();
    if (!foodKey) {
      continue;
    }
    result.push({
      ...item,
      foodKey,
      name: String(item.name || "").trim(),
      categoryKey: String(item.categoryKey || "").trim(),
      categoryName: String(item.categoryName || "").trim(),
      brandKey: String(item.brandKey || "").trim(),
      brandName: String(item.brandName || "").trim(),
      brandCombo: String(item.brandCombo || "").trim(),
      candidateStatus: String(item.candidateStatus || "").trim(),
      candidateStatusLabel: String(item.candidateStatusLabel || "").trim(),
      note: String(item.note || "").trim(),
      createdByStudentId: String(item.createdByStudentId || "").trim(),
      distanceKm: Number(item.distanceKm || 0),
      dailyPriceMin: Number(item.dailyPriceMin || 0),
      dailyPriceMax: Number(item.dailyPriceMax || 0),
      partyPriceMin: Number(item.partyPriceMin || 0),
      partyPriceMax: Number(item.partyPriceMax || 0),
    });
  }
  return result;
};

const loadCandidates = async () => {
  if (pending.value.load) {
    return;
  }
  pending.value.load = true;
  try {
    ensureAuthed();
    const response = await requestBackendGet<FoodCandidateListResponse>(
      backendBaseUrl.value,
      "/api/social/food-candidates",
      {
        status: filters.value.status,
        category_key: String(filters.value.categoryKey || "").trim(),
        brand_key: String(filters.value.brandKey || "").trim(),
        keyword: String(filters.value.keyword || "").trim(),
        mine_only: filters.value.mineOnly ? "1" : "0",
      },
      authSession.value.token,
    );
    candidates.value = normalizeItems(Array.isArray(response.items) ? response.items : []);
    statusText.value = `已加载 ${candidates.value.length} 条`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载失败";
    statusText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.load = false;
  }
};

const readPriceValue = (raw: string, label: string) => {
  const value = Number(String(raw || "").trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须是 ≥0 的数字`);
  }
  return value;
};

const submitCandidate = async () => {
  if (pending.value.submit) {
    return;
  }
  pending.value.submit = true;
  try {
    ensureAuthed();
    const name = String(submitForm.value.name || "").trim();
    const categoryKey = String(submitForm.value.categoryKey || "").trim().toLowerCase();
    if (!name) {
      throw new Error("请填写店铺名称");
    }
    if (!categoryKey) {
      throw new Error("请填写分类");
    }
    const dailyMin = readPriceValue(submitForm.value.dailyMin, "日常最低价");
    const dailyMax = readPriceValue(submitForm.value.dailyMax, "日常最高价");
    const partyMin = readPriceValue(submitForm.value.partyMin, "聚会最低价");
    const partyMax = readPriceValue(submitForm.value.partyMax, "聚会最高价");
    const distanceKm = readPriceValue(submitForm.value.distanceKm, "距离");
    if (dailyMax < dailyMin) {
      throw new Error("日常最高价不能低于最低价");
    }
    if (partyMax < partyMin) {
      throw new Error("聚会最高价不能低于最低价");
    }
    const payload = {
      name,
      category_key: categoryKey,
      brand_key: String(submitForm.value.brandKey || "").trim(),
      brand_name: String(submitForm.value.brandName || "").trim(),
      brand_combo: String(submitForm.value.brandCombo || "").trim(),
      daily_price_min: dailyMin,
      daily_price_max: dailyMax,
      party_price_min: partyMin,
      party_price_max: partyMax,
      distance_km: distanceKm,
      note: String(submitForm.value.note || "").trim(),
    };
    await requestBackendPost<FoodCandidateSubmitResponse>(
      backendBaseUrl.value,
      "/api/social/food-candidates",
      payload,
      authSession.value.token,
    );
    submitForm.value = {
      name: "",
      categoryKey: "",
      brandKey: "",
      brandName: "",
      brandCombo: "",
      dailyMin: "",
      dailyMax: "",
      partyMin: "",
      partyMax: "",
      distanceKm: "",
      note: "",
    };
    showSubmitSheet.value = false;
    filters.value.status = "pending_review";
    await loadCandidates();
    uni.showToast({ title: "已提交，等待审核", icon: "none", duration: 1600 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.submit = false;
  }
};

const changeStatus = (status: CandidateStatus) => {
  if (filters.value.status === status) {
    return;
  }
  filters.value.status = status;
  void loadCandidates();
};

const toggleMineOnly = () => {
  filters.value.mineOnly = !filters.value.mineOnly;
  void loadCandidates();
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  if (!authSession.value.token || !authSession.value.user) {
    statusText.value = "请先登录授权";
    candidates.value = [];
    return;
  }
  void loadCandidates();
});
</script>

<style scoped>
.page {
  padding: 20rpx;
  box-sizing: border-box;
}

/* Filter Card */
.filter-card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  padding: 20rpx 18rpx;
  margin-bottom: 16rpx;
}

.filter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  margin-bottom: 14rpx;
}

.filter-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.refresh-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-sub);
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.add-btn {
  border: none;
  border-radius: 12rpx;
  padding: 10rpx 18rpx;
  font-size: 24rpx;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-bottom: 12rpx;
}

.filter-chip {
  border: 1rpx solid var(--line);
  border-radius: 999rpx;
  padding: 8rpx 16rpx;
  font-size: 24rpx;
  color: var(--text-sub);
  background: var(--muted-bg);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.filter-chip.active {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--line) 50%);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
  font-weight: 600;
}

.search-row {
  display: flex;
  gap: 10rpx;
  margin-bottom: 10rpx;
}

.search-row:last-child {
  margin-bottom: 0;
}

.search-input {
  flex: 1;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 26rpx;
  padding: 12rpx 14rpx;
}

.search-input.half {
  flex: 1;
}

.apply-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 12rpx;
  padding: 12rpx 20rpx;
  font-size: 24rpx;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
}

.apply-btn.pending {
  opacity: 0.7;
}

/* List */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
  padding: 0 4rpx;
}

.list-count {
  font-size: 24rpx;
  color: var(--text-sub);
}

.empty-state {
  padding: 60rpx 20rpx;
  text-align: center;
}

.empty-icon {
  font-size: 56rpx;
  margin-bottom: 12rpx;
}

.empty-text {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--text-main);
}

.empty-sub {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

/* Food Item */
.food-item {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  padding: 16rpx 14rpx;
  margin-bottom: 10rpx;
}

.food-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
}

.food-item-name {
  font-size: 28rpx;
  color: var(--text-main);
  font-weight: 700;
  flex: 1;
  min-width: 0;
}

.food-item-status {
  flex-shrink: 0;
  font-size: 20rpx;
  font-weight: 600;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-sub);
}

.food-item-status.cs-approved {
  border-color: color-mix(in srgb, #22c55e 25%, var(--line) 75%);
  color: #16a34a;
  background: color-mix(in srgb, #22c55e 8%, var(--muted-bg) 92%);
}

.food-item-status.cs-pending {
  border-color: color-mix(in srgb, #f59e0b 25%, var(--line) 75%);
  color: #d97706;
  background: color-mix(in srgb, #f59e0b 8%, var(--muted-bg) 92%);
}

.food-item-status.cs-review {
  border-color: color-mix(in srgb, var(--accent) 25%, var(--line) 75%);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--muted-bg) 92%);
}

.food-item-status.cs-rejected {
  border-color: color-mix(in srgb, #ef4444 25%, var(--line) 75%);
  color: #dc2626;
  background: color-mix(in srgb, #ef4444 8%, var(--muted-bg) 92%);
}

.food-item-meta {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.food-item-price {
  margin-top: 8rpx;
  display: flex;
  gap: 20rpx;
}

.price-group {
  font-size: 22rpx;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.price-label {
  font-size: 20rpx;
  color: var(--text-sub);
}

.food-item-note {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-main);
  line-height: 1.4;
}

.food-item-footer {
  margin-top: 8rpx;
}

.footer-label {
  font-size: 20rpx;
  color: var(--text-sub);
}

/* Bottom Sheet */
.sheet-mask {
  position: fixed;
  inset: 0;
  background: var(--mask-bg, rgba(0, 0, 0, 0.45));
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet-container {
  width: 100%;
  max-width: 750rpx;
  max-height: 85vh;
  background: var(--card-bg);
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
  animation: sheet-slide-up 0.25s ease-out;
}

@keyframes sheet-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 28rpx 16rpx;
  border-bottom: 1rpx solid var(--line);
  flex-shrink: 0;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--text-main);
}

.sheet-close {
  width: 52rpx;
  height: 52rpx;
  border-radius: 999rpx;
  background: var(--muted-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: var(--text-sub);
}

.sheet-scroll {
  flex: 1;
  min-height: 0;
}

.sheet-body {
  padding: 20rpx 28rpx calc(24rpx + env(safe-area-inset-bottom));
}

.sheet-desc {
  font-size: 24rpx;
  color: var(--text-sub);
  margin-bottom: 20rpx;
}

.sheet-field {
  margin-bottom: 16rpx;
}

.sheet-field.half {
  flex: 1;
  min-width: 0;
}

.sheet-row {
  display: flex;
  gap: 12rpx;
  margin-bottom: 16rpx;
}

.sheet-label {
  font-size: 24rpx;
  color: var(--text-main);
  font-weight: 600;
  margin-bottom: 8rpx;
}

.sheet-req {
  color: var(--danger, #d94848);
  margin-left: 4rpx;
}

.sheet-input {
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 28rpx;
  padding: 14rpx;
}

.sheet-textarea {
  width: 100%;
  min-height: 100rpx;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 26rpx;
  padding: 14rpx;
}

.sheet-divider-label {
  font-size: 24rpx;
  color: var(--text-sub);
  font-weight: 600;
  margin-bottom: 12rpx;
  padding-top: 4rpx;
  border-top: 1rpx solid color-mix(in srgb, var(--line) 50%, transparent);
}

.sheet-submit-btn {
  width: 100%;
  border: none;
  border-radius: 14rpx;
  padding: 20rpx;
  font-size: 28rpx;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
  margin-top: 8rpx;
}

.sheet-submit-btn.pending {
  opacity: 0.7;
}
</style>
