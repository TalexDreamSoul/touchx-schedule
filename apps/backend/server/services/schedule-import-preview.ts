export type ScheduleImportPreviewParity = "all" | "odd" | "even";

export interface ScheduleImportPreviewEntry {
  previewEntryId: string;
  sourceIndex: number;
  courseName: string;
  day: number;
  startSection: number;
  endSection: number;
  weekExpr: string;
  parity: ScheduleImportPreviewParity;
  classroom: string;
  teacher: string;
  confidence: number;
}

interface ParsedScheduleCourseLike {
  name?: string;
  day?: number;
  startSection?: number;
  endSection?: number;
  weekExpr?: string;
  parity?: string;
  classroom?: string;
  teacher?: string;
  teachingClasses?: string;
}

const asString = (value: unknown) => String(value || "").trim();

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
};

const normalizeParity = (value: unknown): ScheduleImportPreviewParity => {
  const normalized = asString(value).toLowerCase();
  if (normalized === "odd" || normalized === "even") {
    return normalized;
  }
  return "all";
};

export const buildScheduleImportPreviewEntries = (
  courses: ParsedScheduleCourseLike[],
): ScheduleImportPreviewEntry[] => {
  return (Array.isArray(courses) ? courses : [])
    .map((course, index) => {
      const day = toInt(course.day, 0);
      const startSection = toInt(course.startSection, 0);
      const endSection = Math.max(startSection, toInt(course.endSection, startSection));
      const courseName = asString(course.name);
      if (!courseName || day < 1 || day > 7 || startSection <= 0 || endSection < startSection) {
        return null;
      }
      return {
        previewEntryId: `preview_${index + 1}`,
        sourceIndex: index,
        courseName,
        day,
        startSection,
        endSection,
        weekExpr: asString(course.weekExpr) || "1-20",
        parity: normalizeParity(course.parity),
        classroom: asString(course.classroom),
        teacher: asString(course.teacher),
        confidence: 0.88,
      } satisfies ScheduleImportPreviewEntry;
    })
    .filter((item): item is ScheduleImportPreviewEntry => Boolean(item));
};

export const normalizeScheduleImportPreviewCourses = (
  entries: ScheduleImportPreviewEntry[],
): Array<Required<Pick<ParsedScheduleCourseLike, "name" | "day" | "startSection" | "endSection" | "weekExpr" | "parity" | "classroom" | "teacher">>> => {
  const rows = Array.isArray(entries) ? entries : [];
  return rows.map((entry) => {
    const day = toInt(entry.day, 0);
    const startSection = toInt(entry.startSection, 0);
    const endSection = Math.max(startSection, toInt(entry.endSection, startSection));
    const courseName = asString(entry.courseName);
    if (!courseName || day < 1 || day > 7 || startSection <= 0 || endSection < startSection) {
      throw new Error("SCHEDULE_IMPORT_PREVIEW_ENTRY_INVALID");
    }
    return {
      name: courseName,
      day,
      startSection,
      endSection,
      weekExpr: asString(entry.weekExpr) || "1-20",
      parity: normalizeParity(entry.parity),
      classroom: asString(entry.classroom),
      teacher: asString(entry.teacher),
    };
  });
};
