import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";

type ThemeKey = "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";
const STORAGE_THEME_KEY = "touchx_theme_key";

const THEME_KEY_SET = new Set<ThemeKey>(["black", "purple", "green", "pink", "blue", "yellow", "orange"]);

const isThemeKey = (value: unknown): value is ThemeKey => {
  return THEME_KEY_SET.has(value as ThemeKey);
};

export const usePartyGameTheme = () => {
  const themeKey = ref<ThemeKey>("black");

  const syncThemeKey = () => {
    const value = String(uni.getStorageSync(STORAGE_THEME_KEY) || "").trim();
    if (isThemeKey(value)) {
      themeKey.value = value;
      return;
    }
    themeKey.value = "black";
  };

  onShow(() => {
    syncThemeKey();
  });

  syncThemeKey();

  return {
    themeKey,
  };
};
