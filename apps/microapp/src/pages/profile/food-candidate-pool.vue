<template>
  <PageContainer title="食物候选池">
    <view class="page">
      <!-- 筛选 -->
      <view class="filter-card">
        <view class="filter-header">
          <view class="filter-title">候选食物</view>
          <view class="filter-actions">
            <button class="refresh-btn" @click="loadCandidates">↻</button>
            <button class="add-btn" @click="openSubmitSheet">+ 提报</button>
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
        <view class="list-status">{{ statusText }}</view>
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
        <view class="food-item-source">
          <text>{{ formatCandidateSourceLabel(item.submissionMode) }}</text>
          <text v-if="item.evidenceUrls?.length"> · 凭证 {{ item.evidenceUrls.length }} 张</text>
          <text v-if="item.isCaloriesEstimated"> · 热量为估算值</text>
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
        <view class="food-item-note food-item-nutrition">
          {{ formatCaloriesText(item) }} · {{ formatExerciseEquivalentText(item) }}
        </view>
        <view class="food-item-note" v-if="item.brandCombo">热销搭配：{{ item.brandCombo }}</view>
        <view class="food-item-note" v-if="item.rawTextPreview">原始文案：{{ item.rawTextPreview }}</view>
        <view class="food-item-note food-item-warning" v-if="item.extractionWarnings?.length">
          抽取提示：{{ item.extractionWarnings.join("；") }}
        </view>
        <view class="food-item-note food-item-review" v-if="item.reviewNote">审核备注：{{ item.reviewNote }}</view>
        <view class="food-item-note" v-if="item.note">{{ item.note }}</view>
        <view class="food-item-footer" v-if="item.createdByStudentId">
          <text class="footer-label">提交人 {{ item.createdByStudentId }}</text>
        </view>
      </view>

      <!-- 提报新店铺弹窗 -->
      <view class="sheet-mask" v-if="showSubmitSheet" @click.self="closeSubmitSheet">
        <view class="sheet-container" @click.stop>
          <view class="sheet-header">
            <view class="sheet-title">提报新店铺</view>
            <view class="sheet-close" @click="closeSubmitSheet">✕</view>
          </view>
          <scroll-view scroll-y class="sheet-scroll">
            <view class="sheet-body">
              <view class="sheet-desc">支持文案抽取、截图留证和结构化补录，提交后需管理员审核通过才会进入候选池。</view>

              <view class="sheet-mode-row">
                <view
                  class="sheet-mode-chip"
                  :class="{ active: submitMode === 'raw_text' }"
                  @click="changeSubmitMode('raw_text')"
                >
                  文案抽取
                </view>
                <view
                  class="sheet-mode-chip"
                  :class="{ active: submitMode === 'structured' }"
                  @click="changeSubmitMode('structured')"
                >
                  手动填写
                </view>
              </view>

              <view v-if="submitMode === 'raw_text'" class="sheet-field">
                <view class="sheet-label">原始文案<text class="sheet-req">*</text></view>
                <textarea
                  v-model.trim="rawTextInput"
                  class="sheet-textarea"
                  placeholder="粘贴群聊、外卖、点评文案，例如：蜜雪冰城 柠檬水 4元，人均10，热销冰淇淋"
                />
                <view class="sheet-inline-actions">
                  <button class="sheet-secondary-btn" :class="{ pending: pending.extract }" @click="extractCandidateFromRawText">
                    {{ pending.extract ? "识别中..." : "识别并填充" }}
                  </button>
                  <button
                    class="sheet-secondary-btn"
                    :class="{ pending: pending.uploadEvidence }"
                    @click="uploadEvidenceImages"
                  >
                    {{ pending.uploadEvidence ? "上传中..." : "上传截图" }}
                  </button>
                </view>
                <view class="sheet-sub-hint">截图仅作为审核凭证保存，本轮不会自动识别截图内容。</view>
              </view>

              <view v-else class="sheet-field">
                <view class="sheet-label">手动填写说明</view>
                <view class="sheet-sub-hint">手动模式下直接补结构化字段即可，如有截图也建议一起上传留证。</view>
                <view class="sheet-inline-actions">
                  <button
                    class="sheet-secondary-btn"
                    :class="{ pending: pending.uploadEvidence }"
                    @click="uploadEvidenceImages"
                  >
                    {{ pending.uploadEvidence ? "上传中..." : "上传截图" }}
                  </button>
                </view>
              </view>

              <view class="sheet-field" v-if="evidenceItems.length > 0">
                <view class="sheet-label">凭证截图</view>
                <view class="evidence-chip-list">
                  <view v-for="(item, index) in evidenceItems" :key="item.assetId" class="evidence-chip">
                    <view class="evidence-chip-main">
                      <view class="evidence-chip-title">截图 {{ index + 1 }}</view>
                      <view class="evidence-chip-sub">{{ item.assetId }}</view>
                    </view>
                    <view class="evidence-chip-actions">
                      <text class="evidence-chip-action" @click="previewEvidenceImage(item.url)">预览</text>
                      <text class="evidence-chip-action danger" @click="removeEvidenceItem(item.assetId)">删除</text>
                    </view>
                  </view>
                </view>
              </view>

              <view v-if="extractionWarnings.length > 0" class="sheet-warning-list">
                <view class="sheet-label">抽取提示</view>
                <view v-for="warning in extractionWarnings" :key="warning" class="sheet-warning-item">
                  {{ warning }}
                </view>
              </view>

              <view class="sheet-field">
                <view class="sheet-label">店铺名称<text class="sheet-req">*</text></view>
                <input v-model.trim="submitForm.name" class="sheet-input" type="text" placeholder="例如：刘文祥" />
              </view>

              <view class="sheet-row">
                <view class="sheet-field half">
                  <view class="sheet-label">分类键<text class="sheet-req">*</text></view>
                  <input
                    v-model.trim="submitForm.categoryKey"
                    class="sheet-input"
                    type="text"
                    placeholder="例如：maocai、hotpot、noodle"
                  />
                </view>
                <view class="sheet-field half">
                  <view class="sheet-label">分类名</view>
                  <input v-model.trim="submitForm.categoryName" class="sheet-input" type="text" placeholder="例如：冒菜、火锅" />
                </view>
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
                <view class="sheet-label">热量（kcal）</view>
                <input v-model.trim="submitForm.caloriesKcal" class="sheet-input" type="number" placeholder="例如：520" />
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
  uploadBackendFile,
  type AuthSessionState,
} from "@/utils/profile-service";

