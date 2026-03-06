import { studentSchedules } from "@/data/schedules";

export interface AuthUserProfile {
  openId: string;
  studentId: string;
  studentName: string;
  classLabel?: string;
  nickname: string;
  avatarUrl: string;
}

export interface AuthSessionState {
  token: string;
  expiresAt: number;
  mode: "none" | "wechat" | "mock";
  user: AuthUserProfile | null;
}

export interface BackendErrorPayload {
  detail?: string;
  message?: string;
}

export interface BackendRequestError extends Error {
  statusCode?: number;
}

export const STORAGE_SELECTED_STUDENT_KEY = "touchx_v2_selected_student_id";
export const STORAGE_BACKEND_BASE_URL_KEY = "touchx_v2_backend_base_url";
export const STORAGE_BACKEND_ENDPOINT_MODE_KEY = "touchx_v2_backend_endpoint_mode";
export const STORAGE_AUTH_TOKEN_KEY = "touchx_v2_auth_token";
export const STORAGE_AUTH_EXPIRES_AT_KEY = "touchx_v2_auth_expires_at";
export const STORAGE_AUTH_USER_KEY = "touchx_v2_auth_user";
export const STORAGE_AUTH_MODE_KEY = "touchx_v2_auth_mode";
export const STORAGE_SHOW_NON_CURRENT_WEEK_COURSES_KEY = "touchx_show_non_current_week_courses";
export const STORAGE_THEME_KEY = "touchx_theme_key";
export const STORAGE_PURPLE_UNLOCKED_KEY = "touchx_theme_purple_unlocked";
export const STORAGE_THEME_WALLPAPER_ENABLED_KEY = "touchx_theme_wallpaper_enabled";
export const STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY = "touchx_theme_wallpaper_blur_enabled";
export const STORAGE_THEME_WALLPAPER_EFFECT_LEVEL_KEY = "touchx_theme_wallpaper_effect_level";
export const STORAGE_SCHEDULE_CACHE_TIME_KEY = "touchx_v2_schedule_cache_at";
export const STORAGE_SCHEDULE_CACHE_SOURCE_KEY = "touchx_v2_schedule_cache_source";
export const STORAGE_PREFERENCES_WALLPAPER_PATH_KEY = "touchx_v2_preferences_wallpaper_path";

export type BackendEndpointMode = "local" | "online";

export const LOCAL_BACKEND_BASE_URL = String(import.meta.env.VITE_LOCAL_BACKEND_BASE_URL || "http://127.0.0.1:9986").trim();
export const ONLINE_BACKEND_BASE_URL = String(import.meta.env.VITE_ONLINE_BACKEND_BASE_URL || "https://schedule-ends.tagzxia.com").trim();
type MiniProgramEnvVersion = "develop" | "trial" | "release" | "unknown";

export const resolveMiniProgramEnvVersion = (): MiniProgramEnvVersion => {
  const wxApi = (globalThis as {
    wx?: {
      getAccountInfoSync?: () => { miniProgram?: { envVersion?: string } };
    };
  }).wx;
  if (!wxApi || typeof wxApi.getAccountInfoSync !== "function") {
    return "unknown";
  }
  try {
    const envVersion = String(wxApi.getAccountInfoSync()?.miniProgram?.envVersion || "").trim();
    if (envVersion === "develop" || envVersion === "trial" || envVersion === "release") {
      return envVersion;
    }
  } catch (error) {
    return "unknown";
  }
  return "unknown";
};

export const resolveBackendRuntimeDefaultMode = (): BackendEndpointMode => {
  return resolveMiniProgramEnvVersion() === "develop" ? "local" : "online";
};

export const normalizeBackendBaseUrl = (value: string) => {
  const normalized = (value || "").trim().replace(/\/+$/, "");
  return normalized || getBackendBaseUrlByMode(resolveBackendRuntimeDefaultMode());
};

