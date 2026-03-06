import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { StudentSchedule } from "@/types/schedule";

type ScheduleListRef = Ref<StudentSchedule[]> | ComputedRef<StudentSchedule[]>;
type SubscriptionItem = { studentId: string };
type SocialDashboardLike = { subscriptions?: SubscriptionItem[] } | null;
type SocialDashboardRef = Ref<SocialDashboardLike> | ComputedRef<SocialDashboardLike>;

interface UseActiveScheduleStateOptions {
  studentSchedules: ScheduleListRef;
  socialDashboard: SocialDashboardRef;
  maxCompareOwners: number;
  includedStorageKey: string;
}

export const useActiveScheduleState = ({
  studentSchedules,
  socialDashboard,
  maxCompareOwners,
  includedStorageKey,
}: UseActiveScheduleStateOptions) => {
  const activeStudentId = ref("");
  const includedStudentIds = ref<string[]>([]);

  const isKnownStudentId = (studentId: string) => {
    return studentSchedules.value.some((student) => student.id === studentId);
  };

  const activeSchedule = computed<StudentSchedule>(() => {
    return (
      studentSchedules.value.find((student) => student.id === activeStudentId.value) ?? {
        id: "",
        name: "未登录",
        courses: [],
      }
    );
  });

  const subscribedStudentIds = computed(() => {
    const items = socialDashboard.value?.subscriptions || [];
    return Array.from(new Set(items.map((item) => item.studentId)));
  });

  const visibleStudentIds = computed(() => {
    const ids = new Set<string>();
    if (activeStudentId.value) {
      ids.add(activeStudentId.value);
    }
    for (const id of subscribedStudentIds.value) {
      ids.add(id);
    }
    return Array.from(ids);
  });

  const selectableStudentSchedules = computed(() => {
    const visible = new Set(visibleStudentIds.value);
    return studentSchedules.value.filter((student) => visible.size === 0 || visible.has(student.id));
  });

  const normalizeIncludedIds = (ids: string[]) => {
    const selectable = new Set(selectableStudentSchedules.value.map((item) => item.id));
    const validIds = Array.from(
      new Set(ids.filter((id) => isKnownStudentId(id) && (selectable.size === 0 || selectable.has(id)))),
    ).slice(0, maxCompareOwners);
    if (validIds.length > 0) {
      return validIds;
    }
    if (isKnownStudentId(activeStudentId.value)) {
      return [activeStudentId.value];
    }
    return [];
  };

  const isSameIdList = (left: string[], right: string[]) => {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => item === right[index]);
  };

  const setIncludedIds = (ids: string[]) => {
    const normalizedIds = normalizeIncludedIds(ids);
    if (isSameIdList(includedStudentIds.value, normalizedIds)) {
      return;
    }
    includedStudentIds.value = normalizedIds;
    uni.setStorageSync(includedStorageKey, normalizedIds);
  };

  const syncIncludedIdsWithVisibleList = (preferredIds: string[] = []) => {
    const seed = preferredIds.length > 0 ? preferredIds : includedStudentIds.value;
    setIncludedIds(seed);
  };

  const includedSchedules = computed(() => {
    const normalizedIds = normalizeIncludedIds(includedStudentIds.value);
    return studentSchedules.value.filter((student) => normalizedIds.includes(student.id));
  });

  const hasMultipleIncluded = computed(() => includedSchedules.value.length > 1);

  return {
    activeStudentId,
    includedStudentIds,
    activeSchedule,
    includedSchedules,
    hasMultipleIncluded,
    subscribedStudentIds,
    selectableStudentSchedules,
    isKnownStudentId,
    normalizeIncludedIds,
    setIncludedIds,
    syncIncludedIdsWithVisibleList,
  };
};
