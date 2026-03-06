import type { ComputedRef, Ref } from "vue";

type BackendEndpointMode = "local" | "online";
type MaybeRefString = Ref<string> | ComputedRef<string>;
interface BackendRequestError extends Error {
  statusCode?: number;
}

interface UseBackendApiOptions {
  backendBaseUrl: Ref<string>;
  backendEndpointMode: Ref<BackendEndpointMode>;
  authToken: MaybeRefString;
  defaultBackendBaseUrl: string;
  localBackendBaseUrl: string;
  onlineBackendBaseUrl: string;
  storageBackendEndpointModeKey: string;
  storageBackendBaseUrlKey: string;
}

export const useBackendApi = ({
  backendBaseUrl,
  backendEndpointMode,
  authToken,
  defaultBackendBaseUrl,
  localBackendBaseUrl,
  onlineBackendBaseUrl,
  storageBackendEndpointModeKey,
  storageBackendBaseUrlKey,
}: UseBackendApiOptions) => {
  const REQUEST_TIMEOUT = 12000;

  const normalizeBackendBaseUrl = (value: string) => {
    const normalized = (value || "").trim().replace(/\/+$/, "");
    return normalized || defaultBackendBaseUrl;
  };

  const getBackendBaseUrlByMode = (mode: BackendEndpointMode) => {
    return mode === "online" ? onlineBackendBaseUrl : localBackendBaseUrl;
  };

  const inferBackendEndpointModeByUrl = (url: string): BackendEndpointMode => {
    const normalized = normalizeBackendBaseUrl(url);
    if (normalized === normalizeBackendBaseUrl(onlineBackendBaseUrl)) {
      return "online";
    }
    return "local";
  };

  const applyBackendEndpointMode = (mode: BackendEndpointMode, persist = true) => {
    backendEndpointMode.value = mode;
    backendBaseUrl.value = getBackendBaseUrlByMode(mode);
    if (persist) {
      uni.setStorageSync(storageBackendEndpointModeKey, mode);
      uni.setStorageSync(storageBackendBaseUrlKey, backendBaseUrl.value);
    }
  };

  const buildBackendUrl = (path: string, query: Record<string, string> = {}) => {
    const base = normalizeBackendBaseUrl(backendBaseUrl.value);
    const search = Object.entries(query)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${base}${path}${search ? `?${search}` : ""}`;
  };

  const parseBackendErrorMessage = (statusCode: number, data: unknown) => {
    const payload = (data || {}) as { detail?: string; message?: string };
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

  const getAuthRequestHeaders = (withAuth: boolean) => {
    const headers: Record<string, string> = {};
    if (!withAuth) {
      return headers;
    }
    if (!authToken.value) {
      throw new Error("AUTH_REQUIRED");
    }
    headers.Authorization = `Bearer ${authToken.value}`;
    return headers;
  };

  const requestBackendGet = <T>(path: string, query: Record<string, string> = {}, withAuth = false) => {
    return new Promise<T>((resolve, reject) => {
      let headers: Record<string, string> = {};
      try {
        headers = getAuthRequestHeaders(withAuth);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("AUTH_REQUIRED"));
        return;
      }
      uni.request({
        url: buildBackendUrl(path, query),
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

  const requestBackendPost = <T>(path: string, data: Record<string, unknown>, withAuth = false) => {
    return new Promise<T>((resolve, reject) => {
      let headers: Record<string, string> = {};
      try {
        headers = {
          "content-type": "application/json",
          ...getAuthRequestHeaders(withAuth),
        };
      } catch (error) {
        reject(error instanceof Error ? error : new Error("AUTH_REQUIRED"));
        return;
      }
      uni.request({
        url: buildBackendUrl(path),
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

  return {
    inferBackendEndpointModeByUrl,
    applyBackendEndpointMode,
    requestBackendGet,
    requestBackendPost,
  };
};
