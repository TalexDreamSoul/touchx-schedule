<template>
  <NexusAdminShell title="Heart Open" description="心口难开词库管理，维护前台游戏抽取词条。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Words</span>
        <strong>{{ words.length }}</strong>
        <p>当前词条</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Enabled</span>
        <strong>{{ enabledCount }}</strong>
        <p>启用词条</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Categories</span>
        <strong>{{ categories.length }}</strong>
        <p>分类数量</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Selected</span>
        <strong>{{ editForm.wordId ? 1 : 0 }}</strong>
        <p>{{ editForm.word || "未选择" }}</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="word-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>词条列表</h2>
            <p>支持关键词、分类、难度和启用状态筛选。</p>
          </div>
          <div class="rx-actions">
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="resetFilter">重置</button>
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
          </div>
        </header>

        <div class="filter-row">
          <input v-model.trim="query.keyword" placeholder="关键词：词语 / 惩罚 / 分类" @keyup.enter="loadData" />
          <select v-model="query.category">
            <option value="">全部分类</option>
            <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
          </select>
          <select v-model="query.difficulty">
            <option value="">全部难度</option>
            <option value="easy">简单</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
          <select v-model="query.enabled">
            <option value="">全部状态</option>
            <option value="true">仅启用</option>
            <option value="false">仅停用</option>
          </select>
          <button class="rx-btn" type="button" :disabled="loading" @click="loadData">筛选</button>
        </div>

        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead>
              <tr><th>词语</th><th>惩罚</th><th>分类</th><th>难度</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in words" :key="item.wordId" :class="{ 'selected-row': item.wordId === editForm.wordId }">
                <td><strong>{{ item.word }}</strong><div class="rx-muted">{{ item.wordId }}</div></td>
                <td class="punishment-cell">{{ item.punishment }}</td>
                <td>{{ item.category }}</td>
                <td><span class="rx-pill">{{ item.difficultyLabel || toDifficultyLabel(item.difficulty) }}</span></td>
                <td><span class="rx-pill">{{ item.enabled ? "enabled" : "disabled" }}</span></td>
                <td>{{ toDisplayDate(item.updatedAt) }}</td>
                <td class="action-cell">
                  <button class="rx-btn rx-btn-ghost" type="button" @click="selectWord(item)">编辑</button>
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="toggleWord(item)">{{ item.enabled ? "停用" : "启用" }}</button>
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="deleteWord(item)">删除</button>
                </td>
              </tr>
              <tr v-if="words.length <= 0"><td colspan="7" class="rx-muted">暂无词条</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>新增词条</h2><p>默认立即启用。</p></div></header>
          <div class="nexus-form">
            <input v-model.trim="createForm.word" maxlength="60" placeholder="词语，例如：前任名字" />
            <textarea v-model.trim="createForm.punishment" rows="5" maxlength="240" placeholder="惩罚内容" />
            <input v-model.trim="createForm.category" maxlength="40" placeholder="分类，例如：情感社死" />
            <select v-model="createForm.difficulty">
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
            <label class="check-row"><input v-model="createForm.enabled" type="checkbox" /><span>创建后启用</span></label>
            <button class="rx-btn" type="button" :disabled="loading || !createForm.word || !createForm.punishment" @click="createWord">新增词条</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>编辑词条</h2><p>{{ editForm.wordId || "请选择词条" }}</p></div></header>
          <div class="nexus-form">
            <input v-model.trim="editForm.word" maxlength="60" placeholder="词语" :disabled="!editForm.wordId" />
            <textarea v-model.trim="editForm.punishment" rows="5" maxlength="240" placeholder="惩罚内容" :disabled="!editForm.wordId" />
            <input v-model.trim="editForm.category" maxlength="40" placeholder="分类" :disabled="!editForm.wordId" />
            <select v-model="editForm.difficulty" :disabled="!editForm.wordId">
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
            <label class="check-row"><input v-model="editForm.enabled" type="checkbox" :disabled="!editForm.wordId" /><span>词条启用</span></label>
            <button class="rx-btn" type="button" :disabled="loading || !editForm.wordId || !editForm.word || !editForm.punishment" @click="saveWord">保存编辑</button>
          </div>
        </article>
      </aside>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

type HeartOpenDifficulty = "easy" | "medium" | "hard";

