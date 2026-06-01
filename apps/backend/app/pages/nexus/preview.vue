<template>
  <NexusAdminShell title="Preview" description="轻量联调入口：用户资料卡、班级订阅和 ClawDBot 模拟。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Profile</span>
        <strong>{{ profilePreview ? "1" : "0" }}</strong>
        <p>资料卡预览</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Subscriptions</span>
        <strong>{{ subscriptionCount }}</strong>
        <p>班级订阅预览</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Bot</span>
        <strong>{{ botReply ? "OK" : "--" }}</strong>
        <p>ClawDBot 模拟</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Student</span>
        <strong>{{ previewForm.studentNo || "--" }}</strong>
        <p>当前预览学号</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="preview-grid">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>学生预览</h2>
            <p>读取资料卡和班级订阅状态。</p>
          </div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
        </header>
        <div class="nexus-form preview-form">
          <input v-model.trim="previewForm.studentNo" placeholder="学号" />
          <button class="rx-btn" type="button" :disabled="loading || !previewForm.studentNo" @click="loadData">加载预览</button>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading || !previewForm.studentNo" @click="repairSubscriptions">修复订阅 dry-run</button>
        </div>
        <div class="result-block">
          <h3>Profile</h3>
          <pre class="rx-json">{{ toJson(profilePreview) }}</pre>
        </div>
        <div class="result-block">
          <h3>Class Subscriptions</h3>
          <pre class="rx-json">{{ toJson(classSubscriptions) }}</pre>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>ClawDBot 模拟</h2>
            <p>调用 `POST /api/v1/bot/clawdbot/simulate`，快速验证自然语言日程解析。</p>
          </div>
        </header>
        <div class="nexus-form">
          <input v-model.trim="botForm.nickname" placeholder="昵称" />
          <textarea v-model.trim="botForm.text" rows="5" placeholder="例如：周三下午3点复习数据结构，期末考试前提醒我" />
          <label class="check-row"><input v-model="botForm.commit" type="checkbox" /><span>commit 写入个人日程</span></label>
          <button class="rx-btn" type="button" :disabled="loading || !previewForm.studentNo || !botForm.text" @click="simulateBot">模拟机器人</button>
        </div>
        <div class="result-block">
          <h3>Reply</h3>
          <p class="reply-text">{{ botReply || "暂无 reply" }}</p>
        </div>
        <div class="result-block">
          <h3>Candidates</h3>
          <pre class="rx-json">{{ toJson(botResult) }}</pre>
        </div>
      </article>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const profilePreview = ref<Record<string, unknown> | null>(null);
const classSubscriptions = ref<Record<string, any> | null>(null);
const repairResult = ref<Record<string, unknown> | null>(null);
const botResult = ref<Record<string, any> | null>(null);
const previewForm = reactive({ studentNo: "" });
const botForm = reactive({ nickname: "ClawBot测试", text: "周三下午3点复习数据结构，期末考试前提醒我", commit: false });

const subscriptionCount = computed(() => Number(classSubscriptions.value?.subscriptions?.length || 0));
const botReply = computed(() => String(botResult.value?.reply?.text || botResult.value?.text || ""));

const toJson = (value: unknown) => JSON.stringify(value || {}, null, 2);

const loadDefaultStudentNo = async () => {
  if (previewForm.studentNo.trim()) return;
  const data = await request<{ items: Array<{ studentNo?: string; adminRole?: string }> }>("/api/v1/admin/users?limit=20");
  const firstStudent = (data.items || []).find((item) => item.adminRole === "none" && String(item.studentNo || "").trim()) || data.items?.[0] || null;
  previewForm.studentNo = String(firstStudent?.studentNo || "").trim();
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await loadDefaultStudentNo();
    if (!previewForm.studentNo.trim()) return;
    const params = new URLSearchParams({ studentNo: previewForm.studentNo.trim() });
    const [profile, subscriptions] = await Promise.all([
      request<Record<string, unknown>>(`/api/v1/admin/preview/profile-card?${params.toString()}`),
      request<Record<string, any>>(`/api/v1/admin/preview/class-subscriptions?${params.toString()}`),
    ]);
    profilePreview.value = profile;
    classSubscriptions.value = subscriptions;
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载预览失败";
  } finally {
    loading.value = false;
  }
};

const repairSubscriptions = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    repairResult.value = await request<Record<string, unknown>>("/api/v1/admin/preview/class-subscriptions/repair", {
      method: "POST",
      body: { studentNo: previewForm.studentNo.trim(), dryRun: true },
    });
    classSubscriptions.value = { ...(classSubscriptions.value || {}), repairResult: repairResult.value };
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "修复预览失败";
  } finally {
    loading.value = false;
  }
};

const simulateBot = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    botResult.value = await request<Record<string, any>>("/api/v1/bot/clawdbot/simulate", {
      method: "POST",
      body: {
        studentNo: previewForm.studentNo.trim(),
        nickname: botForm.nickname,
        text: botForm.text,
        commit: botForm.commit,
      },
    });
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "机器人模拟失败";
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  if (!ensureSessionToken()) {
    await goToLogin();
    return;
  }
  await loadData();
});
</script>

<style scoped>
.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.preview-form {
  grid-template-columns: minmax(12rem, 1fr) auto auto;
  align-items: center;
}

.result-block {
  margin-top: 1rem;
}

.result-block h3 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
}

.reply-text {
  margin: 0;
  color: hsl(var(--foreground));
  line-height: 1.6;
}

@media (max-width: 1080px) {
  .preview-grid,
  .preview-form {
    grid-template-columns: 1fr;
  }
}
</style>
