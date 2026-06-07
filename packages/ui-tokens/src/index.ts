export const touchxColors = {
  light: {
    background: "#fafafa",
    foreground: "#0a0a0a",
    card: "#ffffff",
    cardForeground: "#0a0a0a",
    popover: "#ffffff",
    popoverForeground: "#0a0a0a",
    primary: "#171717",
    primaryForeground: "#fafafa",
    secondary: "#f5f5f5",
    secondaryForeground: "#171717",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    accent: "#f5f5f5",
    accentForeground: "#171717",
    destructive: "#dc2626",
    destructiveForeground: "#fafafa",
    border: "#e5e5e5",
    input: "#e5e5e5",
    ring: "#171717",
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    card: "#111111",
    cardForeground: "#fafafa",
    popover: "#111111",
    popoverForeground: "#fafafa",
    primary: "#fafafa",
    primaryForeground: "#171717",
    secondary: "#262626",
    secondaryForeground: "#fafafa",
    muted: "#262626",
    mutedForeground: "#a3a3a3",
    accent: "#262626",
    accentForeground: "#fafafa",
    destructive: "#ef4444",
    destructiveForeground: "#fafafa",
    border: "#262626",
    input: "#262626",
    ring: "#d4d4d4",
  },
} as const;

export const touchxRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const touchxSpacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const touchxTypography = {
  fontFamily: {
    sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
    mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  },
  size: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

export const calendarEventColors = {
  course: "#2563eb",
  exam: "#dc2626",
  todo: "#7c3aed",
  activity: "#16a34a",
  holiday: "#f59e0b",
  deadline: "#ea580c",
  custom: "#64748b",
} as const;

export const miniappPageThemes = {
  default: {
    bg: touchxColors.light.background,
    cardBg: touchxColors.light.card,
    textMain: touchxColors.light.foreground,
    textSub: touchxColors.light.mutedForeground,
    line: touchxColors.light.border,
    lineStrong: touchxColors.light.primary,
    accent: calendarEventColors.course,
    mutedBg: touchxColors.light.muted,
    timeColBg: touchxColors.light.muted,
    todayColBg: touchxColors.light.secondary,
    todayHeadBg: touchxColors.light.border,
    maskBg: "rgba(255, 255, 255, 0.72)",
    glowPrimary: "rgba(22, 163, 74, 0.14)",
    glowSecondary: "rgba(37, 99, 235, 0.12)",
  },
  green: {
    bg: "#eef8f2",
    cardBg: "#f9fffb",
    textMain: touchxColors.light.foreground,
    textSub: touchxColors.light.mutedForeground,
    line: "#cde2d6",
    lineStrong: calendarEventColors.activity,
    accent: calendarEventColors.activity,
    mutedBg: "#ebf9f0",
    timeColBg: "#e6f3ea",
    todayColBg: "#e2f8eb",
    todayHeadBg: "#d4f2e0",
    maskBg: "rgba(255, 255, 255, 0.72)",
    glowPrimary: "rgba(22, 163, 74, 0.15)",
    glowSecondary: "rgba(37, 99, 235, 0.10)",
  },
  purple: {
    bg: "#f5f1ff",
    cardBg: "#fcfaff",
    textMain: touchxColors.light.foreground,
    textSub: touchxColors.light.mutedForeground,
    line: "#d9cfef",
    lineStrong: calendarEventColors.todo,
    accent: calendarEventColors.todo,
    mutedBg: "#f5edff",
    timeColBg: "#ede4fb",
    todayColBg: "#f0e4ff",
    todayHeadBg: "#eadbff",
    maskBg: "rgba(255, 255, 255, 0.72)",
    glowPrimary: "rgba(124, 58, 237, 0.14)",
    glowSecondary: "rgba(37, 99, 235, 0.10)",
  },
} as const;

export const miniappEventTones = {
  course: { color: calendarEventColors.course, soft: "#e8edf7" },
  exam: { color: calendarEventColors.exam, soft: "#fff0f0" },
  todo: { color: calendarEventColors.todo, soft: "#f5edff" },
  activity: { color: calendarEventColors.activity, soft: "#ebf9f0" },
  holiday: { color: calendarEventColors.holiday, soft: "#fdf4e0" },
  deadline: { color: calendarEventColors.deadline, soft: "#fdebe0" },
  custom: { color: calendarEventColors.custom, soft: "#eff2f7" },
} as const;

export const iosLiquidGlassTokens = {
  materialBackground: "rgba(255, 255, 255, 0.62)",
  materialBackgroundDark: "rgba(20, 20, 20, 0.58)",
  materialStroke: "rgba(255, 255, 255, 0.34)",
  materialStrokeDark: "rgba(255, 255, 255, 0.12)",
  blurRadius: 28,
  saturation: 1.35,
  shadow: "0 18px 60px rgba(0, 0, 0, 0.18)",
} as const;

export const androidNativeTokens = {
  rippleOpacity: 0.12,
  elevation1: 1,
  elevation2: 3,
  elevation3: 6,
  stateLayerOpacity: 0.08,
} as const;

export type TouchXThemeMode = keyof typeof touchxColors;
