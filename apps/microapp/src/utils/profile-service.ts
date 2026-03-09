import { studentSchedules } from "@/data/schedules";
import {
  normalizeBackendApiPath,
  resolveBackendErrorMessageFromPayload,
  unwrapBackendApiPayload,
} from "@/utils/backend-request";

export interface AuthUserProfile {
  openId?: string;
  studentId: string;
  studentNo?: string;
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
export const STORAGE_LAST_BACKEND_TRACE_KEY = "touchx_v2_last_backend_trace";
export const CLIENT_BUILD_TAG = "2026-03-09.7";

export type BackendEndpointMode = "local" | "online";
export interface BackendRequestTrace {
  method: "GET" | "POST" | "UPLOAD";
  url: string;
  statusCode: number;
  ok: boolean;
  errorMessage: string;
  at: number;
}

type MiniProgramEnvVersion = "develop" | "trial" | "release" | "unknown";
const PROD_ONLINE_BACKEND_BASE_URL = "https://schedule-backend.tagzxia.com";

export const ONLINE_BACKEND_BASE_URL = PROD_ONLINE_BACKEND_BASE_URL;
export const LOCAL_BACKEND_BASE_URL = ONLINE_BACKEND_BASE_URL;

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
  return "online";
};

const normalizeRawBackendBaseUrl = (value: string) => {
  return String(value || "").trim().replace(/\/+$/, "");
};

