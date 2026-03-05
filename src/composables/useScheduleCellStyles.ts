import type { CSSProperties, ComputedRef, Ref } from "vue";
import type { StudentSchedule } from "@/types/schedule";
import type { DisplayCourse, GridRowCell } from "@/pages/index/types";

type ThemeKeyLike = string;

type ScheduleListRef = Ref<StudentSchedule[]> | ComputedRef<StudentSchedule[]>;
type BoolRef = Ref<boolean> | ComputedRef<boolean>;
type ThemeRef = Ref<ThemeKeyLike> | ComputedRef<ThemeKeyLike>;

const THEME_ACCENT_MAP: Record<string, string> = {
  black: "#2f55c8",
  purple: "#a061ff",
  green: "#13c56a",
  pink: "#ef45a5",
  blue: "#2e9dff",
  yellow: "#d9a511",
  orange: "#f57b16",
};

const OWNER_FIXED_COLOR_MAP: Record<string, string> = {
  caiziling: "#2563eb",
  mawanqing: "#dc2626",
  tangzixian: "#ea580c",
  wuxinyu: "#7c3aed",
  yanying: "#0f766e",
};

const COMPARE_OWNER_PALETTE = ["#2563eb", "#dc2626", "#ea580c", "#7c3aed", "#16a34a", "#db2777", "#0891b2"];
const COURSE_OVERLAY_PALETTE = ["#6f84d8", "#d99663", "#c7749e", "#6a9fcb", "#9c88d8", "#d6a35f"];

interface UseScheduleCellStylesOptions {
  themeKey: ThemeRef;
  hasMultipleIncluded: BoolRef;
  studentSchedules: ScheduleListRef;
}

export const useScheduleCellStyles = ({ themeKey, hasMultipleIncluded, studentSchedules }: UseScheduleCellStylesOptions) => {
  const hashString = (value: string) => {
    let hash = 0;
    for (const char of value) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash;
  };

  const hexToRgb = (hex: string) => {
    const normalized = hex.replace("#", "");
    if (normalized.length !== 6) {
      return null;
    }
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
  };

  const rgbToHex = (r: number, g: number, b: number) => {
    const toHex = (value: number) => `${Math.max(0, Math.min(255, value)).toString(16)}`.padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const mixHex = (base: string, overlay: string, weight: number) => {
    const baseRgb = hexToRgb(base);
    const overlayRgb = hexToRgb(overlay);
    if (!baseRgb || !overlayRgb) {
      return base;
    }
    const safeWeight = Math.min(1, Math.max(0, weight));
    const r = Math.round(baseRgb.r * (1 - safeWeight) + overlayRgb.r * safeWeight);
    const g = Math.round(baseRgb.g * (1 - safeWeight) + overlayRgb.g * safeWeight);
    const b = Math.round(baseRgb.b * (1 - safeWeight) + overlayRgb.b * safeWeight);
    return rgbToHex(r, g, b);
  };

  const hexToRgba = (hex: string, alpha: number) => {
    const normalized = hex.replace("#", "");
    if (normalized.length !== 6) {
      return hex;
    }
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const getOwnerTone = (ownerId: string) => {
    const fixed = OWNER_FIXED_COLOR_MAP[ownerId];
    if (fixed) {
      return { dot: fixed };
    }

    if (!hasMultipleIncluded.value) {
      return {
        dot: COMPARE_OWNER_PALETTE[0],
      };
    }
    const knownIndex = studentSchedules.value.findIndex((student) => student.id === ownerId);
    const fallbackIndex = Array.from(ownerId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = knownIndex >= 0 ? knownIndex : fallbackIndex;
    return {
      dot: COMPARE_OWNER_PALETTE[index % COMPARE_OWNER_PALETTE.length],
    };
  };

  const getOwnerDotStyle = (ownerId: string): CSSProperties => {
    const tone = getOwnerTone(ownerId);
    return {
      backgroundColor: tone.dot,
    };
  };

  const getOwnerMarkerStyle = (ownerId: string): CSSProperties => {
    const tone = getOwnerTone(ownerId);
    return {
      backgroundColor: tone.dot,
      borderColor: "var(--card-bg)",
    };
  };

  const getCourseTone = (courseSeed: string, ownerSeed: string) => {
    const accent = THEME_ACCENT_MAP[themeKey.value] || THEME_ACCENT_MAP.black;
    const hashSource = `${courseSeed}::${ownerSeed}`;
    const index = hashString(hashSource) % COURSE_OVERLAY_PALETTE.length;
    return mixHex(accent, COURSE_OVERLAY_PALETTE[index], 0.42);
  };

  const getCourseCardStyle = (course: DisplayCourse): CSSProperties => {
    const tone = getCourseTone(course.name, course.ownerId);
    return {
      borderColor: "var(--line)",
      backgroundColor: hexToRgba(tone, hasMultipleIncluded.value ? 0.12 : 0.18),
      boxShadow: "none",
    };
  };

  const getCellStyle = (cell: GridRowCell): CSSProperties => {
    if (!cell.busy || cell.ownerIds.length === 0) {
      return {};
    }
    if (cell.isOutOfWeek) {
      return {
        backgroundImage: "none",
        backgroundColor: "rgba(128, 128, 128, 0.14)",
      };
    }

    const primaryLabel = cell.labels[0] || "course";
    const ownerSeed = cell.ownerIds.join("|");
    const primary = getCourseTone(primaryLabel, ownerSeed);
    if (cell.labels.length > 1) {
      const secondary = getCourseTone(cell.labels[1], ownerSeed);
      return {
        backgroundImage: `linear-gradient(140deg, ${hexToRgba(primary, 0.21)} 0%, ${hexToRgba(secondary, 0.21)} 100%)`,
        backgroundColor: hexToRgba(primary, 0.19),
      };
    }
    return {
      backgroundImage: "none",
      backgroundColor: hexToRgba(primary, 0.21),
    };
  };

  const getCellTextStyle = (cell: GridRowCell): CSSProperties => {
    if (cell.labelSpan <= 1) {
      return {};
    }
    return {
      top: "0",
      transform: "none",
      height: `calc(${cell.labelSpan} * 100%)`,
    };
  };

  return {
    getOwnerDotStyle,
    getOwnerMarkerStyle,
    getCourseCardStyle,
    getCellStyle,
    getCellTextStyle,
  };
};
