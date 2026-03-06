<template>
  <el-card>
    <template #header>
      <div class="title">预览中心（数据态）</div>
    </template>
    <el-alert type="success" :closable="false" show-icon title="预览个人资料卡、班级订阅态、投票可见性差异。" />
    <el-form inline style="margin-top: 12px">
      <el-form-item label="学号">
        <el-input v-model="studentNo" placeholder="输入学号预览" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="loadProfilePreview">资料卡预览</el-button>
      </el-form-item>
      <el-form-item>
        <el-button @click="loadClassPreview">班级订阅预览</el-button>
      </el-form-item>
    </el-form>
    <el-card v-if="profile" shadow="never">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="姓名">{{ profile.name }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ profile.studentNo }}</el-descriptions-item>
        <el-descriptions-item label="班级">{{ profile.classLabel }}</el-descriptions-item>
        <el-descriptions-item label="头像">{{ profile.avatarUrl || "未设置" }}</el-descriptions-item>
      </el-descriptions>
    </el-card>
    <el-table v-if="classSubscriptions.length" :data="classSubscriptions" stripe style="margin-top: 12px">
      <el-table-column prop="classLabel" label="班级" min-width="220" />
      <el-table-column prop="currentCode" label="随机码" min-width="140" />
      <el-table-column prop="memberCount" label="成员" min-width="100" />
      <el-table-column prop="subscriberCount" label="订阅数" min-width="100" />
    </el-table>

    <el-divider />

    <el-form inline>
      <el-form-item label="竞选ID">
        <el-input v-model="campaignId" placeholder="输入 campaign_id" />
      </el-form-item>
      <el-form-item label="分享码">
        <el-input v-model="shareToken" placeholder="可选，用于匿名截止后实名明细" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="loadVotePreview">投票态预览</el-button>
      </el-form-item>
    </el-form>
    <el-descriptions v-if="votePreview" :column="2" border>
      <el-descriptions-item label="标题">{{ votePreview.viewerDetail.title }}</el-descriptions-item>
      <el-descriptions-item label="状态">{{ votePreview.viewerDetail.status }}</el-descriptions-item>
      <el-descriptions-item label="匿名模式">{{ votePreview.viewerDetail.isAnonymous ? "匿名" : "实名" }}</el-descriptions-item>
      <el-descriptions-item label="当前可见范围">{{ votePreview.viewerDetail.voteDetailsVisibility }}</el-descriptions-item>
      <el-descriptions-item label="我可见明细条数">{{ votePreview.viewerDetail.voteDetails.length }}</el-descriptions-item>
      <el-descriptions-item label="分享码视角明细条数">{{ votePreview.shareTokenDetail.voteDetails.length }}</el-descriptions-item>
    </el-descriptions>
  </el-card>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { ref } from "vue";
import { apiGet } from "../api";

interface PreviewProfilePayload {
  name: string;
  studentNo: string;
  classLabel: string;
  avatarUrl: string;
}

interface ClassSubscriptionPayload {
  classId: string;
  classLabel: string;
  currentCode: string;
  memberCount: number;
  subscriberCount: number;
}

interface VotePreviewDetailPayload {
  title: string;
  status: string;
  isAnonymous: boolean;
  voteDetailsVisibility: string;
  voteDetails: Array<Record<string, unknown>>;
}

interface VotePreviewPayload {
  viewerDetail: VotePreviewDetailPayload;
  shareTokenDetail: VotePreviewDetailPayload;
}

const studentNo = ref("");
const profile = ref<PreviewProfilePayload | null>(null);
const classSubscriptions = ref<ClassSubscriptionPayload[]>([]);
const campaignId = ref("");
const shareToken = ref("");
const votePreview = ref<VotePreviewPayload | null>(null);

const loadProfilePreview = async () => {
  const value = studentNo.value.trim();
  if (!value) {
    ElMessage.error("请输入学号");
    return;
  }
  try {
    const data = await apiGet<{ profile: PreviewProfilePayload }>(
      `/api/admin/preview/profile-card?student_no=${encodeURIComponent(value)}`,
    );
    profile.value = data.profile;
  } catch (error) {
    profile.value = null;
    ElMessage.error(error instanceof Error ? error.message : "加载预览失败");
  }
};

const loadClassPreview = async () => {
  const value = studentNo.value.trim();
  if (!value) {
    ElMessage.error("请输入学号");
    return;
  }
  try {
    const data = await apiGet<{ items: ClassSubscriptionPayload[] }>(
      `/api/admin/preview/class-subscriptions?student_no=${encodeURIComponent(value)}`,
    );
    classSubscriptions.value = data.items || [];
  } catch (error) {
    classSubscriptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : "加载班级预览失败");
  }
};

const loadVotePreview = async () => {
  const id = campaignId.value.trim();
  if (!id) {
    ElMessage.error("请输入竞选ID");
    return;
  }
  const params = new URLSearchParams();
  params.set("campaign_id", id);
  const studentNoValue = studentNo.value.trim();
  if (studentNoValue) {
    params.set("student_no", studentNoValue);
  }
  const shareTokenValue = shareToken.value.trim();
  if (shareTokenValue) {
    params.set("share_token", shareTokenValue);
  }
  try {
    const data = await apiGet<VotePreviewPayload & { ok?: boolean }>(`/api/admin/preview/food-vote-state?${params.toString()}`);
    votePreview.value = {
      viewerDetail: data.viewerDetail,
      shareTokenDetail: data.shareTokenDetail,
    };
  } catch (error) {
    votePreview.value = null;
    ElMessage.error(error instanceof Error ? error.message : "加载投票态预览失败");
  }
};
</script>

<style scoped>
.title {
  font-weight: 700;
}
</style>
