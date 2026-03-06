<template>
  <div class="page">
    <el-card class="card">
      <template #header>
        <div class="title">TouchX Admin 登录</div>
      </template>
      <el-form @submit.prevent>
        <el-form-item label="管理员 Token">
          <el-input v-model="token" show-password placeholder="请输入 ADMIN_WEB_AUTH_TOKEN" />
        </el-form-item>
        <el-button type="primary" :loading="pending" @click="submitLogin">登录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const authStore = useAuthStore();
const token = ref("");
const pending = ref(false);

const submitLogin = async () => {
  const value = token.value.trim();
  if (!value) {
    ElMessage.error("请输入 token");
    return;
  }
  pending.value = true;
  try {
    await authStore.login(value);
    ElMessage.success("登录成功");
    await router.replace("/dashboard");
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    ElMessage.error(message);
  } finally {
    pending.value = false;
  }
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}

.card {
  width: min(90vw, 460px);
}

.title {
  font-size: 18px;
  font-weight: 700;
}
</style>