export const resolveBackendMediaUrl = (baseUrl: string, rawUrl: string) => {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }
  const normalizedBase = normalizeBackendBaseUrl(baseUrl);
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const pathname = String(parsed.pathname || "").trim();
      const search = String(parsed.search || "");
      if (pathname.startsWith("/api/media/")) {
        return `${normalizedBase}${pathname}${search}`;
      }
      return value;
    } catch (error) {
      return "";
    }
  }
  if (!value.startsWith("/")) {
    return "";
  }
  return `${normalizedBase}${value}`;
};

export const getBackendBaseUrlByMode = (mode: BackendEndpointMode) => {
  return mode === "online" ? ONLINE_BACKEND_BASE_URL : LOCAL_BACKEND_BASE_URL;
};

export const inferBackendEndpointModeByUrl = (url: string): BackendEndpointMode => {
  const normalized = normalizeBackendBaseUrl(url);
  if (normalized === normalizeBackendBaseUrl(ONLINE_BACKEND_BASE_URL)) {
    return "online";
  }
  return "local";
};

export const resolveBackendBaseUrlFromStorage = () => {
  if (resolveBackendRuntimeDefaultMode() !== "local") {
    return normalizeBackendBaseUrl(ONLINE_BACKEND_BASE_URL);
  }
  const savedMode = String(uni.getStorageSync(STORAGE_BACKEND_ENDPOINT_MODE_KEY) || "").trim();
  const legacyUrl = String(uni.getStorageSync(STORAGE_BACKEND_BASE_URL_KEY) || "").trim();
  const mode: BackendEndpointMode =
    savedMode === "local" || savedMode === "online"
      ? (savedMode as BackendEndpointMode)
      : inferBackendEndpointModeByUrl(legacyUrl || LOCAL_BACKEND_BASE_URL);
  return normalizeBackendBaseUrl(getBackendBaseUrlByMode(mode));
};

export const parseBackendErrorMessage = (statusCode: number, data: unknown) => {
  const payload = (data || {}) as BackendErrorPayload;
  const detail = typeof payload.detail === "string" && payload.detail.trim() ? payload.detail.trim() : "";
  const message = typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "";
  if (detail) {
    return detail;
  }
  if (message) {
    return message;
  }
  return `HTTP ${statusCode}`;
};

const buildBackendRequestError = (message: string, statusCode = 0): BackendRequestError => {
  const error = new Error(message) as BackendRequestError;
  if (statusCode > 0) {
    error.statusCode = statusCode;
  }
  return error;
};

export const isAuthSessionInvalidError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }
  const backendError = error as BackendRequestError;
  if (Number(backendError.statusCode || 0) === 401) {
    return true;
  }
  const message = String(error.message || "").trim();
  if (!message) {
    return false;
  }
  return message.includes("未登录或登录已失效") || message.includes("登录状态异常");
};

const REQUEST_TIMEOUT = 12000;

const parseRequestFailMessage = (errMsg: unknown) => {
  const text = String(errMsg || "").trim();
  if (!text) {
    return "请求失败";
  }
  if (/timeout/i.test(text)) {
    return "网络请求超时，请稍后重试";
  }
  return text;
};

