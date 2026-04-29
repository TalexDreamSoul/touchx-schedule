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
  courseName?: string;
  day?: number;
  weekday?: number;
  startSection?: number;
  endSection?: number;
  sections?: unknown;
  weekExpr?: string;
  weeks?: string;
  parity?: string;
  classroom?: string;
  location?: string;
  teacher?: string;
  teachingClasses?: string;
}

export interface AiScheduleOcrPreviewResult {
  rawText: string;
  studentNo: string;
  term: string;
  parsedName: string;
  previewEntries: ScheduleImportPreviewEntry[];
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
  if (normalized === "单周" || normalized === "单" || normalized === "odd_week") {
    return "odd";
  }
  if (normalized === "双周" || normalized === "双" || normalized === "even_week") {
    return "even";
  }
  if (normalized === "odd" || normalized === "even") {
    return normalized;
  }
  return "all";
};

const parseWeekday = (value: unknown) => {
  const text = asString(value);
  const weekdayMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
  };
  if (weekdayMap[text]) {
    return weekdayMap[text];
  }
  const matched = text.match(/周\s*([一二三四五六日天1-7])/);
  if (matched) {
    return parseWeekday(matched[1]);
  }
  const parsed = toInt(value, 0);
  if (parsed >= 1 && parsed <= 7) {
    return parsed;
  }
  return 0;
};

const parseSections = (course: ParsedScheduleCourseLike) => {
  const directStart = toInt(course.startSection, 0);
  const directEnd = toInt(course.endSection, directStart);
  if (directStart > 0) {
    return {
      startSection: directStart,
      endSection: Math.max(directStart, directEnd),
    };
  }
  if (Array.isArray(course.sections)) {
    const startSection = toInt(course.sections[0], 0);
    const endSection = toInt(course.sections[course.sections.length - 1], startSection);
    return {
      startSection,
      endSection: Math.max(startSection, endSection),
    };
  }
  const text = asString(course.sections);
  const matched = text.match(/(\d{1,2})\D+(\d{1,2})/);
  if (matched) {
    const startSection = toInt(matched[1], 0);
    return {
      startSection,
      endSection: Math.max(startSection, toInt(matched[2], startSection)),
    };
  }
  const single = toInt(text, 0);
  return {
    startSection: single,
    endSection: single,
  };
};

const extractJsonCandidate = (rawText: string) => {
  const text = asString(rawText)
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
};

const pickString = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return "";
};

const normalizeAiOcrCourse = (value: unknown): ParsedScheduleCourseLike => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const sections = record.sections || record.section || record.lessonSections || record.periods || record.period;
  return {
    name: pickString(record, ["courseName", "name", "title", "course", "subject"]),
    day: parseWeekday(record.day ?? record.weekday ?? record.weekDay ?? record.dayOfWeek),
    startSection: toInt(record.startSection ?? record.start ?? record.sectionStart ?? record.startPeriod, 0),
    endSection: toInt(record.endSection ?? record.end ?? record.sectionEnd ?? record.endPeriod, 0),
    sections,
    weekExpr: pickString(record, ["weekExpr", "weeks", "weekRange", "week", "weeksText"]) || "1-20",
    parity: asString(record.parity || record.weekParity || record.oddEven),
    classroom: pickString(record, ["classroom", "location", "room", "place"]),
    teacher: pickString(record, ["teacher", "instructor", "lecturer"]),
  };
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

export const normalizeAiScheduleOcrPreview = (input: unknown): AiScheduleOcrPreviewResult => {
  const rawText = typeof input === "string" ? input : JSON.stringify(input || {});
  const payload = typeof input === "string" ? extractJsonCandidate(input) : input;
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const rawCourses = Array.isArray(payload)
    ? payload
    : Array.isArray(record.courses)
      ? record.courses
      : Array.isArray(record.entries)
        ? record.entries
        : Array.isArray(record.schedule)
          ? record.schedule
          : [];
  const courses = rawCourses.map(normalizeAiOcrCourse).map((course) => {
    const sections = parseSections(course);
    return {
      ...course,
      startSection: sections.startSection,
      endSection: sections.endSection,
      parity: normalizeParity(course.parity),
    };
  });
  const previewEntries = buildScheduleImportPreviewEntries(courses);
  if (previewEntries.length <= 0) {
    throw new Error("AI_OCR_PREVIEW_EMPTY");
  }
  return {
    rawText,
    studentNo: pickString(record, ["studentNo", "studentId", "student_number"]),
    term: pickString(record, ["term", "semester"]),
    parsedName: pickString(record, ["name", "studentName", "student_name"]),
    previewEntries,
  };
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
