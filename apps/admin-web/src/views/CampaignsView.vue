<template>
  <el-card>
    <template #header>
      <div class="title">竞选管理</div>
    </template>
    <el-alert type="warning" :closable="false" show-icon title="默认匿名模式：进行中仅自己可见，结束后持分享码可见实名。" />
    <el-table :data="rows" style="margin-top: 12px" stripe>
      <el-table-column prop="campaignId" label="竞选ID" min-width="180" />
      <el-table-column prop="title" label="标题" min-width="180" />
      <el-table-column prop="status" label="状态" min-width="100" />
      <el-table-column prop="isAnonymous" label="匿名模式" min-width="120">
        <template #default="{ row }">
          {{ row.isAnonymous ? "匿名" : "实名" }}
        </template>
      </el-table-column>
      <el-table-column prop="deadlineAtIso" label="截止时间" min-width="180" />
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, ref } from "vue";
import { apiGet } from "../api";

interface CampaignRow {
  campaignId: string;
  title: string;
  status: string;
  isAnonymous: boolean;
  deadlineAtIso: string;
}

const rows = ref<CampaignRow[]>([]);

onMounted(async () => {
  try {
    const data = await apiGet<{ items: CampaignRow[] }>("/api/admin/food-campaigns");
    rows.value = data.items || [];
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载竞选失败");
  }
});
</script>

<style scoped>
.title {
  font-weight: 700;
}
</style>
