<template>
  <PageContainer title="发起拼单">
    <view class="page">
      <!-- 已有进行中拼单提示 -->
      <view class="alert-card" v-if="myOpenCampaign">
        <view class="alert-icon">⚠</view>
        <view class="alert-body">
          <view class="alert-title">你已有进行中的拼单</view>
          <view class="alert-desc">{{ resolveCampaignTitle(myOpenCampaign) }} · 截止于 {{ formatTime(myOpenCampaign.deadlineAt) }}</view>
        </view>
        <button class="alert-action" @click="openExistingCampaign">查看</button>
      </view>

      <!-- 基础设置 -->
      <view class="form-section">
        <view class="form-section-header">
          <view class="form-section-title">基础设置</view>
          <button class="refresh-btn" @click="refreshMyOpenCampaign">↻</button>
        </view>

        <view class="form-field">
          <view class="form-label">拼单标题<text class="form-label-opt">（选填）</text></view>
          <input v-model.trim="createForm.title" class="form-input" type="text" placeholder="默认：当前时间发布的拼单" />
        </view>

        <view class="form-field">
          <view class="form-label">档位模板</view>
          <view class="form-chips">
            <view
              v-for="item in templateOptions"
              :key="item.value"
              class="form-chip"
              :class="{ active: createForm.templateKey === item.value }"
              @click="changeTemplate(item.value)"
            >
              {{ item.label }}
            </view>
          </view>
        </view>

        <view class="form-field">
          <view class="form-label">参与方式</view>
          <view class="form-chips">
            <view
              v-for="item in joinModeOptions"
              :key="item.value"
              class="form-chip"
              :class="{ active: createForm.joinMode === item.value }"
              @click="changeJoinMode(item.value)"
            >
              {{ item.label }}
            </view>
          </view>
        </view>

        <view class="form-field">
          <view class="form-label">选择模式</view>
          <view class="form-chips">
            <view class="form-chip" :class="{ active: createForm.isAnonymous }" @click="createForm.isAnonymous = true">匿名选择</view>
            <view class="form-chip" :class="{ active: !createForm.isAnonymous }" @click="createForm.isAnonymous = false">实名选择</view>
          </view>
          <view class="form-hint" v-if="createForm.isAnonymous">选择期间仅自己可见，结束后持分享码可查看实名明细</view>
          <view class="form-hint" v-else>全程公开可见选择明细</view>
        </view>
      </view>

      <!-- 价位与偏好 -->
      <view class="form-section">
        <view class="form-section-header">
          <view class="form-section-title">价位与偏好</view>
        </view>

        <view class="form-field">
          <view class="form-label">价位档<text class="form-label-req">（选 3~4 个）</text></view>
          <view class="form-chips">
            <view
              v-for="tier in activeTierOptions"
              :key="tier.id"
              class="form-chip"
              :class="{ active: createForm.selectedTierIds.includes(tier.id), warn: Boolean(tier.danger) }"
              @click="toggleTier(tier.id)"
            >
              {{ tier.label }}
            </view>
          </view>
        </view>

        <view class="form-field">
          <view class="form-label">品类偏好<text class="form-label-opt">（选填，可多选）</text></view>
          <view class="form-chips">
            <view
              v-for="item in categoryOptions"
              :key="item.id"
              class="form-chip"
              :class="{ active: createForm.selectedCategoryKeys.includes(item.id) }"
              @click="toggleCategory(item.id)"
            >
              {{ item.label }}
              <text v-if="item.count" class="chip-count">{{ item.count }}</text>
            </view>
          </view>
        </view>

        <view class="form-field">
          <view class="form-label">品牌偏好<text class="form-label-opt">（选填，适用饮品/下午茶）</text></view>
          <view class="form-chips">
            <view
              v-for="item in brandOptions"
              :key="item.id"
              class="form-chip"
              :class="{ active: createForm.selectedBrandKeys.includes(item.id) }"
              @click="toggleBrand(item.id)"
            >
              {{ item.label }}
              <text v-if="item.count" class="chip-count">{{ item.count }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 高级设置 -->
      <view class="form-section">
        <view class="form-section-header" @click="showAdvanced = !showAdvanced">
          <view class="form-section-title">高级设置</view>
          <view class="form-section-toggle">{{ showAdvanced ? '收起' : '展开' }}</view>
        </view>

        <template v-if="showAdvanced">
          <view class="form-row">
            <view class="form-field half">
              <view class="form-label">每人可选</view>
              <input v-model.trim="createForm.maxVotesPerUser" class="form-input" type="number" placeholder="1" />
              <view class="form-hint">1~3 项</view>
            </view>
            <view class="form-field half">
              <view class="form-label">截止时间</view>
              <input v-model.trim="createForm.deadlineMinutes" class="form-input" type="number" placeholder="180" />
              <view class="form-hint">默认 180 分钟，最长 360 分钟</view>
            </view>
          </view>

          <view class="form-field" v-if="createForm.joinMode === 'password'">
            <view class="form-label">参与密码<text class="form-label-req">（4~32 位）</text></view>
            <input v-model.trim="createForm.joinPassword" class="form-input" type="text" password placeholder="例如：2580" />
          </view>

          <view class="form-field" v-if="createForm.joinMode === 'invite' || createForm.joinMode === 'password'">
            <view class="form-label">邀请参与人</view>
            <view class="invitee-row">
              <button class="invitee-btn" @click="openInviteePicker">选择参与人</button>
              <button class="invitee-btn ghost" @click="clearInvitees" :disabled="createForm.inviteeStudentIds.length === 0">清空</button>
            </view>
            <view v-if="createForm.inviteeStudentIds.length === 0" class="form-hint">暂未选择参与人</view>
            <view v-else class="form-chips" style="margin-top: 10rpx;">
              <view v-for="studentId in createForm.inviteeStudentIds" :key="`invitee-${studentId}`" class="form-chip active">
                {{ studentId }}
              </view>
            </view>
          </view>
        </template>
      </view>

      <!-- 提交按钮 -->
      <button class="submit-btn" :disabled="Boolean(myOpenCampaign)" :class="{ pending: pendingCreate }" @click="createCampaign">
        {{ pendingCreate ? "创建中..." : "确认发起拼单" }}
      </button>

      <!-- 创建成功卡片 -->
      <view class="success-card" v-if="createdCampaign">
        <view class="success-header">
          <view class="success-icon">✓</view>
          <view class="success-title">创建成功</view>
        </view>
        <view class="success-info">
          <view class="success-name">{{ resolveCampaignTitle(createdCampaign) }}</view>
          <view class="success-meta">{{ createdCampaign.isAnonymous ? "匿名" : "实名" }} · 分享码：{{ createdCampaign.shareToken || "-" }}</view>
        </view>
        <view class="success-actions">
          <button class="success-btn accent" @click="openCreatedCampaign">查看详情</button>
          <button class="success-btn" @click="copyShareToken">复制分享码</button>
          <button class="success-btn" @click="copyShareLink">复制链接</button>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
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

type TemplateKey = "daily" | "party";
type FoodCampaignJoinMode = "all" | "invite" | "password";

interface FoodCampaignSummary {
  campaignId: string;
  title: string;
  initiatorStudentId?: string;
  status?: string;
  deadlineAt?: number;
  shareToken?: string;
  isAnonymous?: boolean;
}

interface FoodCampaignDetail extends FoodCampaignSummary {
  joinMode?: FoodCampaignJoinMode;
}

interface CampaignListResponse {
  ok?: boolean;
  items?: FoodCampaignSummary[];
}

interface CampaignDetailResponse {
  ok?: boolean;
  campaign?: FoodCampaignDetail;
}

interface InviteeStoragePayload {
  selectedStudentIds?: string[];
}

interface FoodFilterOption {
  id: string;
  label: string;
  count: number;
}

interface FoodCategoryOptionResponse {
  categoryKey?: string;
  categoryName?: string;
  count?: number;
}

interface FoodBrandOptionResponse {
  brandKey?: string;
  brandName?: string;
  count?: number;
}

interface FoodFilterOptionsResponse {
  ok?: boolean;
  categories?: FoodCategoryOptionResponse[];
  brands?: FoodBrandOptionResponse[];
}

const FOOD_CAMPAIGN_INVITEE_STORAGE_KEY = "touchx_food_campaign_invitees";
const FOOD_CAMPAIGN_CREATED_ID_STORAGE_KEY = "touchx_food_campaign_created_id";

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const pendingCreate = ref(false);
const statusText = ref("准备就绪");
const myOpenCampaign = ref<FoodCampaignSummary | null>(null);
const createdCampaign = ref<FoodCampaignDetail | null>(null);
const showAdvanced = ref(false);

const templateOptions = [
  { value: "daily", label: "日常档（12 元系）" },
  { value: "party", label: "聚会档（25 元系）" },
] as const;

const joinModeOptions = [
  { value: "all", label: "公开参与" },
  { value: "invite", label: "邀请制" },
  { value: "password", label: "密码参与" },
] as const;

const tierOptionsMap: Record<TemplateKey, Array<{ id: string; label: string; danger?: boolean }>> = {
  daily: [
    { id: "daily_under_8", label: "极简档 (<8)", danger: true },
    { id: "daily_8_12", label: "经济档 (8-12)", danger: true },
    { id: "daily_12_15", label: "标准档 (12-15)" },
    { id: "daily_15_18", label: "优选档 (15-18)" },
    { id: "daily_18_plus", label: "尊享档 (18+)" },
  ],
  party: [
    { id: "party_25_35", label: "实惠聚餐 (25-35)" },
    { id: "party_35_45", label: "品质聚餐 (35-45)" },
    { id: "party_45_65", label: "精选聚餐 (45-65)" },
    { id: "party_65_plus", label: "豪华聚餐 (65+)" },
  ],
};

const fallbackCategoryOptions: FoodFilterOption[] = [
  { id: "breakfast", label: "早餐" },
  { id: "afternoon_tea", label: "下午茶" },
  { id: "drink", label: "饮品" },
  { id: "midnight_snack", label: "夜宵" },
  { id: "takeout", label: "外卖" },
  { id: "rice", label: "米饭" },
  { id: "noodle", label: "面食" },
  { id: "stir_fry", label: "炒菜" },
  { id: "maocai", label: "冒菜" },
  { id: "grill", label: "烧烤" },
  { id: "hotpot", label: "火锅" },
].map((item) => ({ ...item, count: 0 }));

const fallbackBrandOptions: FoodFilterOption[] = [
  { id: "mixue", label: "蜜雪冰城" },
  { id: "chabaidao", label: "茶百道" },
  { id: "bawangchaji", label: "霸王茶姬" },
  { id: "heytea", label: "喜茶" },
  { id: "guming", label: "古茗" },
  { id: "luckin", label: "瑞幸咖啡" },
  { id: "cotti", label: "库迪咖啡" },
  { id: "starbucks", label: "星巴克" },
].map((item) => ({ ...item, count: 0 }));

const categoryOptions = ref<FoodFilterOption[]>([...fallbackCategoryOptions]);
const brandOptions = ref<FoodFilterOption[]>([...fallbackBrandOptions]);

const createForm = ref({
  title: "",
  templateKey: "daily" as TemplateKey,
  joinMode: "all" as FoodCampaignJoinMode,
  joinPassword: "",
  isAnonymous: true,
  selectedTierIds: ["daily_under_8", "daily_8_12", "daily_12_15"] as string[],
  selectedCategoryKeys: [] as string[],
  selectedBrandKeys: [] as string[],
  maxVotesPerUser: "1",
  deadlineMinutes: "180",
  inviteeStudentIds: [] as string[],
});

const activeTierOptions = computed(() => {
  return tierOptionsMap[createForm.value.templateKey] || [];
});

const currentUserIdentity = computed(() => {
  return String(authSession.value.user?.studentId || authSession.value.user?.studentNo || "").trim();
});

const ensureAuthed = () => {
  if (!authSession.value.token || !authSession.value.user) {
    throw new Error("请先在账号页完成登录授权");
  }
};

const normalizeStudentIds = (values: unknown[]) => {
  const result: string[] = [];
  for (const value of values) {
    const studentId = String(value || "").trim();
    if (!studentId || result.includes(studentId)) {
      continue;
    }
    result.push(studentId);
  }
  return result;
};

const parseStudentIdsFromCsv = (value: string) => {
  return normalizeStudentIds(String(value || "").split(/[,，\s\n]+/));
};

const consumeInviteeSelection = () => {
  const raw = uni.getStorageSync(FOOD_CAMPAIGN_INVITEE_STORAGE_KEY);
  if (!raw) {
    return;
  }
  uni.removeStorageSync(FOOD_CAMPAIGN_INVITEE_STORAGE_KEY);
  if (Array.isArray(raw)) {
    createForm.value.inviteeStudentIds = normalizeStudentIds(raw);
    return;
  }
  if (typeof raw === "string") {
    createForm.value.inviteeStudentIds = parseStudentIdsFromCsv(raw);
    return;
  }
  if (raw && typeof raw === "object") {
    const payload = raw as InviteeStoragePayload;
    createForm.value.inviteeStudentIds = normalizeStudentIds(Array.isArray(payload.selectedStudentIds) ? payload.selectedStudentIds : []);
  }
};

const buildDeadlineAtIso = (minutesText: string) => {
  const minutes = Number(String(minutesText || "").trim());
  if (!Number.isFinite(minutes) || minutes < 6) {
    throw new Error("截止时间至少 6 分钟");
  }
  if (minutes > 360) {
    throw new Error("截止时间最长 360 分钟");
  }
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
};

const normalizeSelectedTierIds = (templateKey: TemplateKey, selectedIds: string[]) => {
  const allowSet = new Set((tierOptionsMap[templateKey] || []).map((item) => item.id));
  const values: string[] = [];
  for (const item of selectedIds) {
    const tierId = String(item || "").trim();
    if (!tierId || !allowSet.has(tierId) || values.includes(tierId)) {
      continue;
    }
    values.push(tierId);
  }
  return values;
};

const normalizeFilterKeys = (selectedIds: string[], allowIds: readonly string[]) => {
  const allowSet = new Set((allowIds || []).map((item) => String(item || "").trim()));
  const values: string[] = [];
  for (const item of selectedIds || []) {
    const key = String(item || "").trim();
    if (!key || !allowSet.has(key) || values.includes(key)) {
      continue;
    }
    values.push(key);
    if (values.length >= 8) {
      break;
    }
  }
  return values;
};

const normalizeCategoryOptions = (items: unknown) => {
  const values = Array.isArray(items) ? items : [];
  const result: FoodFilterOption[] = [];
  for (const raw of values) {
    const item = (raw || {}) as FoodCategoryOptionResponse;
    const id = String(item.categoryKey || "").trim();
    if (!id || result.some((entry) => entry.id === id)) {
      continue;
    }
    result.push({
      id,
      label: String(item.categoryName || "").trim() || id,
      count: Number(item.count || 0),
    });
  }
  return result.length > 0 ? result : [...fallbackCategoryOptions];
};

const normalizeBrandOptions = (items: unknown) => {
  const values = Array.isArray(items) ? items : [];
  const result: FoodFilterOption[] = [];
  for (const raw of values) {
    const item = (raw || {}) as FoodBrandOptionResponse;
    const id = String(item.brandKey || "").trim();
    if (!id || result.some((entry) => entry.id === id)) {
      continue;
    }
    result.push({
      id,
      label: String(item.brandName || "").trim() || id,
      count: Number(item.count || 0),
    });
  }
  return result.length > 0 ? result : [...fallbackBrandOptions];
};

const normalizeSelectedFilters = () => {
  createForm.value.selectedCategoryKeys = normalizeFilterKeys(
    createForm.value.selectedCategoryKeys,
    categoryOptions.value.map((item) => item.id),
  );
  createForm.value.selectedBrandKeys = normalizeFilterKeys(
    createForm.value.selectedBrandKeys,
    brandOptions.value.map((item) => item.id),
  );
};

const resolveBrandScopedCategoryKey = () => {
  const selectedCategoryKeys = normalizeFilterKeys(
    createForm.value.selectedCategoryKeys,
    categoryOptions.value.map((item) => item.id),
  );
  return selectedCategoryKeys.length === 1 ? selectedCategoryKeys[0] : "";
};

const loadFoodFilterOptions = async (silent = false) => {
  try {
    ensureAuthed();
    const response = await requestBackendGet<FoodFilterOptionsResponse>(
      backendBaseUrl.value,
      "/api/v1/social/foods",
      {
        templateKey: createForm.value.templateKey,
        headcount: "1",
        categoryKey: resolveBrandScopedCategoryKey(),
      },
      authSession.value.token,
    );
    categoryOptions.value = normalizeCategoryOptions(response.categories);
    brandOptions.value = normalizeBrandOptions(response.brands);
    normalizeSelectedFilters();
  } catch (error) {
    categoryOptions.value = [...fallbackCategoryOptions];
    brandOptions.value = [...fallbackBrandOptions];
    normalizeSelectedFilters();
    if (!silent) {
      const message = error instanceof Error ? error.message : "筛选项加载失败";
      uni.showToast({ title: message, icon: "none", duration: 1600 });
    }
  }
};

const changeTemplate = (templateKey: TemplateKey) => {
  if (createForm.value.templateKey === templateKey) {
    return;
  }
  createForm.value.templateKey = templateKey;
  createForm.value.selectedTierIds = (tierOptionsMap[templateKey] || []).slice(0, 3).map((item) => item.id);
  void loadFoodFilterOptions(true);
};

const changeJoinMode = (joinMode: FoodCampaignJoinMode) => {
  if (createForm.value.joinMode === joinMode) {
    return;
  }
  createForm.value.joinMode = joinMode;
  if (joinMode !== "password") {
    createForm.value.joinPassword = "";
  }
  if (joinMode === "invite" || joinMode === "password") {
    showAdvanced.value = true;
  }
};

const toggleTier = (tierId: string) => {
  const current = [...createForm.value.selectedTierIds];
  const index = current.indexOf(tierId);
  if (index >= 0) {
    if (current.length <= 3) {
      uni.showToast({ title: "至少选择 3 个价位档", icon: "none", duration: 1400 });
      return;
    }
    current.splice(index, 1);
    createForm.value.selectedTierIds = current;
    return;
  }
  if (current.length >= 4) {
    uni.showToast({ title: "最多选择 4 个价位档", icon: "none", duration: 1400 });
    return;
  }
  current.push(tierId);
  createForm.value.selectedTierIds = current;
};

const toggleCategory = (categoryKey: string) => {
  const current = [...createForm.value.selectedCategoryKeys];
  const index = current.indexOf(categoryKey);
  if (index >= 0) {
    current.splice(index, 1);
    createForm.value.selectedCategoryKeys = current;
    void loadFoodFilterOptions(true);
    return;
  }
  if (current.length >= 8) {
    uni.showToast({ title: "品类最多选择 8 个", icon: "none", duration: 1400 });
    return;
  }
  current.push(categoryKey);
  createForm.value.selectedCategoryKeys = current;
  void loadFoodFilterOptions(true);
};

const toggleBrand = (brandKey: string) => {
  const current = [...createForm.value.selectedBrandKeys];
  const index = current.indexOf(brandKey);
  if (index >= 0) {
    current.splice(index, 1);
    createForm.value.selectedBrandKeys = current;
    return;
  }
  if (current.length >= 8) {
    uni.showToast({ title: "品牌最多选择 8 个", icon: "none", duration: 1400 });
    return;
  }
  current.push(brandKey);
  createForm.value.selectedBrandKeys = current;
};

const openInviteePicker = () => {
  const selected = createForm.value.inviteeStudentIds.join(",");
  uni.navigateTo({
    url: `/pages/profile/food-campaign-invitees?selected=${encodeURIComponent(selected)}`,
  });
};

const clearInvitees = () => {
  createForm.value.inviteeStudentIds = [];
};

const buildCampaignSharePath = (shareToken: string) => {
  const token = String(shareToken || "").trim();
  if (!token) {
    return "";
  }
  return `/pages/profile/food-campaign-detail?shareToken=${encodeURIComponent(token)}`;
};

const buildCampaignDetailPath = (campaignId: string, shareToken: string) => {
  const targetId = String(campaignId || "").trim();
  const token = String(shareToken || "").trim();
  const params: string[] = [];
  if (targetId) {
    params.push(`campaignId=${encodeURIComponent(targetId)}`);
  }
  if (token) {
    params.push(`shareToken=${encodeURIComponent(token)}`);
  }
  if (params.length === 0) {
    return "";
  }
  return `/pages/profile/food-campaign-detail?${params.join("&")}`;
};

const copyShareToken = () => {
  const token = String(createdCampaign.value?.shareToken || "").trim();
  if (!token) {
    uni.showToast({ title: "暂无分享码", icon: "none", duration: 1400 });
    return;
  }
  uni.setClipboardData({
    data: token,
    success: () => {
      uni.showToast({ title: "已复制分享码", icon: "none", duration: 1200 });
    },
  });
};

const copyShareLink = () => {
  const path = buildCampaignSharePath(String(createdCampaign.value?.shareToken || ""));
  if (!path) {
    uni.showToast({ title: "暂无可复制链接", icon: "none", duration: 1400 });
    return;
  }
  uni.setClipboardData({
    data: path,
    success: () => {
      uni.showToast({ title: "已复制链接", icon: "none", duration: 1200 });
    },
  });
};

const openExistingCampaign = () => {
  const campaignId = String(myOpenCampaign.value?.campaignId || "").trim();
  if (!campaignId) {
    return;
  }
  const path = buildCampaignDetailPath(campaignId, String(myOpenCampaign.value?.shareToken || ""));
  if (!path) {
    return;
  }
  uni.navigateTo({ url: path });
};

const openCreatedCampaign = () => {
  const campaignId = String(createdCampaign.value?.campaignId || "").trim();
  if (!campaignId) {
    return;
  }
  const path = buildCampaignDetailPath(campaignId, String(createdCampaign.value?.shareToken || ""));
  if (!path) {
    return;
  }
  uni.redirectTo({ url: path });
};

const refreshMyOpenCampaign = async () => {
  ensureAuthed();
  const currentId = currentUserIdentity.value;
  if (!currentId) {
    myOpenCampaign.value = null;
    return;
  }
  const response = await requestBackendGet<CampaignListResponse>(
    backendBaseUrl.value,
    "/api/v1/social/food-campaigns",
    { status: "open" },
    authSession.value.token,
  );
  const items = Array.isArray(response.items) ? response.items : [];
  myOpenCampaign.value = items.find((item) => String(item.initiatorStudentId || "").trim() === currentId) || null;
};

const createCampaign = async () => {
  if (pendingCreate.value) {
    return;
  }
  pendingCreate.value = true;
  try {
    ensureAuthed();
    if (myOpenCampaign.value) {
      throw new Error("你已有进行中拼单，请先结束后再发起");
    }
    const templateKey = createForm.value.templateKey;
    const selectedTierIds = normalizeSelectedTierIds(templateKey, createForm.value.selectedTierIds);
    const selectedCategoryKeys = normalizeFilterKeys(
      createForm.value.selectedCategoryKeys,
      categoryOptions.value.map((item) => item.id),
    );
    const selectedBrandKeys = normalizeFilterKeys(
      createForm.value.selectedBrandKeys,
      brandOptions.value.map((item) => item.id),
    );
    if (selectedTierIds.length < 3 || selectedTierIds.length > 4) {
      throw new Error("价位档必须选择 3~4 个");
    }
    const maxVotes = Number(String(createForm.value.maxVotesPerUser || "").trim());
    if (!Number.isFinite(maxVotes) || maxVotes < 1 || maxVotes > 3) {
      throw new Error("每人可选数量必须在 1~3");
    }
    const joinMode = createForm.value.joinMode;
    const inviteeStudentIds = normalizeStudentIds(createForm.value.inviteeStudentIds || []);
    if (joinMode === "invite" && inviteeStudentIds.length === 0) {
      throw new Error("邀请制至少选择 1 位参与人");
    }
    if (joinMode === "password") {
      const password = String(createForm.value.joinPassword || "").trim();
      if (password.length < 4 || password.length > 32) {
        throw new Error("参与密码长度需在 4~32 位");
      }
    }
    const payload = {
      title: String(createForm.value.title || "").trim(),
      templateKey: templateKey,
      joinMode: joinMode,
      joinPassword: String(createForm.value.joinPassword || "").trim(),
      isAnonymous: Boolean(createForm.value.isAnonymous),
      selectedTierIds: selectedTierIds,
      categoryKeys: selectedCategoryKeys,
      brandKeys: selectedBrandKeys,
      maxVotesPerUser: Math.floor(maxVotes),
      deadlineAt: buildDeadlineAtIso(createForm.value.deadlineMinutes),
      inviteeStudentIds: inviteeStudentIds,
    };
    const response = await requestBackendPost<CampaignDetailResponse>(
      backendBaseUrl.value,
      "/api/v1/social/food-campaigns",
      payload,
      authSession.value.token,
    );
    createdCampaign.value = response.campaign || null;
    if (createdCampaign.value?.campaignId) {
      uni.setStorageSync(FOOD_CAMPAIGN_CREATED_ID_STORAGE_KEY, createdCampaign.value.campaignId);
    }
    await refreshMyOpenCampaign();
    uni.showToast({ title: "创建成功", icon: "none", duration: 1200 });
    openCreatedCampaign();
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建失败";
    statusText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pendingCreate.value = false;
  }
};

const formatTime = (timestamp: unknown) => {
  const ts = Number(timestamp || 0);
  if (!Number.isFinite(ts) || ts <= 0) {
    return "--";
  }
  const date = new Date(ts * 1000);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
};

const resolveCampaignTitle = (item: FoodCampaignSummary | FoodCampaignDetail | null | undefined) => {
  const explicitTitle = String(item?.title || "").trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const deadlineAt = Number(item?.deadlineAt || 0);
  if (Number.isFinite(deadlineAt) && deadlineAt > 0) {
    return `${formatTime(deadlineAt)} 发布的拼单`;
  }
  return "本次拼单";
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  consumeInviteeSelection();
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  if (!authSession.value.token || !authSession.value.user) {
    statusText.value = "请先登录授权";
    myOpenCampaign.value = null;
    return;
  }
  void loadFoodFilterOptions(true);
  void refreshMyOpenCampaign().catch((error) => {
    const message = error instanceof Error ? error.message : "加载失败";
    statusText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  });
});
</script>

