<template>
  <el-card>
    <template #header>
      <div class="title">班级订阅管理</div>
    </template>
    <el-alert type="success" :closable="false" show-icon title="支持单班单码轮换、用户多班订阅。" />
    <div class="tools">
      <el-input v-model="createForm.classLabel" placeholder="新班级名称（如：软件工程23(5)班）" style="width: 320px" />
      <el-switch v-model="createForm.active" active-text="启用" inactive-text="停用" />
      <el-button type="primary" @click="createClass" :loading="saving">新增班级</el-button>
      <el-button @click="loadClasses" :loading="loading">刷新</el-button>
    </div>
    <el-table :data="rows" style="margin-top: 12px" stripe>
      <el-table-column prop="classId" label="班级ID" min-width="220" />
      <el-table-column prop="classLabel" label="班级" min-width="220" />
      <el-table-column prop="currentCode" label="当前随机码" min-width="140" />
      <el-table-column prop="active" label="状态" min-width="100">
        <template #default="{ row }">
          {{ row.active ? "启用" : "停用" }}
        </template>
      </el-table-column>
      <el-table-column prop="memberCount" label="成员数" min-width="100" />
      <el-table-column prop="subscriberCount" label="订阅人数" min-width="100" />
      <el-table-column label="操作" min-width="220" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" plain @click="rotateCode(row)">轮换随机码</el-button>
          <el-button size="small" @click="showMembers(row)">查看成员</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="memberDialog.visible" width="900px" :title="`班级详情：${memberDialog.item?.classLabel || '-'}`">
      <el-descriptions :column="2" border v-if="memberDialog.item">
        <el-descriptions-item label="班级ID">{{ memberDialog.item.classId }}</el-descriptions-item>
        <el-descriptions-item label="随机码">{{ memberDialog.item.currentCode }}</el-descriptions-item>
        <el-descriptions-item label="成员数">{{ memberDialog.item.memberCount }}</el-descriptions-item>
        <el-descriptions-item label="订阅数">{{ memberDialog.item.subscriberCount }}</el-descriptions-item>
      </el-descriptions>
      <el-divider />
      <div class="sub-title">班级成员（课表归属）</div>
      <el-table :data="memberDialog.item?.members || []" stripe size="small">
        <el-table-column prop="studentId" label="studentId" min-width="160" />
        <el-table-column prop="studentNo" label="学号" min-width="140" />
        <el-table-column prop="name" label="姓名" min-width="140" />
        <el-table-column prop="classLabel" label="班级" min-width="220" />
      </el-table>
      <el-divider />
      <div class="sub-title">订阅该班级的用户</div>
      <el-table :data="memberDialog.subscribers" stripe size="small">
        <el-table-column prop="studentId" label="studentId" min-width="160" />
        <el-table-column prop="studentNo" label="学号" min-width="140" />
        <el-table-column prop="name" label="姓名" min-width="140" />
        <el-table-column prop="classLabel" label="班级" min-width="220" />
      </el-table>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { onMounted, ref } from "vue";
import { apiGet, apiPost } from "../api";

interface ClassRow {
  classId: string;
  classLabel: string;
  currentCode: string;
  active: boolean;
  memberCount: number;
  subscriberCount: number;
  members?: UserRow[];
}

interface UserRow {
  studentId: string;
  studentNo: string;
  name: string;
  classLabel: string;
}

interface ClassMembersResponse {
  item: ClassRow;
  subscribers: UserRow[];
}

const rows = ref<ClassRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const createForm = ref({
  classLabel: "",
  active: true,
});
const memberDialog = ref({
  visible: false,
  item: null as ClassRow | null,
  subscribers: [] as UserRow[],
});

const loadClasses = async () => {
  loading.value = true;
  try {
    const data = await apiGet<{ items: ClassRow[] }>("/api/admin/classes");
    rows.value = data.items || [];
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载班级失败");
  } finally {
    loading.value = false;
  }
};

const createClass = async () => {
  const classLabel = createForm.value.classLabel.trim();
  if (!classLabel) {
    ElMessage.warning("请输入班级名称");
    return;
  }
  saving.value = true;
  try {
    await apiPost("/api/admin/classes", {
      class_label: classLabel,
      active: createForm.value.active,
    });
    ElMessage.success("班级已保存");
    createForm.value.classLabel = "";
    await loadClasses();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存班级失败");
  } finally {
    saving.value = false;
  }
};

const rotateCode = async (row: ClassRow) => {
  try {
    await ElMessageBox.confirm(
      `确定要轮换班级【${row.classLabel}】的随机码吗？旧码会立即失效。`,
      "确认轮换",
      { type: "warning", confirmButtonText: "确认", cancelButtonText: "取消" },
    );
    await apiPost(`/api/admin/classes/${encodeURIComponent(row.classId)}/rotate-code`, {});
    ElMessage.success("随机码已轮换");
    await loadClasses();
  } catch (error) {
    if (error === "cancel") {
      return;
    }
    ElMessage.error(error instanceof Error ? error.message : "轮换失败");
  }
};

const showMembers = async (row: ClassRow) => {
  try {
    const data = await apiGet<ClassMembersResponse>(`/api/admin/classes/${encodeURIComponent(row.classId)}/members`);
    memberDialog.value = {
      visible: true,
      item: data.item || row,
      subscribers: data.subscribers || [],
    };
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加载成员失败");
  }
};

onMounted(() => {
  void loadClasses();
});
</script>

<style scoped>
.title {
  font-weight: 700;
}

.tools {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sub-title {
  font-weight: 600;
  margin-bottom: 8px;
}
</style>
