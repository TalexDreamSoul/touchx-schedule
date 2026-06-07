import { miniappEventTones, miniappPageThemes, touchxColors } from "@touchx/ui-tokens";

const lightTheme = touchxColors.light;

type MiniappCssVarStyle = Record<`--${string}`, string>;
type MiniappPageThemeName = keyof typeof miniappPageThemes;

const pageThemeVariableNames = {
  bg: "--bg",
  cardBg: "--card-bg",
  textMain: "--text-main",
  textSub: "--text-sub",
  line: "--line",
  lineStrong: "--line-strong",
  accent: "--accent",
  mutedBg: "--muted-bg",
  timeColBg: "--time-col-bg",
  todayColBg: "--today-col-bg",
  todayHeadBg: "--today-head-bg",
  maskBg: "--mask-bg",
  glowPrimary: "--glow-primary",
  glowSecondary: "--glow-secondary",
} as const;

const toMiniappPageThemeStyle = (themeName: MiniappPageThemeName): MiniappCssVarStyle => {
  const theme = miniappPageThemes[themeName];
  const style: Record<`--${string}`, string> = {};

  Object.entries(pageThemeVariableNames).forEach(([key, variableName]) => {
    style[variableName] = theme[key as keyof typeof theme];
  });

  Object.entries(miniappEventTones).forEach(([eventType, tone]) => {
    style[`--event-${eventType}-color`] = tone.color;
    style[`--event-${eventType}-soft`] = tone.soft;
  });

  return style as MiniappCssVarStyle;
};

export const miniappChromeTheme = {
  navigationBarBackgroundColor: lightTheme.background,
  navigationBarTextStyle: "black" as const,
  backgroundColor: lightTheme.background,
  backgroundTextStyle: "dark" as const,
  tabBarColor: lightTheme.mutedForeground,
  tabBarSelectedColor: lightTheme.primary,
  tabBarBackgroundColor: lightTheme.card,
  tabBarBorderStyle: "black" as const,
};

export const miniappPageThemeStyles = {
  default: toMiniappPageThemeStyle("default"),
  green: toMiniappPageThemeStyle("green"),
  purple: toMiniappPageThemeStyle("purple"),
} as const;
