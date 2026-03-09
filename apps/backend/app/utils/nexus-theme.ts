export type NexusThemeMode = "dark" | "light";

export const NEXUS_THEME_STORAGE_KEY = "touchx_nexus_theme_v1";

const normalizeTheme = (value: unknown): NexusThemeMode | "" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dark" || normalized === "light") {
    return normalized;
  }
  return "";
};

export const getPreferredNexusTheme = (): NexusThemeMode => {
  if (!import.meta.client) {
    return "dark";
  }
  const stored = normalizeTheme(localStorage.getItem(NEXUS_THEME_STORAGE_KEY));
  if (stored) {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

export const setNexusTheme = (theme: NexusThemeMode) => {
  if (!import.meta.client) {
    return;
  }
  localStorage.setItem(NEXUS_THEME_STORAGE_KEY, theme);
};
