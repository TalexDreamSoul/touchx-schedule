<template>
  <el-card>
    <template #header>
      <div class="title">媒体资产</div>
    </template>
    <div class="tools">
      <el-button @click="loadAssets">刷新</el-button>
      <el-button type="warning" @click="reconcile">重建引用索引</el-button>
      <el-button type="danger" plain @click="cleanupDryRun">孤儿清理预演</el-button>
      <el-button type="danger" @click="cleanupExecute">执行孤儿清理</el-button>
    </div>
    <el-table :data="rows" stripe>
      <el-table-column prop="fileName" label="文件名" min-width="220" />
      <el-table-column prop="usage" label="用途" min-width="120" />
      <el-table-column prop="ownerStudentId" label="所有者" min-width="140" />
      <el-table-column prop="sizeBytes" label="大小(bytes)" min-width="120" />
      <el-table-column prop="referenced" label="被引用" min-width="100">
        <template #default="{ row }">
          {{ row.referenced ? "是" : "否" }}
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" min-width="180" />
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { onMounted, ref } from "vue";
import { apiGet, apiPost } from "../api";

interface MediaRow {
  fileName: string;
  usage: string;
  ownerStudentId: string;
  sizeBytes: number;
  referenced: boolean;
  createdAt: number;
}

const rows = ref<MediaRow[]>([]);

const loadAssets = async () => {
  try {
    const data = await apiGet<{ items: MediaRow[] }>("/api/admin/media-assets");
    rows.value = data.items || [];
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载媒体失败");
  }
};

const reconcile = async () => {
  try {
    await apiPost("/api/admin/media-assets/reconcile", {});
    ElMessage.success("已重建引用索引");
    await loadAssets();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "操作失败");
  }
};

const cleanupDryRun = async () => {
  try {
    const data = await apiPost<{ candidateCount: number; removedCount: number }>(
      "/api/admin/media-assets/cleanup",
      { dry_run: true },
    );
    ElMessage.success(`预演完成：候选 ${data.candidateCount || 0}，将删除 ${data.removedCount || 0}`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "清理预演失败");
  }
};

const cleanupExecute = async () => {
  try {
    await ElMessageBox.confirm(
      "将删除“未被引用且超过阈值时间”的媒体文件，是否继续？",
      "确认清理",
      { type: "warning", confirmButtonText: "继续", cancelButtonText: "取消" },
    );
    const data = await apiPost<{ removedCount: number; candidateCount: number }>(
      "/api/admin/media-assets/cleanup",
      { dry_run: false, max_age_hours: 24 * 7 },
    );
    ElMessage.success(`清理完成：删除 ${data.removedCount || 0} / ${data.candidateCount || 0}`);
    await loadAssets();
  } catch (error) {
    if (error === "cancel") {
      return;
    }
    ElMessage.error(error instanceof Error ? error.message : "清理执行失败");
  }
};

onMounted(() => {
  void loadAssets();
});
</script>

<style scoped>
.title {
  font-weight: 700;
}

.tools {
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
}
</style>
