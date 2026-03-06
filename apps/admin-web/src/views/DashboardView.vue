<template>
  <el-card>
    <template #header>
      <div class="title">系统总览</div>
    </template>
    <el-descriptions :column="2" border v-if="health">
      <el-descriptions-item label="状态">{{ health.status }}</el-descriptions-item>
      <el-descriptions-item label="推送模式">{{ health.push_mode }}</el-descriptions-item>
      <el-descriptions-item label="数据库">{{ health.db }}</el-descriptions-item>
      <el-descriptions-item label="时区">{{ health.timezone }}</el-descriptions-item>
      <el-descriptions-item label="提醒 Worker">{{ health.worker_enabled ? "开启" : "关闭" }}</el-descriptions-item>
      <el-descriptions-item label="小程序登录">{{ health.mp_wechat_login_configured ? "已配置" : "未配置" }}</el-descriptions-item>
    </el-descriptions>
    <el-empty v-else description="暂无数据" />
  </el-card>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, ref } from "vue";
import { apiGet } from "../api";

interface HealthPayload {
  status: string;
  push_mode: string;
  db: string;
  timezone: string;
  worker_enabled: boolean;
  mp_wechat_login_configured: boolean;
}

const health = ref<HealthPayload | null>(null);

onMounted(async () => {
  try {
    health.value = await apiGet<HealthPayload>("/health");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载失败");
  }
});
</script>

<style scoped>
.title {
  font-weight: 700;
}
</style>