const buildBackendUrl = (baseUrl: string, path: string, query: Record<string, string> = {}) => {
  const base = normalizeBackendBaseUrl(baseUrl);
  const search = Object.entries(query)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}${path}${search ? `?${search}` : ""}`;
};

export const requestBackendGet = <T>(baseUrl: string, path: string, query: Record<string, string> = {}, token = "") => {
  return new Promise<T>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    uni.request({
      url: buildBackendUrl(baseUrl, path, query),
      method: "GET",
      timeout: REQUEST_TIMEOUT,
      header: headers,
      success: (res) => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode >= 200 && statusCode < 300) {
          resolve((res.data || {}) as T);
          return;
        }
        reject(buildBackendRequestError(parseBackendErrorMessage(statusCode, res.data), statusCode));
      },
      fail: (err) => {
        reject(new Error(parseRequestFailMessage(err?.errMsg)));
      },
    });
  });
};

export const requestBackendPost = <T>(
  baseUrl: string,
  path: string,
  data: Record<string, unknown>,
  token = "",
) => {
  return new Promise<T>((resolve, reject) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    uni.request({
      url: buildBackendUrl(baseUrl, path),
      method: "POST",
      timeout: REQUEST_TIMEOUT,
      data,
      header: headers,
      success: (res) => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode >= 200 && statusCode < 300) {
          resolve((res.data || {}) as T);
          return;
        }
        reject(buildBackendRequestError(parseBackendErrorMessage(statusCode, res.data), statusCode));
      },
      fail: (err) => {
        reject(new Error(parseRequestFailMessage(err?.errMsg)));
      },
    });
  });
};

export const uploadBackendImage = <T>(
  baseUrl: string,
  path: string,
  filePath: string,
  token = "",
) => {
  return new Promise<T>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    uni.uploadFile({
      url: buildBackendUrl(baseUrl, path),
      filePath,
      name: "file",
      timeout: 15000,
      header: headers,
      success: (res) => {
        const statusCode = Number(res.statusCode || 0);
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(String(res.data || "{}")) as Record<string, unknown>;
        } catch (error) {
          payload = {};
        }
        if (statusCode >= 200 && statusCode < 300) {
          resolve(payload as T);
          return;
        }
        reject(buildBackendRequestError(parseBackendErrorMessage(statusCode, payload), statusCode));
      },
      fail: (err) => {
        reject(new Error(err?.errMsg || "upload failed"));
      },
    });
  });
};

const parseStoredAuthUser = (raw: unknown): AuthUserProfile | null => {
  if (!raw) {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return parseStoredAuthUser(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }
  if (typeof raw !== "object") {
    return null;
  }
  const data = raw as Partial<AuthUserProfile>;
  if (!data.openId) {
    return null;
  }
  return {
    openId: String(data.openId),
    studentId: String(data.studentId || ""),
    studentName: String(data.studentName || ""),
    classLabel: String(data.classLabel || ""),
    nickname: String(data.nickname || ""),
    avatarUrl: String(data.avatarUrl || ""),
  };
};

export const readAuthSessionFromStorage = (): AuthSessionState => {
  const token = String(uni.getStorageSync(STORAGE_AUTH_TOKEN_KEY) || "").trim();
  const expiresAt = Number(uni.getStorageSync(STORAGE_AUTH_EXPIRES_AT_KEY) || 0);
  const mode = String(uni.getStorageSync(STORAGE_AUTH_MODE_KEY) || "").trim();
  const user = parseStoredAuthUser(uni.getStorageSync(STORAGE_AUTH_USER_KEY));
  if (!token || !user || expiresAt <= 0) {
    return {
      token: "",
      expiresAt: 0,
      mode: "none",
      user: null,
    };
  }
  return {
    token,
    expiresAt,
    mode: mode === "wechat" ? "wechat" : "mock",
    user,
  };
};

export const guardProfilePageAccess = () => {
  const session = readAuthSessionFromStorage();
  if (session.token && session.user) {
    return true;
  }
  uni.showToast({ title: "请先登录授权", icon: "none", duration: 1600 });
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
    return false;
  }
  uni.reLaunch({ url: "/pages/index/index" });
  return false;
};

export const clearAuthSessionStorage = () => {
  uni.removeStorageSync(STORAGE_AUTH_TOKEN_KEY);
  uni.removeStorageSync(STORAGE_AUTH_EXPIRES_AT_KEY);
  uni.removeStorageSync(STORAGE_AUTH_USER_KEY);
  uni.removeStorageSync(STORAGE_AUTH_MODE_KEY);
};

export const persistAuthSessionToStorage = (session: {
  token: string;
  expiresAt: number;
  mode: "wechat" | "mock";
  user: AuthUserProfile;
}) => {
  uni.setStorageSync(STORAGE_AUTH_TOKEN_KEY, session.token);
  uni.setStorageSync(STORAGE_AUTH_EXPIRES_AT_KEY, Number(session.expiresAt || 0));
  uni.setStorageSync(STORAGE_AUTH_USER_KEY, JSON.stringify(session.user));
  uni.setStorageSync(STORAGE_AUTH_MODE_KEY, session.mode);
};

export const resolveClientPlatform = () => {
  const wxApi = (globalThis as { wx?: Record<string, (...args: any[]) => any> }).wx;
  if (wxApi) {
    try {
      if (typeof wxApi.getAppBaseInfo === "function") {
        const appBaseInfo = wxApi.getAppBaseInfo() as { platform?: string };
        const platform = String(appBaseInfo?.platform || "").trim();
        if (platform) {
          return platform;
        }
      }
      if (typeof wxApi.getDeviceInfo === "function") {
        const deviceInfo = wxApi.getDeviceInfo() as { platform?: string };
        const platform = String(deviceInfo?.platform || "").trim();
        if (platform) {
          return platform;
        }
      }
    } catch (error) {
      // noop
    }
  }
  try {
    const systemInfo = uni.getSystemInfoSync() as { uniPlatform?: string; platform?: string };
    const platform = String(systemInfo.uniPlatform || systemInfo.platform || "").trim();
    if (platform) {
      return platform;
    }
  } catch (error) {
    // noop
  }
  return "unknown";
};

export const fetchMiniProgramCode = () => {
  return new Promise<string>((resolve, reject) => {
    uni.login({
      provider: "weixin",
      success: (res) => {
        const code = String(res.code || "").trim();
        if (!code) {
          reject(new Error("微信登录 code 为空"));
          return;
        }
        resolve(code);
      },
      fail: (error) => {
        const platform = resolveClientPlatform();
        if (platform !== "mp-weixin") {
          resolve(`dev-${Date.now()}`);
          return;
        }
        reject(new Error(error?.errMsg || "微信登录失败"));
      },
    });
  });
};

export const tryGetWechatProfile = () => {
  return new Promise<{ nickname?: string; avatarUrl?: string }>((resolve) => {
    const uniAny = uni as unknown as {
      getUserProfile?: (options: {
        desc: string;
        success: (result: { userInfo?: { nickName?: string; avatarUrl?: string } }) => void;
        fail: () => void;
      }) => void;
    };
    if (typeof uniAny.getUserProfile !== "function") {
      resolve({});
      return;
    }
    uniAny.getUserProfile({
      desc: "用于完善课程提醒授权信息",
      success: (result) => {
        const profile = (result.userInfo || {}) as { nickName?: string; avatarUrl?: string };
        resolve({
          nickname: profile.nickName || "",
          avatarUrl: profile.avatarUrl || "",
        });
      },
      fail: () => {
        resolve({});
      },
    });
  });
};

export const resolveStudentIdByStudentNo = (studentNo: string) => {
  const normalized = String(studentNo || "").trim();
  if (!normalized) {
    return "";
  }
  const matched = studentSchedules.find((item) => String(item.studentNo || "").trim() === normalized);
  return matched?.id || "";
};

export const readLocalWallpaperPath = () => {
  return String(uni.getStorageSync(STORAGE_PREFERENCES_WALLPAPER_PATH_KEY) || "").trim();
};

export const saveLocalWallpaperPath = (path: string) => {
  const normalized = String(path || "").trim();
  if (!normalized) {
    uni.removeStorageSync(STORAGE_PREFERENCES_WALLPAPER_PATH_KEY);
    return;
  }
  uni.setStorageSync(STORAGE_PREFERENCES_WALLPAPER_PATH_KEY, normalized);
};
