<template>
  <el-card>
    <template #header>
      <div class="title">食物管理</div>
    </template>
    <el-alert type="info" :closable="false" show-icon title="支持价格曲线预览、历史回放与回滚。" />

    <el-form inline class="tools">
      <el-form-item label="模板">
        <el-select v-model="previewForm.templateKey" style="width: 140px">
          <el-option label="daily" value="daily" />
          <el-option label="party" value="party" />
        </el-select>
      </el-form-item>
      <el-form-item label="分类">
        <el-select v-model="previewForm.categoryKey" filterable style="width: 200px" placeholder="请选择分类">
          <el-option v-for="item in ruleOptions" :key="item.category_key" :label="item.category_name" :value="item.category_key" />
        </el-select>
      </el-form-item>
      <el-form-item label="基础最低价">
        <el-input-number v-model="previewForm.basePriceMin" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="基础最高价">
        <el-input-number v-model="previewForm.basePriceMax" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="人数区间">
        <el-input-number v-model="previewForm.headcountStart" :min="1" :max="200" />
        <span style="margin: 0 6px">~</span>
        <el-input-number v-model="previewForm.headcountEnd" :min="1" :max="200" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="loadCurvePreview" :loading="previewLoading">预览曲线</el-button>
        <el-button @click="loadHistory" :loading="historyLoading">刷新历史</el-button>
      </el-form-item>
    </el-form>

    <el-descriptions border :column="3" v-if="previewData">
      <el-descriptions-item label="分类">{{ previewData.categoryName }}</el-descriptions-item>
      <el-descriptions-item label="规则模式">{{ previewData.rule.trend_mode || previewData.rule.trendMode }}</el-descriptions-item>
      <el-descriptions-item label="锚点人数">{{ previewData.rule.anchor_headcount || previewData.rule.anchorHeadcount }}</el-descriptions-item>
      <el-descriptions-item label="基础价">{{ previewData.basePriceMin }} ~ {{ previewData.basePriceMax }}</el-descriptions-item>
      <el-descriptions-item label="人数范围">{{ previewData.headcountStart }} ~ {{ previewData.headcountEnd }}</el-descriptions-item>
      <el-descriptions-item label="点位数量">{{ previewData.points.length }}</el-descriptions-item>
    </el-descriptions>

    <div ref="chartRef" class="chart" />

    <div class="sub-title">分类规则历史</div>
    <div class="tools">
      <el-input v-model="historyFilter.categoryKey" placeholder="按分类过滤（可选）" style="width: 220px" />
      <el-button @click="loadHistory" :loading="historyLoading">查询</el-button>
    </div>
    <el-table :data="history" stripe>
      <el-table-column prop="categoryKey" label="分类" min-width="160" />
      <el-table-column prop="versionId" label="版本ID" min-width="220" />
      <el-table-column prop="trendMode" label="模式" min-width="100" />
      <el-table-column prop="anchorHeadcount" label="锚点人数" min-width="120" />
      <el-table-column prop="slope" label="斜率" min-width="100" />
      <el-table-column prop="minFactor" label="最小系数" min-width="100" />
      <el-table-column prop="maxFactor" label="最大系数" min-width="100" />
      <el-table-column prop="createdAt" label="时间戳" min-width="180" />
      <el-table-column label="操作" min-width="120" fixed="right">
        <template #default="{ row }">
          <el-button type="warning" size="small" plain @click="rollbackHistory(row)">回滚</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import * as echarts from "echarts";
import { ElMessage, ElMessageBox } from "element-plus";
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { apiGet, apiPost } from "../api";

interface RuleHistoryRow {
  categoryKey: string;
  categoryName: string;
  versionId: string;
  trendMode: string;
  anchorHeadcount: number;
  slope: number;
  minFactor: number;
  maxFactor: number;
  createdAt: number;
  updatedAt?: number;
}

interface RuleOption {
  category_key: string;
  category_name: string;
}

interface CurvePoint {
  headcount: number;
  dynamicPriceMin: number;
  dynamicPriceMax: number;
  dynamicPriceMid: number;
  factor: number;
}

interface PreviewData {
  categoryName: string;
  basePriceMin: number;
  basePriceMax: number;
  headcountStart: number;
  headcountEnd: number;
  points: CurvePoint[];
  rule: Record<string, unknown>;
}

