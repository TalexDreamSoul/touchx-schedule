<template>
  <el-container style="height: 100vh">
    <el-aside width="220px" class="sidebar">
      <div class="brand">TouchX Admin</div>
      <el-menu router :default-active="$route.path">
        <el-menu-item index="/dashboard">总览</el-menu-item>
        <el-menu-item index="/users">用户</el-menu-item>
        <el-menu-item index="/classes">班级订阅</el-menu-item>
        <el-menu-item index="/courses">课表</el-menu-item>
        <el-menu-item index="/foods">食物</el-menu-item>
        <el-menu-item index="/campaigns">竞选</el-menu-item>
        <el-menu-item index="/media">媒体资产</el-menu-item>
        <el-menu-item index="/settings">系统设置</el-menu-item>
        <el-menu-item index="/preview">预览中心</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div>后台管理系统（Vue 版）</div>
        <el-button type="danger" plain size="small" @click="handleLogout">退出</el-button>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const authStore = useAuthStore();

const handleLogout = async () => {
  try {
    await authStore.logout();
    ElMessage.success("已退出登录");
  } catch {
    authStore.markLoggedOut();
  } finally {
    await router.replace("/login");
  }
};
</script>

<style scoped>
.sidebar {
  border-right: 1px solid #ececec;
}

.brand {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-weight: 700;
  border-bottom: 1px solid #ececec;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #ececec;
}

.main {
  background: #f7f8fa;
}
</style>