export const normalizeBackendBaseUrl = (value: string) => {
  if (resolveBackendRuntimeDefaultMode() !== "local") {
    return normalizeRawBackendBaseUrl(ONLINE_BACKEND_BASE_URL);
  }
  const normalized = normalizeRawBackendBaseUrl(value);
  return normalized || normalizeRawBackendBaseUrl(LOCAL_BACKEND_BASE_URL);
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

export const enforceBackendEndpointStorage = (preferredMode?: BackendEndpointMode) => {
  const runtimeDefaultMode = resolveBackendRuntimeDefaultMode();
  if (runtimeDefaultMode !== "local") {
    const baseUrl = normalizeBackendBaseUrl(ONLINE_BACKEND_BASE_URL);
    try {
      uni.setStorageSync(STORAGE_BACKEND_ENDPOINT_MODE_KEY, "online");
      uni.setStorageSync(STORAGE_BACKEND_BASE_URL_KEY, baseUrl);
    } catch (error) {
      // noop
    }
    return {
      mode: "online" as BackendEndpointMode,
      baseUrl,
    };
  }
  const savedMode = String(uni.getStorageSync(STORAGE_BACKEND_ENDPOINT_MODE_KEY) || "").trim();
  const legacyUrl = String(uni.getStorageSync(STORAGE_BACKEND_BASE_URL_KEY) || "").trim();
  let mode: BackendEndpointMode;
  if (preferredMode === "local" || preferredMode === "online") {
    mode = preferredMode;
  } else if (savedMode === "local" || savedMode === "online") {
    mode = savedMode as BackendEndpointMode;
  } else {
    mode = inferBackendEndpointModeByUrl(legacyUrl || LOCAL_BACKEND_BASE_URL);
  }
  const baseUrl = normalizeBackendBaseUrl(getBackendBaseUrlByMode(mode));
  try {
    uni.setStorageSync(STORAGE_BACKEND_ENDPOINT_MODE_KEY, mode);
    uni.setStorageSync(STORAGE_BACKEND_BASE_URL_KEY, baseUrl);
  } catch (error) {
    // noop
  }
  return {
    mode,
    baseUrl,
  };
};

export const resolveBackendBaseUrlFromStorage = () => {
  return enforceBackendEndpointStorage().baseUrl;
};

export const persistBackendRequestTrace = (trace: BackendRequestTrace) => {
  try {
    uni.setStorageSync(STORAGE_LAST_BACKEND_TRACE_KEY, JSON.stringify(trace));
  } catch (error) {
    // noop
  }
};

export const readLastBackendRequestTrace = (): BackendRequestTrace | null => {
  const raw = uni.getStorageSync(STORAGE_LAST_BACKEND_TRACE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const methodRaw = String((payload as Record<string, unknown>).method || "").toUpperCase();
    if (methodRaw !== "GET" && methodRaw !== "POST" && methodRaw !== "UPLOAD") {
      return null;
    }
    const url = String((payload as Record<string, unknown>).url || "").trim();
    if (!url) {
      return null;
    }
    return {
      method: methodRaw as BackendRequestTrace["method"],
      url,
      statusCode: Number((payload as Record<string, unknown>).statusCode || 0),
      ok: Boolean((payload as Record<string, unknown>).ok),
      errorMessage: String((payload as Record<string, unknown>).errorMessage || "").trim(),
      at: Number((payload as Record<string, unknown>).at || 0),
    };
  } catch (error) {
    return null;
  }
};

export const parseBackendErrorMessage = (statusCode: number, data: unknown) => {
  return resolveBackendErrorMessageFromPayload(statusCode, data);
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

const attachRequestUrlToMessage = (message: string, requestUrl: string) => {
  const url = String(requestUrl || "").trim();
  if (!url) {
    return message;
  }
  return `${message}（${url}）`;
};

const buildBackendUrl = (baseUrl: string, path: string, query: Record<string, string> = {}) => {
  const base = normalizeBackendBaseUrl(baseUrl);
  const normalizedPath = normalizeBackendApiPath(path);
  const search = Object.entries(query)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}${normalizedPath}${search ? `?${search}` : ""}`;
};

export const requestBackendGet = <T>(baseUrl: string, path: string, query: Record<string, string> = {}, token = "") => {
  return new Promise<T>((resolve, reject) => {
    const requestUrl = buildBackendUrl(baseUrl, path, query);
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    uni.request({
      url: requestUrl,
      method: "GET",
      timeout: REQUEST_TIMEOUT,
      header: headers,
      success: (res) => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode >= 200 && statusCode < 300) {
          try {
            resolve(unwrapBackendApiPayload<T>(res.data || {}));
          } catch (error) {
            const message = error instanceof Error ? error.message : "请求失败";
            persistBackendRequestTrace({
              method: "GET",
              url: requestUrl,
              statusCode,
              ok: false,
              errorMessage: message,
              at: Date.now(),
            });
            reject(buildBackendRequestError(message, statusCode));
            return;
          }
          persistBackendRequestTrace({
            method: "GET",
            url: requestUrl,
            statusCode,
            ok: true,
            errorMessage: "",
            at: Date.now(),
          });
          return;
        }
        const message = attachRequestUrlToMessage(parseBackendErrorMessage(statusCode, res.data), requestUrl);
        persistBackendRequestTrace({
          method: "GET",
          url: requestUrl,
          statusCode,
          ok: false,
          errorMessage: message,
          at: Date.now(),
        });
        reject(buildBackendRequestError(message, statusCode));
      },
      fail: (err) => {
        const message = attachRequestUrlToMessage(parseRequestFailMessage(err?.errMsg), requestUrl);
        persistBackendRequestTrace({
          method: "GET",
          url: requestUrl,
          statusCode: 0,
          ok: false,
          errorMessage: message,
          at: Date.now(),
        });
        reject(new Error(message));
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
    const requestUrl = buildBackendUrl(baseUrl, path);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    uni.request({
      url: requestUrl,
      method: "POST",
      timeout: REQUEST_TIMEOUT,
      data,
      header: headers,
      success: (res) => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode >= 200 && statusCode < 300) {
          try {
            resolve(unwrapBackendApiPayload<T>(res.data || {}));
          } catch (error) {
            const message = error instanceof Error ? error.message : "请求失败";
            persistBackendRequestTrace({
              method: "POST",
              url: requestUrl,
              statusCode,
              ok: false,
              errorMessage: message,
              at: Date.now(),
            });
            reject(buildBackendRequestError(message, statusCode));
            return;
          }
          persistBackendRequestTrace({
            method: "POST",
            url: requestUrl,
            statusCode,
            ok: true,
            errorMessage: "",
            at: Date.now(),
          });
          return;
        }
        const message = attachRequestUrlToMessage(parseBackendErrorMessage(statusCode, res.data), requestUrl);
        persistBackendRequestTrace({
          method: "POST",
          url: requestUrl,
          statusCode,
          ok: false,
          errorMessage: message,
          at: Date.now(),
        });
        reject(buildBackendRequestError(message, statusCode));
      },
      fail: (err) => {
        const message = attachRequestUrlToMessage(parseRequestFailMessage(err?.errMsg), requestUrl);
        persistBackendRequestTrace({
          method: "POST",
          url: requestUrl,
          statusCode: 0,
          ok: false,
          errorMessage: message,
          at: Date.now(),
        });
        reject(new Error(message));
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
    const requestUrl = buildBackendUrl(baseUrl, path);
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    uni.uploadFile({
      url: requestUrl,
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
          try {
            resolve(unwrapBackendApiPayload<T>(payload));
          } catch (error) {
            const message = error instanceof Error ? error.message : "上传失败";
            persistBackendRequestTrace({
              method: "UPLOAD",
              url: requestUrl,
              statusCode,
              ok: false,
              errorMessage: message,
              at: Date.now(),
            });
            reject(buildBackendRequestError(message, statusCode));
            return;
          }
          persistBackendRequestTrace({
            method: "UPLOAD",
            url: requestUrl,
            statusCode,
            ok: true,
            errorMessage: "",
            at: Date.now(),
          });
          return;
        }
        const message = attachRequestUrlToMessage(parseBackendErrorMessage(statusCode, payload), requestUrl);
        persistBackendRequestTrace({
          method: "UPLOAD",
          url: requestUrl,
          statusCode,
          ok: false,
          errorMessage: message,
          at: Date.now(),
        });
        reject(buildBackendRequestError(message, statusCode));
      },
      fail: (err) => {
        const message = attachRequestUrlToMessage(String(err?.errMsg || "upload failed"), requestUrl);
        persistBackendRequestTrace({
          method: "UPLOAD",
          url: requestUrl,
          statusCode: 0,
          ok: false,
          errorMessage: message,
          at: Date.now(),
        });
        reject(new Error(message));
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
  const studentId = String(data.studentId || "").trim();
  const studentNo = String(data.studentNo || "").trim();
  if (!studentId && !studentNo) {
    return null;
  }
  const openId = String(data.openId || "").trim() || `wx_${studentNo || studentId}`;
  const studentName = String(data.studentName || "").trim() || studentNo || studentId;
  return {
    openId,
    studentId,
    studentNo,
    studentName,
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