type CandidateStatus = "all" | "approved" | "pending_eat" | "pending_review";
type SubmissionMode = "raw_text" | "structured";

interface ExerciseEquivalentMinutes {
  running: number;
  uphill: number;
}

interface FoodCandidateEvidenceItem {
  assetId: string;
  url: string;
}

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
  caloriesKcal: number;
  exerciseEquivalentMinutes?: ExerciseEquivalentMinutes;
  submissionMode?: SubmissionMode;
  rawTextPreview?: string;
  evidenceAssetIds?: string[];
  evidenceUrls?: string[];
  extractionWarnings?: string[];
  reviewNote?: string;
  isCaloriesEstimated?: boolean;
}

interface FoodCandidateListResponse {
  ok?: boolean;
  items?: FoodCandidateItem[];
}

interface FoodCandidateSubmitResponse {
  ok?: boolean;
  item?: FoodCandidateItem;
}

interface FoodCandidateExtractPayload {
  name?: string;
  categoryKey?: string;
  categoryName?: string;
  brandKey?: string;
  brandName?: string;
  brandCombo?: string;
  dailyPriceMin?: number;
  dailyPriceMax?: number;
  partyPriceMin?: number;
  partyPriceMax?: number;
  caloriesKcal?: number;
}

interface FoodCandidateExtractResponse {
  ok?: boolean;
  extracted?: FoodCandidateExtractPayload;
  warnings?: string[];
  rawTextPreview?: string;
}

interface FoodCandidateEvidenceUploadResponse {
  ok?: boolean;
  asset?: FoodCandidateEvidenceItem;
}

const MAX_EVIDENCE_IMAGES = 3;

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const statusText = ref("准备就绪");
const candidates = ref<FoodCandidateItem[]>([]);
const showSubmitSheet = ref(false);
const submitMode = ref<SubmissionMode>("raw_text");
const rawTextInput = ref("");
const extractionWarnings = ref<string[]>([]);
const evidenceItems = ref<FoodCandidateEvidenceItem[]>([]);

const pending = ref({
  load: false,
  submit: false,
  extract: false,
  uploadEvidence: false,
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
  categoryName: "",
  brandKey: "",
  brandName: "",
  brandCombo: "",
  dailyMin: "",
  dailyMax: "",
  partyMin: "",
  partyMax: "",
  distanceKm: "",
  caloriesKcal: "",
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

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || "").trim()).filter((item) => item);
};

