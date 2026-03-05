export type WeekParity = "all" | "odd" | "even";

export interface CourseItem {
  id: string;
  name: string;
  day: number;
  startSection: number;
  endSection: number;
  weekExpr: string;
  parity?: WeekParity;
  classroom?: string | null;
  teacher?: string | null;
  teachingClasses?: string | null;
  practiceCourseKey?: string | null;
}

export interface StudentSchedule {
  id: string;
  name: string;
  studentNo?: string;
  classLabel?: string;
  courses: CourseItem[];
}

export interface SectionTime {
  section: number;
  start: string;
  end: string;
  part: "上午" | "下午" | "晚上";
}

export interface FreeRange {
  day: number;
  startSection: number;
  endSection: number;
}
