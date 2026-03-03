import normalizedData from "@/data/normalized/schedules.normalized.json";
import type { CourseItem, SectionTime, StudentSchedule, WeekParity } from "@/types/schedule";

interface NormalizedTermMeta {
  name: string;
  week1Monday: string;
  maxWeek: number;
}

interface NormalizedCourse extends CourseItem {
  parity?: WeekParity;
  classroom?: string | null;
  teacher?: string | null;
}

interface NormalizedStudent extends Omit<StudentSchedule, "courses"> {
  courses: NormalizedCourse[];
}

interface NormalizedPayload {
  term: NormalizedTermMeta;
  sectionTimes: SectionTime[];
  weekdayLabels: string[];
  students: NormalizedStudent[];
}

const payload = normalizedData as NormalizedPayload;

export const termMeta = payload.term;

export const sectionTimes: SectionTime[] = payload.sectionTimes;

export const weekdayLabels = payload.weekdayLabels;

const baseStudentSchedules: StudentSchedule[] = payload.students.map((student) => ({
  ...student,
  courses: student.courses.map((course) => ({
    ...course,
    parity: course.parity ?? undefined,
    classroom: course.classroom ?? null,
    teacher: course.teacher ?? null,
  })),
}));

const aliasStudentConfigs = [
  { id: "wuxinyu", name: "伍鑫宇", copyFromId: "caiziling" },
] as const;

const aliasStudentSchedules: StudentSchedule[] = aliasStudentConfigs
  .filter((config) => !baseStudentSchedules.some((student) => student.id === config.id))
  .map((config) => {
    const source = baseStudentSchedules.find((student) => student.id === config.copyFromId);
    return {
      id: config.id,
      name: config.name,
      studentNo: source?.studentNo,
      courses: source ? source.courses.map((course) => ({ ...course })) : [],
    };
  });

export const studentSchedules: StudentSchedule[] = [...baseStudentSchedules, ...aliasStudentSchedules];