const normalizeEvidenceItems = (items: FoodCandidateEvidenceItem[]) => {
  const result: FoodCandidateEvidenceItem[] = [];
  for (const item of items) {
    const assetId = String(item.assetId || "").trim();
    const url = String(item.url || "").trim();
    if (!assetId || !url || result.some((entry) => entry.assetId === assetId)) {
      continue;
    }
    result.push({ assetId, url });
  }
  return result;
};

const calculateExerciseEquivalent = (caloriesKcal: unknown): ExerciseEquivalentMinutes => {
  const kcal = Math.max(0, Number(caloriesKcal) || 0);
  if (kcal <= 0) {
    return {
      running: 0,
      uphill: 0,
    };
  }
  return {
    running: Math.max(1, Math.round(kcal / 10)),
    uphill: Math.max(1, Math.round(kcal / 8)),
  };
};

const normalizeExerciseEquivalent = (value: unknown, caloriesKcal: number): ExerciseEquivalentMinutes => {
  if (!value || typeof value !== "object") {
    return calculateExerciseEquivalent(caloriesKcal);
  }
  const data = value as Partial<ExerciseEquivalentMinutes>;
  const running = Number(data.running || 0);
  const uphill = Number(data.uphill || 0);
  if (running <= 0 || uphill <= 0) {
    return calculateExerciseEquivalent(caloriesKcal);
  }
  return {
    running: Math.round(running),
    uphill: Math.round(uphill),
  };
};

const formatExerciseEquivalentText = (item: FoodCandidateItem) => {
  const eq = normalizeExerciseEquivalent(item.exerciseEquivalentMinutes, item.caloriesKcal);
  return `跑步 ${eq.running} 分钟 / 爬坡 ${eq.uphill} 分钟`;
};

const formatCandidateSourceLabel = (mode: unknown) => {
  return String(mode || "").trim().toLowerCase() === "raw_text" ? "文案抽取" : "手动填写";
};

