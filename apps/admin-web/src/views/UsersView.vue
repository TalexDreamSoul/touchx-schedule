<template>
  <el-card>
    <template #header>
      <div class="title">用户管理</div>
    </template>
    <el-alert type="info" :closable="false" show-icon title="支持学号为主身份，兼容 studentId 字段。" />
    <el-table :data="rows" style="margin-top: 12px" stripe>
      <el-table-column prop="studentNo" label="学号" min-width="140" />
      <el-table-column prop="studentId" label="studentId(兼容)" min-width="160" />
      <el-table-column prop="name" label="姓名" min-width="120" />
      <el-table-column prop="classLabel" label="班级" min-width="200" />
      <el-table-column prop="adminRole" label="角色" min-width="120" />
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, ref } from "vue";
import { apiGet } from "../api";

interface UserRow {
  studentId: string;
  studentNo: string;
  name: string;
  classLabel: string;
  adminRole?: string;
}

const rows = ref<UserRow[]>([]);

onMounted(async () => {
  try {
    const data = await apiGet<{ items: UserRow[] }>("/api/admin/users");
    rows.value = data.items || [];
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载用户失败");
  }
});
</script>

<style scoped>
.title {
  font-weight: 700;
}
</style>
