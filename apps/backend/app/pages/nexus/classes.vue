<template>
  <NexusAdminShell title="Classes" description="班级生命周期、加入码与成员概览。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Classes</span>
        <strong>{{ classes.length }}</strong>
        <p>班级总数</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Active</span>
        <strong>{{ activeCount }}</strong>
        <p>启用班级</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Members</span>
        <strong>{{ memberCount }}</strong>
        <p>成员聚合</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Selected</span>
        <strong>{{ selectedClass ? 1 : 0 }}</strong>
        <p>{{ selectedClass?.classLabel || "未选择" }}</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="classes-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>班级列表</h2>
            <p>可编辑名称、负责人、状态，并轮换加入码。</p>
          </div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
        </header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>班级</th><th>成员</th><th>订阅</th><th>状态</th><th>加入码</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in classes" :key="item.classId">
                <td><strong>{{ item.classLabel }}</strong><div class="rx-muted">{{ item.classId }}</div></td>
                <td>{{ item.memberCount }}</td>
                <td>{{ item.subscriberCount }}</td>
                <td><span class="rx-pill">{{ item.active ? "active" : "inactive" }}</span></td>
                <td>{{ item.currentCode }}</td>
                <td class="action-cell">
                  <button class="rx-btn rx-btn-ghost" type="button" @click="selectClass(item)">编辑</button>
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="rotateCode(item.classId)">换码</button>
                  <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadMembers(item.classId)">成员</button>
                </td>
              </tr>
              <tr v-if="classes.length <= 0"><td colspan="6" class="rx-muted">暂无班级</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head">
            <div>
              <h2>新建班级</h2>
              <p>负责人学号为空时使用当前管理员。</p>
            </div>
          </header>
          <div class="nexus-form">
            <input v-model.trim="createForm.classLabel" placeholder="班级名称" />
            <input v-model.trim="createForm.ownerStudentNo" placeholder="负责人学号，可空" />
            <label class="check-row"><input v-model="createForm.active" type="checkbox" /><span>启用</span></label>
            <button class="rx-btn" type="button" :disabled="loading || !createForm.classLabel" @click="createClass">创建班级</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head">
            <div>
              <h2>编辑班级</h2>
              <p>{{ selectedClass?.classId || "请选择班级" }}</p>
            </div>
          </header>
          <div class="nexus-form">
            <input v-model.trim="editForm.classLabel" placeholder="班级名称" :disabled="!selectedClass" />
            <input v-model.trim="editForm.timezone" placeholder="Asia/Shanghai" :disabled="!selectedClass" />
            <input v-model.trim="editForm.ownerStudentNo" placeholder="新负责人学号，可空" :disabled="!selectedClass" />
            <label class="check-row"><input v-model="editForm.active" type="checkbox" :disabled="!selectedClass" /><span>启用</span></label>
            <button class="rx-btn" type="button" :disabled="loading || !selectedClass" @click="saveClass">保存班级</button>
          </div>
        </article>
      </aside>
    </section>

    <section class="rx-card" v-if="membersDetail">
      <header class="rx-card-head">
        <div>
          <h2>成员详情：{{ membersDetail.item.classLabel }}</h2>
          <p>成员 {{ membersDetail.item.memberCount }} / 订阅 {{ membersDetail.item.subscriberCount }}</p>
        </div>
        <span class="rx-pill">{{ membersDetail.item.currentCode }}</span>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>姓名</th><th>学号</th><th>角色</th><th>班级标签</th><th>加入时间</th></tr></thead>
          <tbody>
            <tr v-for="member in membersDetail.item.members" :key="member.memberId">
              <td>{{ member.name }}</td>
              <td>{{ member.studentNo }}</td>
              <td><span class="rx-pill">{{ member.classRole }}</span></td>
              <td>{{ member.classLabel }}</td>
              <td>{{ toDisplayDate(member.joinedAt) }}</td>
            </tr>
            <tr v-if="membersDetail.item.members.length <= 0"><td colspan="5" class="rx-muted">暂无成员</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface ClassRow {
  classId: string;
  classLabel: string;
  currentCode: string;
  active: boolean;
  memberCount: number;
  subscriberCount: number;
}

interface ClassMemberDetail {
  item: ClassRow & {
    members: Array<{
      memberId: string;
      classRole: string;
      joinedAt: string;
      studentNo: string;
      name: string;
      classLabel: string;
    }>;
  };
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const classes = ref<ClassRow[]>([]);
const selectedClass = ref<ClassRow | null>(null);
const membersDetail = ref<ClassMemberDetail | null>(null);
const createForm = reactive({ classLabel: "", ownerStudentNo: "", active: true });
const editForm = reactive({ classLabel: "", timezone: "Asia/Shanghai", ownerStudentNo: "", active: true });

const activeCount = computed(() => classes.value.filter((item) => item.active).length);
const memberCount = computed(() => classes.value.reduce((sum, item) => sum + Number(item.memberCount || 0), 0));

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const applyEditForm = (item: ClassRow) => {
  editForm.classLabel = item.classLabel || "";
  editForm.timezone = "Asia/Shanghai";
  editForm.ownerStudentNo = "";
  editForm.active = Boolean(item.active);
};

const selectClass = (item: ClassRow) => {
  selectedClass.value = item;
  applyEditForm(item);
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: ClassRow[] }>("/api/v1/admin/classes");
    classes.value = data.items || [];
    const selectedId = selectedClass.value?.classId;
    const nextSelected = (selectedId && classes.value.find((item) => item.classId === selectedId)) || classes.value[0] || null;
    selectedClass.value = nextSelected;
    if (nextSelected) applyEditForm(nextSelected);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载班级失败";
  } finally {
    loading.value = false;
  }
};

const createClass = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/classes", { method: "POST", body: createForm });
    createForm.classLabel = "";
    createForm.ownerStudentNo = "";
    createForm.active = true;
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建班级失败";
  } finally {
    loading.value = false;
  }
};

const saveClass = async () => {
  if (!selectedClass.value) return;
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/classes/${encodeURIComponent(selectedClass.value.classId)}/update`, { method: "POST", body: editForm });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存班级失败";
  } finally {
    loading.value = false;
  }
};

const rotateCode = async (classId: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/classes/${encodeURIComponent(classId)}/rotate-code`, { method: "POST" });
    await loadData();
    if (membersDetail.value?.item.classId === classId) await loadMembers(classId);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "轮换加入码失败";
  } finally {
    loading.value = false;
  }
};

const loadMembers = async (classId: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    membersDetail.value = await request<ClassMemberDetail>(`/api/v1/admin/classes/${encodeURIComponent(classId)}/members`);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载成员失败";
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
.classes-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.35fr);
  gap: 1rem;
}

.side-stack {
  display: grid;
  gap: 1rem;
  align-self: start;
}

.action-cell {
  white-space: nowrap;
}

.action-cell .rx-btn + .rx-btn {
  margin-left: 0.35rem;
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

@media (max-width: 1080px) {
  .classes-layout {
    grid-template-columns: 1fr;
  }
}
</style>
