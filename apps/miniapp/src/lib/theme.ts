import { touchxColors } from "@touchx/ui-tokens";

const lightTheme = touchxColors.light;

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
