import { sectionTimes } from "@/data/schedules";
import type { CourseItem, FreeRange, StudentSchedule, WeekParity } from "@/types/schedule";

const MAX_WEEK = 25;
const MAX_SECTION = sectionTimes.length;

const weekRangeMatcher = /(\d+)(?:-(\d+))?/g;
const practiceCourseKeyMatcher = /^[^|]+\|\d+\|\d+-\d+\|[^|]+\|(all|odd|even)$/;

const normalizeCourseParity = (parity?: WeekParity | null) => {
  if (parity === "odd" || parity === "even") {
    return parity;
  }
  return "all";
};

export const buildCoursePracticeKey = (
  course: Pick<CourseItem, "id" | "day" | "startSection" | "endSection" | "weekExpr" | "parity">,
) => {
  const courseId = String(course.id || "").trim();
  const day = Number(course.day || 0);
  const startSection = Number(course.startSection || 0);
  const endSection = Number(course.endSection || 0);
  const weekExpr = String(course.weekExpr || "").trim();
  const parity = normalizeCourseParity(course.parity);
  if (!courseId || !Number.isFinite(day) || !Number.isFinite(startSection) || !Number.isFinite(endSection) || !weekExpr) {
    return "";
  }
  if (day <= 0 || startSection <= 0 || endSection <= 0) {
    return "";
  }
  return `${courseId}|${Math.floor(day)}|${Math.floor(startSection)}-${Math.floor(endSection)}|${weekExpr}|${parity}`;
};

export const normalizePracticeCourseKey = (raw: unknown) => {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }
  if (!practiceCourseKeyMatcher.test(value)) {
    return "";
  }
  return value;
};

export const isCourseInWeek = (course: CourseItem, week: number) => {
  if (!Number.isInteger(week) || week < 1 || week > MAX_WEEK) {
    return false;
  }

  let matched = false;
  for (const m of course.weekExpr.matchAll(weekRangeMatcher)) {
    const start = Number(m[1]);
    const end = Number(m[2] ?? m[1]);
    if (week >= start && week <= end) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    return false;
  }

  const parity = course.parity ?? "all";
  return matchParity(week, parity);
};

export const getWeekCourses = (schedule: StudentSchedule, week: number) => {
  return schedule.courses
    .filter((course) => isCourseInWeek(course, week))
    .sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.endSection - b.endSection);
};

export const formatSectionRange = (startSection: number, endSection: number) => {
  const start = sectionTimes[startSection - 1];
  const end = sectionTimes[endSection - 1];
  if (!start || !end) {
    return `第${startSection}-${endSection}节`;
  }
  return `第${startSection}-${endSection}节 ${start.start}-${end.end}`;
};

export const getCommonFreeRanges = (schedules: StudentSchedule[], week: number) => {
  if (schedules.length === 0) {
    return [] as FreeRange[];
  }

  const busyMatrices = schedules.map((schedule) => buildBusyMatrix(schedule, week));
  const ranges: FreeRange[] = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    let freeStart = 0;
    for (let sectionIndex = 0; sectionIndex < MAX_SECTION; sectionIndex += 1) {
      const isBusy = busyMatrices.some((matrix) => matrix[dayIndex][sectionIndex]);
      const section = sectionIndex + 1;

      if (!isBusy && freeStart === 0) {
        freeStart = section;
      }

      const isRangeEnd = isBusy || section === MAX_SECTION;
      if (freeStart !== 0 && isRangeEnd) {
        const endSection = isBusy ? section - 1 : section;
        if (endSection >= freeStart) {
          ranges.push({
            day: dayIndex + 1,
            startSection: freeStart,
            endSection,
          });
        }
        freeStart = 0;
      }
    }
  }

  return ranges;
};

const matchParity = (week: number, parity: WeekParity) => {
  if (parity === "odd") {
    return week % 2 === 1;
  }
  if (parity === "even") {
    return week % 2 === 0;
  }
  return true;
};

const buildBusyMatrix = (schedule: StudentSchedule, week: number) => {
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: MAX_SECTION }, () => false));

  for (const course of getWeekCourses(schedule, week)) {
    const dayIndex = course.day - 1;
    if (dayIndex < 0 || dayIndex > 6) {
      continue;
    }

    for (let section = course.startSection; section <= course.endSection; section += 1) {
      if (section >= 1 && section <= MAX_SECTION) {
        matrix[dayIndex][section - 1] = true;
      }
    }
  }

  return matrix;
};