<style scoped>
.page {
  padding: 20rpx;
  box-sizing: border-box;
}

/* Alert Card */
.alert-card {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
  border: 1rpx solid color-mix(in srgb, var(--accent) 20%, var(--line) 80%);
  margin-bottom: 16rpx;
}

.alert-icon {
  font-size: 32rpx;
  flex-shrink: 0;
}

.alert-body {
  flex: 1;
  min-width: 0;
}

.alert-title {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--text-main);
}

.alert-desc {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.alert-action {
  flex-shrink: 0;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  padding: 8rpx 18rpx;
  font-size: 24rpx;
  background: var(--card-bg);
  color: var(--accent);
}

/* Form Section */
.form-section {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  padding: 20rpx 18rpx;
  margin-bottom: 16rpx;
}

.form-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  margin-bottom: 12rpx;
}

.form-section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.form-section-toggle {
  font-size: 24rpx;
  color: var(--accent);
  font-weight: 500;
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

/* Form Fields */
.form-field {
  margin-bottom: 18rpx;
}

.form-field:last-child {
  margin-bottom: 0;
}

.form-field.half {
  flex: 1;
  min-width: 0;
}

.form-row {
  display: flex;
  gap: 14rpx;
  margin-bottom: 18rpx;
}

.form-label {
  font-size: 26rpx;
  color: var(--text-main);
  font-weight: 600;
  margin-bottom: 10rpx;
}

.form-label-opt {
  font-weight: 400;
  font-size: 22rpx;
  color: var(--text-sub);
  margin-left: 4rpx;
}

.form-label-req {
  font-weight: 500;
  font-size: 22rpx;
  color: var(--accent);
  margin-left: 4rpx;
}

.form-hint {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.form-input {
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 28rpx;
  padding: 16rpx;
}

/* Chips */
.form-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.form-chip {
  border: 1rpx solid var(--line);
  border-radius: 999rpx;
  padding: 10rpx 18rpx;
  font-size: 24rpx;
  color: var(--text-sub);
  background: var(--muted-bg);
  display: flex;
  align-items: center;
  gap: 6rpx;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.form-chip.active {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--line) 50%);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
  font-weight: 600;
}

.form-chip.warn {
  border-color: color-mix(in srgb, var(--danger, #d94848) 30%, var(--line) 70%);
  color: var(--danger, #d94848);
}

.form-chip.warn.active {
  border-color: color-mix(in srgb, var(--danger, #d94848) 60%, var(--line) 40%);
  color: var(--danger, #d94848);
  background: color-mix(in srgb, var(--danger, #d94848) 8%, var(--card-bg) 92%);
}

.chip-count {
  font-size: 20rpx;
  opacity: 0.6;
}

/* Invitee */
.invitee-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.invitee-btn {
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 12rpx 18rpx;
  font-size: 24rpx;
  background: var(--accent);
  color: #fff;
}

.invitee-btn.ghost {
  background: var(--muted-bg);
  color: var(--text-main);
}

.invitee-btn:disabled {
  opacity: 0.5;
}

/* Submit */
.submit-btn {
  width: 100%;
  border: none;
  border-radius: 16rpx;
  padding: 22rpx;
  font-size: 30rpx;
  font-weight: 700;
  background: var(--accent);
  color: #fff;
  margin-bottom: 16rpx;
}

.submit-btn:disabled {
  opacity: 0.5;
}

.submit-btn.pending {
  opacity: 0.7;
}

/* Success Card */
.success-card {
  background: var(--card-bg);
  border: 1rpx solid color-mix(in srgb, #22c55e 25%, var(--line) 75%);
  border-radius: 18rpx;
  padding: 24rpx 20rpx;
  margin-bottom: 16rpx;
}

.success-header {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 14rpx;
}

.success-icon {
  width: 44rpx;
  height: 44rpx;
  border-radius: 999rpx;
  background: color-mix(in srgb, #22c55e 14%, var(--muted-bg) 86%);
  color: #16a34a;
  font-size: 24rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.success-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.success-info {
  margin-bottom: 16rpx;
}

.success-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--text-main);
}

.success-meta {
  margin-top: 4rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.success-actions {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}

.success-btn {
  flex: 0 0 auto;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 12rpx 18rpx;
  font-size: 24rpx;
  background: var(--muted-bg);
  color: var(--text-main);
}

.success-btn.accent {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
</style>