const formatCaloriesText = (item: FoodCandidateItem) => {
  const prefix = item.isCaloriesEstimated ? "估算热量" : "热量约";
  return `${prefix} ${formatNumber(item.caloriesKcal)} kcal`;
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
      caloriesKcal: Number(item.caloriesKcal || 0),
      exerciseEquivalentMinutes: normalizeExerciseEquivalent(item.exerciseEquivalentMinutes, Number(item.caloriesKcal || 0)),
      submissionMode: String(item.submissionMode || "").trim().toLowerCase() === "raw_text" ? "raw_text" : "structured",
      rawTextPreview: String(item.rawTextPreview || "").trim(),
      evidenceAssetIds: normalizeStringArray(item.evidenceAssetIds),
      evidenceUrls: normalizeStringArray(item.evidenceUrls),
      extractionWarnings: normalizeStringArray(item.extractionWarnings),
      reviewNote: String(item.reviewNote || "").trim(),
      isCaloriesEstimated: Boolean(item.isCaloriesEstimated),
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
      "/api/v1/social/food-candidates",
      {
        status: filters.value.status,
        categoryKey: String(filters.value.categoryKey || "").trim(),
        brandKey: String(filters.value.brandKey || "").trim(),
        keyword: String(filters.value.keyword || "").trim(),
        mineOnly: filters.value.mineOnly ? "1" : "0",
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

const readOptionalNumberValue = (raw: string, label: string) => {
  const normalized = String(raw || "").trim();
  if (!normalized) {
    return undefined;
  }
  return readPriceValue(normalized, label);
};

const fillSubmitFormFromExtracted = (payload: FoodCandidateExtractPayload | null | undefined) => {
  if (!payload) {
    return;
  }
  submitForm.value = {
    ...submitForm.value,
    name: String(payload.name || "").trim(),
    categoryKey: String(payload.categoryKey || "").trim(),
    categoryName: String(payload.categoryName || "").trim(),
    brandKey: String(payload.brandKey || "").trim(),
    brandName: String(payload.brandName || "").trim(),
    brandCombo: String(payload.brandCombo || "").trim(),
    dailyMin: payload.dailyPriceMin !== undefined ? String(payload.dailyPriceMin) : submitForm.value.dailyMin,
    dailyMax: payload.dailyPriceMax !== undefined ? String(payload.dailyPriceMax) : submitForm.value.dailyMax,
    partyMin: payload.partyPriceMin !== undefined ? String(payload.partyPriceMin) : submitForm.value.partyMin,
    partyMax: payload.partyPriceMax !== undefined ? String(payload.partyPriceMax) : submitForm.value.partyMax,
    distanceKm: submitForm.value.distanceKm,
    caloriesKcal: payload.caloriesKcal !== undefined ? String(payload.caloriesKcal) : submitForm.value.caloriesKcal,
    note: submitForm.value.note,
  };
};

const resetSubmitState = () => {
  submitForm.value = {
    name: "",
    categoryKey: "",
    categoryName: "",
    brandKey: "",
    brandName: "",
    brandCombo: "",
    dailyMin: "",
    dailyMax: "",
    partyMin: "",
    partyMax: "",
    distanceKm: "",
    caloriesKcal: "",
    note: "",
  };
  submitMode.value = "raw_text";
  rawTextInput.value = "";
  extractionWarnings.value = [];
  evidenceItems.value = [];
};

const openSubmitSheet = () => {
  resetSubmitState();
  showSubmitSheet.value = true;
};

const closeSubmitSheet = () => {
  showSubmitSheet.value = false;
};

const changeSubmitMode = (mode: SubmissionMode) => {
  submitMode.value = mode;
};

const pickEvidenceFiles = () => {
  return new Promise<string[]>((resolve, reject) => {
    const remain = Math.max(0, MAX_EVIDENCE_IMAGES - evidenceItems.value.length);
    if (remain <= 0) {
      reject(new Error(`最多上传 ${MAX_EVIDENCE_IMAGES} 张截图`));
      return;
    }
    uni.chooseImage({
      count: remain,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const filePaths = Array.isArray(result.tempFilePaths)
          ? result.tempFilePaths.map((item) => String(item || "").trim()).filter((item) => item)
          : [];
        if (filePaths.length <= 0) {
          reject(new Error("未选择图片"));
          return;
        }
        resolve(filePaths);
      },
      fail: (error) => {
        reject(new Error(error?.errMsg || "选择图片失败"));
      },
    });
  });
};

const uploadEvidenceImages = async () => {
  if (pending.value.uploadEvidence) {
    return;
  }
  pending.value.uploadEvidence = true;
  try {
    ensureAuthed();
    const files = await pickEvidenceFiles();
    const uploaded = await Promise.all(
      files.map(async (filePath) => {
        const response = await uploadBackendFile<FoodCandidateEvidenceUploadResponse>(
          backendBaseUrl.value,
          "/api/v1/social/food-candidates/evidence",
          {
            filePath,
            token: authSession.value.token,
          },
        );
        const asset = response.asset || null;
        if (!asset?.assetId || !asset.url) {
          throw new Error("截图上传返回无效");
        }
        return asset;
      }),
    );
    evidenceItems.value = normalizeEvidenceItems([...evidenceItems.value, ...uploaded]);
    uni.showToast({ title: `已上传 ${uploaded.length} 张凭证`, icon: "none", duration: 1400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "截图上传失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.uploadEvidence = false;
  }
};

const removeEvidenceItem = (assetId: string) => {
  evidenceItems.value = evidenceItems.value.filter((item) => item.assetId !== assetId);
};

const previewEvidenceImage = (currentUrl: string) => {
  const urls = evidenceItems.value.map((item) => item.url).filter((item) => item);
  const current = String(currentUrl || "").trim();
  if (!current || urls.length <= 0) {
    return;
  }
  uni.previewImage({
    current,
    urls,
  });
};

const extractCandidateFromRawText = async () => {
  if (pending.value.extract) {
    return;
  }
  pending.value.extract = true;
  try {
    ensureAuthed();
    const rawText = String(rawTextInput.value || "").trim();
    if (!rawText) {
      throw new Error("请先填写原始文案");
    }
    const response = await requestBackendPost<FoodCandidateExtractResponse>(
      backendBaseUrl.value,
      "/api/v1/social/food-candidates/extract",
      {
        rawText,
        brandHint: String(submitForm.value.brandName || "").trim(),
        categoryHint: String(submitForm.value.categoryKey || "").trim(),
      },
      authSession.value.token,
    );
    fillSubmitFormFromExtracted(response.extracted);
    extractionWarnings.value = normalizeStringArray(response.warnings);
    statusText.value = response.rawTextPreview ? `已识别：${response.rawTextPreview}` : "已识别并填充";
    uni.showToast({ title: "已识别并填充", icon: "none", duration: 1400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "识别失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.extract = false;
  }
};

const submitCandidate = async () => {
  if (pending.value.submit) {
    return;
  }
  pending.value.submit = true;
  try {
    ensureAuthed();
    const rawText = String(rawTextInput.value || "").trim();
    if (submitMode.value === "raw_text" && !rawText) {
      throw new Error("文案抽取模式需要先填写原始文案");
    }
    const name = String(submitForm.value.name || "").trim();
    const categoryKey = String(submitForm.value.categoryKey || "").trim().toLowerCase();
    if (!name) {
      throw new Error("请填写店铺名称");
    }
    if (!categoryKey) {
      throw new Error("请填写分类");
    }
    const dailyMin = readOptionalNumberValue(submitForm.value.dailyMin, "日常最低价");
    const dailyMax = readOptionalNumberValue(submitForm.value.dailyMax, "日常最高价");
    const partyMin = readOptionalNumberValue(submitForm.value.partyMin, "聚会最低价");
    const partyMax = readOptionalNumberValue(submitForm.value.partyMax, "聚会最高价");
    const distanceKm = readOptionalNumberValue(submitForm.value.distanceKm, "距离");
    const caloriesKcal = readOptionalNumberValue(submitForm.value.caloriesKcal, "热量");
    if (dailyMin !== undefined && dailyMax !== undefined && dailyMax < dailyMin) {
      throw new Error("日常最高价不能低于最低价");
    }
    if (partyMin !== undefined && partyMax !== undefined && partyMax < partyMin) {
      throw new Error("聚会最高价不能低于最低价");
    }
    const payload = {
      name,
      categoryKey,
      categoryName: String(submitForm.value.categoryName || "").trim(),
      brandKey: String(submitForm.value.brandKey || "").trim(),
      brandName: String(submitForm.value.brandName || "").trim(),
      brandCombo: String(submitForm.value.brandCombo || "").trim(),
      dailyPriceMin: dailyMin,
      dailyPriceMax: dailyMax,
      partyPriceMin: partyMin,
      partyPriceMax: partyMax,
      distanceKm,
      caloriesKcal,
      note: String(submitForm.value.note || "").trim(),
      submissionMode: submitMode.value,
      rawText: submitMode.value === "raw_text" ? rawText : undefined,
      evidenceAssetIds: evidenceItems.value.map((item) => item.assetId),
      extractionWarnings: [...extractionWarnings.value],
    };
    await requestBackendPost<FoodCandidateSubmitResponse>(
      backendBaseUrl.value,
      "/api/v1/social/food-candidates",
      payload,
      authSession.value.token,
    );
    resetSubmitState();
    closeSubmitSheet();
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

.list-status {
  font-size: 22rpx;
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

.food-item-source {
  margin-top: 8rpx;
  font-size: 21rpx;
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

.food-item-nutrition {
  color: var(--text-sub);
}

.food-item-warning {
  color: #b45309;
}

.food-item-review {
  color: var(--accent);
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

.sheet-mode-row {
  display: flex;
  gap: 12rpx;
  margin-bottom: 18rpx;
}

.sheet-mode-chip {
  flex: 1;
  text-align: center;
  border: 1rpx solid var(--line);
  border-radius: 999rpx;
  padding: 12rpx 16rpx;
  font-size: 24rpx;
  color: var(--text-sub);
  background: var(--muted-bg);
  font-weight: 600;
}

.sheet-mode-chip.active {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line) 55%);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
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

.sheet-inline-actions {
  display: flex;
  gap: 12rpx;
  margin-top: 12rpx;
  margin-bottom: 8rpx;
}

.sheet-secondary-btn {
  flex: 1;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 16rpx;
  font-size: 24rpx;
  font-weight: 600;
  background: var(--muted-bg);
  color: var(--text-main);
}

.sheet-secondary-btn.pending {
  opacity: 0.72;
}

.sheet-sub-hint {
  font-size: 22rpx;
  color: var(--text-sub);
  line-height: 1.5;
}

.evidence-chip-list {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.evidence-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 14rpx 16rpx;
  background: var(--muted-bg);
}

.evidence-chip-main {
  min-width: 0;
  flex: 1;
}

.evidence-chip-title {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--text-main);
}

.evidence-chip-sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--text-sub);
  word-break: break-all;
}

.evidence-chip-actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex-shrink: 0;
}

.evidence-chip-action {
  font-size: 22rpx;
  color: var(--accent);
}

.evidence-chip-action.danger {
  color: var(--danger, #d94848);
}

.sheet-warning-list {
  margin-bottom: 16rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  background: color-mix(in srgb, #f59e0b 10%, var(--card-bg) 90%);
  border: 1rpx solid color-mix(in srgb, #f59e0b 24%, var(--line) 76%);
}

.sheet-warning-item {
  font-size: 22rpx;
  color: #b45309;
  line-height: 1.5;
}

.sheet-warning-item + .sheet-warning-item {
  margin-top: 6rpx;
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
