import { computed, ref } from "vue";

export interface SocialUserItem {
  studentId: string;
  name: string;
  studentNo?: string;
  classLabel?: string;
  avatarUrl?: string;
  wallpaperUrl?: string;
  randomCode?: string;
  isAdmin?: boolean;
  notifyBound?: boolean;
  practiceCourseKeys?: string[];
}

export interface SocialDashboardResponse {
  ok?: boolean;
  me?: SocialUserItem | null;
  subscriptions?: SocialUserItem[];
  candidates?: SocialUserItem[];
  subscribers?: SocialUserItem[];
  bound?: boolean;
}

export const buildRegisteredUsersFromDashboard = (dashboard: SocialDashboardResponse | null) => {
  const users: SocialUserItem[] = [];
  const pushUnique = (item?: SocialUserItem | null) => {
    if (!item || !item.studentId) {
      return;
    }
    if (users.some((user) => user.studentId === item.studentId)) {
      return;
    }
    users.push(item);
  };
  pushUnique(dashboard?.me);
  for (const item of dashboard?.subscriptions || []) {
    pushUnique(item);
  }
  for (const item of dashboard?.subscribers || []) {
    pushUnique(item);
  }
  for (const item of dashboard?.candidates || []) {
    pushUnique(item);
  }
  return users;
};

export const useSocialDashboard = () => {
  const dashboard = ref<SocialDashboardResponse | null>(null);
  const subscriptions = computed(() => dashboard.value?.subscriptions || []);
  const candidates = computed(() => dashboard.value?.candidates || []);
  const subscribedStudentIdSet = computed(() => {
    return new Set(subscriptions.value.map((item) => item.studentId));
  });

  const refreshDashboard = async (loader: () => Promise<SocialDashboardResponse>) => {
    const data = await loader();
    dashboard.value = data;
    return data;
  };

  const clearDashboard = () => {
    dashboard.value = null;
  };

  return {
    dashboard,
    subscriptions,
    candidates,
    subscribedStudentIdSet,
    refreshDashboard,
    clearDashboard,
  };
};