interface HeartOpenWordRow {
  wordId: string;
  word: string;
  punishment: string;
  category: string;
  difficulty: HeartOpenDifficulty;
  difficultyLabel?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const words = ref<HeartOpenWordRow[]>([]);
const serverCategories = ref<string[]>([]);
const query = reactive({ keyword: "", category: "", difficulty: "", enabled: "" });
const createForm = reactive({ word: "", punishment: "", category: "", difficulty: "medium" as HeartOpenDifficulty, enabled: true });
const editForm = reactive({ wordId: "", word: "", punishment: "", category: "", difficulty: "medium" as HeartOpenDifficulty, enabled: true });

const enabledCount = computed(() => words.value.filter((item) => item.enabled).length);
const categories = computed(() => {
  const categorySet = new Set<string>(serverCategories.value);
  words.value.forEach((item) => {
    if (item.category) categorySet.add(item.category);
  });
  return Array.from(categorySet.values()).sort((left, right) => left.localeCompare(right, "zh-CN"));
});

const toDifficultyLabel = (value: unknown) => {
  const key = String(value || "").trim().toLowerCase();
  if (key === "easy") return "简单";
  if (key === "hard") return "困难";
  return "中等";
};

const normalizeDifficulty = (value: unknown): HeartOpenDifficulty => {
  const key = String(value || "").trim().toLowerCase();
  return key === "easy" || key === "hard" || key === "medium" ? key : "medium";
};

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const buildQuery = () => {
  const params = new URLSearchParams();
  if (query.keyword.trim()) params.set("keyword", query.keyword.trim());
  if (query.category.trim()) params.set("category", query.category.trim());
  if (query.difficulty.trim()) params.set("difficulty", normalizeDifficulty(query.difficulty));
  if (query.enabled.trim()) params.set("enabled", query.enabled.trim());
  const text = params.toString();
  return text ? `?${text}` : "";
};

const applyEditForm = (item: HeartOpenWordRow) => {
  editForm.wordId = item.wordId || "";
  editForm.word = item.word || "";
  editForm.punishment = item.punishment || "";
  editForm.category = item.category || "";
  editForm.difficulty = normalizeDifficulty(item.difficulty);
  editForm.enabled = Boolean(item.enabled);
};

const selectWord = (item: HeartOpenWordRow) => applyEditForm(item);

const syncSelection = () => {
  if (words.value.length <= 0) {
    editForm.wordId = "";
    editForm.word = "";
    editForm.punishment = "";
    editForm.category = "";
    editForm.difficulty = "medium";
    editForm.enabled = true;
    return;
  }
  const matched = words.value.find((item) => item.wordId === editForm.wordId) || words.value[0];
  applyEditForm(matched);
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: HeartOpenWordRow[]; options?: { categories?: string[] } }>(`/api/v1/admin/party-games/heart-open/word-bank${buildQuery()}`);
    words.value = data.items || [];
    serverCategories.value = data.options?.categories || [];
    syncSelection();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载词库失败";
  } finally {
    loading.value = false;
  }
};

const resetFilter = async () => {
  query.keyword = "";
  query.category = "";
  query.difficulty = "";
  query.enabled = "";
  await loadData();
};

const createWord = async () => {
  if (!createForm.word.trim() || !createForm.punishment.trim()) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/party-games/heart-open/word-bank", {
      method: "POST",
      body: {
        word: createForm.word.trim(),
        punishment: createForm.punishment.trim(),
        category: createForm.category.trim() || "默认",
        difficulty: normalizeDifficulty(createForm.difficulty),
        enabled: createForm.enabled,
      },
    });
    createForm.word = "";
    createForm.punishment = "";
    createForm.category = "";
    createForm.difficulty = "medium";
    createForm.enabled = true;
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "新增词条失败";
  } finally {
    loading.value = false;
  }
};

const saveWord = async () => {
  if (!editForm.wordId || !editForm.word.trim() || !editForm.punishment.trim()) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/party-games/heart-open/word-bank/${encodeURIComponent(editForm.wordId)}/update`, {
      method: "POST",
      body: {
        word: editForm.word.trim(),
        punishment: editForm.punishment.trim(),
        category: editForm.category.trim() || "默认",
        difficulty: normalizeDifficulty(editForm.difficulty),
        enabled: editForm.enabled,
      },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存词条失败";
  } finally {
    loading.value = false;
  }
};

const toggleWord = async (item: HeartOpenWordRow) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/party-games/heart-open/word-bank/${encodeURIComponent(item.wordId)}/update`, {
      method: "POST",
      body: { enabled: !item.enabled },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "切换词条状态失败";
  } finally {
    loading.value = false;
  }
};

const deleteWord = async (item: HeartOpenWordRow) => {
  if (!window.confirm(`确认删除「${item.word || item.wordId}」吗？`)) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/party-games/heart-open/word-bank/${encodeURIComponent(item.wordId)}/delete`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "删除词条失败";
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
.word-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.35fr);
  gap: 1rem;
}

.side-stack {
  display: grid;
  gap: 1rem;
  align-self: start;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(14rem, 1fr) 10rem 9rem 9rem auto;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.filter-row input,
.filter-row select {
  min-height: 2.5rem;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 0.25rem);
  padding: 0.55rem 0.75rem;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.compact-head {
  margin-bottom: 0.75rem;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
}

.punishment-cell {
  max-width: 22rem;
  white-space: normal;
}

.selected-row {
  background: hsl(var(--muted) / 0.55);
}

.action-cell {
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .word-layout,
  .filter-row {
    grid-template-columns: 1fr;
  }
}
</style>