const history = ref<RuleHistoryRow[]>([]);
const ruleOptions = ref<RuleOption[]>([]);
const historyLoading = ref(false);
const previewLoading = ref(false);
const previewData = ref<PreviewData | null>(null);
const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

const historyFilter = ref({
  categoryKey: "",
});

const previewForm = ref({
  templateKey: "daily",
  categoryKey: "",
  basePriceMin: 10,
  basePriceMax: 20,
  headcountStart: 1,
  headcountEnd: 30,
  headcountStep: 1,
});

const ensureChart = async () => {
  await nextTick();
  if (!chartRef.value) {
    return null;
  }
  if (!chart) {
    chart = echarts.init(chartRef.value);
  }
  return chart;
};

const renderChart = async () => {
  const instance = await ensureChart();
  if (!instance) {
    return;
  }
  const points = previewData.value?.points || [];
  instance.setOption({
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: ["最低价", "最高价", "中位价"] },
    grid: { left: 44, right: 16, top: 36, bottom: 30 },
    xAxis: {
      type: "category",
      data: points.map((item) => item.headcount),
      name: "人数",
    },
    yAxis: {
      type: "value",
      name: "人均价格",
    },
    series: [
      {
        name: "最低价",
        type: "line",
        smooth: true,
        data: points.map((item) => item.dynamicPriceMin),
      },
      {
        name: "最高价",
        type: "line",
        smooth: true,
        data: points.map((item) => item.dynamicPriceMax),
      },
      {
        name: "中位价",
        type: "line",
        smooth: true,
        data: points.map((item) => item.dynamicPriceMid),
      },
    ],
  });
};

const loadHistory = async () => {
  historyLoading.value = true;
  try {
    const query = historyFilter.value.categoryKey.trim();
    const path = query
      ? `/api/admin/food-pricing-rules/history?category_key=${encodeURIComponent(query)}`
      : "/api/admin/food-pricing-rules/history";
    const data = await apiGet<{ items: RuleHistoryRow[] }>(path);
    history.value = data.items || [];
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载失败");
  } finally {
    historyLoading.value = false;
  }
};

const loadRuleOptions = async () => {
  try {
    const data = await apiGet<{ items: RuleOption[] }>("/api/admin/food-pricing-rules");
    ruleOptions.value = data.items || [];
    if (!previewForm.value.categoryKey && ruleOptions.value.length > 0) {
      previewForm.value.categoryKey = ruleOptions.value[0].category_key;
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载分类规则失败");
  }
};

const loadCurvePreview = async () => {
  if (!previewForm.value.categoryKey.trim()) {
    ElMessage.warning("请先选择分类");
    return;
  }
  previewLoading.value = true;
  try {
    const data = await apiPost<{ preview: PreviewData }>("/api/admin/food-pricing-rules/preview", {
      template_key: previewForm.value.templateKey,
      category_key: previewForm.value.categoryKey,
      base_price_min: previewForm.value.basePriceMin,
      base_price_max: previewForm.value.basePriceMax,
      headcount_start: previewForm.value.headcountStart,
      headcount_end: previewForm.value.headcountEnd,
      headcount_step: previewForm.value.headcountStep,
    });
    previewData.value = data.preview || null;
    await renderChart();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "预览失败");
  } finally {
    previewLoading.value = false;
  }
};

const rollbackHistory = async (row: RuleHistoryRow) => {
  try {
    await ElMessageBox.confirm(
      `确定回滚到版本 ${row.versionId} 吗？`,
      "确认回滚",
      { type: "warning", confirmButtonText: "确认", cancelButtonText: "取消" },
    );
    await apiPost("/api/admin/food-pricing-rules/rollback", { version_id: row.versionId });
    ElMessage.success("回滚成功");
    await loadRuleOptions();
    await loadHistory();
    await loadCurvePreview();
  } catch (error) {
    if (error === "cancel") {
      return;
    }
    ElMessage.error(error instanceof Error ? error.message : "回滚失败");
  }
};

onMounted(async () => {
  await loadRuleOptions();
  await loadHistory();
  await loadCurvePreview();
  window.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  if (chart) {
    chart.dispose();
    chart = null;
  }
});

const handleResize = () => {
  chart?.resize();
};
</script>

<style scoped>
.title {
  font-weight: 700;
}

.tools {
  margin: 12px 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.chart {
  width: 100%;
  height: 320px;
  margin: 12px 0 18px;
}

.sub-title {
  font-weight: 600;
  margin-top: 8px;
}
</style>
