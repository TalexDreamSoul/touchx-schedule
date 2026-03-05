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
  teachingClasses?: string | null;
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

interface StudentProfileMeta {
  studentNo?: string;
  classLabel?: string;
}

const payload = normalizedData as NormalizedPayload;

export const termMeta = payload.term;

export const sectionTimes: SectionTime[] = payload.sectionTimes;

export const weekdayLabels = payload.weekdayLabels;

const studentProfileMetaById: Record<string, StudentProfileMeta> = {
  caiziling: { studentNo: "2305200101", classLabel: "软件工程23(5)班" },
  wuxinyu: { studentNo: "2305200112", classLabel: "软件工程23(5)班" },
  panxiaofeng: { studentNo: "2305200133", classLabel: "软件工程23(5)班" },
  linfeng: { studentNo: "2305200109", classLabel: "软件工程23(5)班" },
  liuxinrong: { studentNo: "2305200106", classLabel: "软件工程23(5)班" },
  goujiaxiang: { studentNo: "2305200330", classLabel: "软件工程23(1)班" },
  yanying: { studentNo: "2307300134", classLabel: "广播电视编导23(1)班" },
  mawanqing: { studentNo: "239610012", classLabel: "体育教育23(2)班" },
  tangzixian: { studentNo: "2305100613", classLabel: "计算机科学与技术23(3)班" },
} as const;

const baseStudentSchedules: StudentSchedule[] = payload.students.map((student) => ({
  ...student,
  studentNo: studentProfileMetaById[student.id]?.studentNo ?? student.studentNo,
  classLabel: studentProfileMetaById[student.id]?.classLabel ?? student.classLabel,
  courses: student.courses.map((course) => ({
    ...course,
    parity: course.parity ?? undefined,
    classroom: course.classroom ?? null,
    teacher: course.teacher ?? null,
    teachingClasses: course.teachingClasses ?? null,
  })),
}));

const aliasStudentConfigs = [
  { id: "linfeng", name: "林峰", copyFromId: "caiziling" },
  { id: "panxiaofeng", name: "潘晓峰", copyFromId: "caiziling" },
  { id: "liuxinrong", name: "刘欣荣", copyFromId: "caiziling" },
  { id: "wuxinyu", name: "伍鑫宇", copyFromId: "caiziling" },
] as const;

const aliasStudentSchedules: StudentSchedule[] = aliasStudentConfigs
  .filter((config) => !baseStudentSchedules.some((student) => student.id === config.id))
  .map((config) => {
    const source = baseStudentSchedules.find((student) => student.id === config.copyFromId);
    const profileMeta = studentProfileMetaById[config.id];
    return {
      id: config.id,
      name: config.name,
      studentNo: profileMeta?.studentNo ?? source?.studentNo,
      classLabel: profileMeta?.classLabel ?? source?.classLabel,
      courses: source ? source.courses.map((course) => ({ ...course })) : [],
    };
  });

export const studentSchedules: StudentSchedule[] = [...baseStudentSchedules, ...aliasStudentSchedules];
