import type { CourseItem } from "@/types/schedule";

export interface DisplayCourse extends CourseItem {
  ownerId: string;
  ownerName: string;
}

export interface GridRowCell {
  busy: boolean;
  labels: string[];
  classroomLabel: string;
  ownerIds: string[];
  hasPracticeCourse: boolean;
  showLabel: boolean;
  labelSpan: number;
  part: string;
  isOutOfWeek: boolean;
  mergeWithPrev: boolean;
  mergeWithNext: boolean;
}

export interface GridRow {
  section: number;
  time: string;
  part: "上午" | "下午" | "晚上";
  isPartStart: boolean;
  cells: GridRowCell[];
}

export type WeekPanelRole = "prev" | "current" | "next";

export interface ScheduleWeekPanel {
  role: WeekPanelRole;
  week: number;
  rows: GridRow[];
}
