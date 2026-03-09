import type { ComputedRef, Ref } from "vue";
import {
  normalizeBackendApiPath,
  resolveBackendErrorMessageFromPayload,
  unwrapBackendApiPayload,
} from "@/utils/backend-request";
import { persistBackendRequestTrace, resolveBackendRuntimeDefaultMode } from "@/utils/profile-service";

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
  const runtimeDefaultMode = resolveBackendRuntimeDefaultMode();

  const normalizeBackendBaseUrl = (value: string) => {
    const normalized = (value || "").trim().replace(/\/+$/, "");
    if (runtimeDefaultMode !== "local") {
      return (onlineBackendBaseUrl || "").trim().replace(/\/+$/, "");
    }
    return normalized || defaultBackendBaseUrl;
  };

  const getBackendBaseUrlByMode = (mode: BackendEndpointMode) => {
    if (runtimeDefaultMode !== "local") {
      return onlineBackendBaseUrl;
    }
    return mode === "online" ? onlineBackendBaseUrl : localBackendBaseUrl;
  };

  const inferBackendEndpointModeByUrl = (url: string): BackendEndpointMode => {
    if (runtimeDefaultMode !== "local") {
      return "online";
    }
    const normalized = normalizeBackendBaseUrl(url);
    if (normalized === normalizeBackendBaseUrl(onlineBackendBaseUrl)) {
      return "online";
    }
    return "local";
  };

  const applyBackendEndpointMode = (mode: BackendEndpointMode, persist = true) => {
    const nextMode: BackendEndpointMode = runtimeDefaultMode === "local" ? mode : "online";
    backendEndpointMode.value = nextMode;
    backendBaseUrl.value = getBackendBaseUrlByMode(nextMode);
    if (persist) {
      uni.setStorageSync(storageBackendEndpointModeKey, nextMode);
      uni.setStorageSync(storageBackendBaseUrlKey, backendBaseUrl.value);
    }
  };

  const buildBackendUrl = (path: string, query: Record<string, string> = {}) => {
    const base = normalizeBackendBaseUrl(backendBaseUrl.value);
    const normalizedPath = normalizeBackendApiPath(path);
    const search = Object.entries(query)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${base}${normalizedPath}${search ? `?${search}` : ""}`;
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

  const attachRequestUrlToMessage = (message: string, requestUrl: string) => {
    const url = String(requestUrl || "").trim();
    if (!url) {
      return message;
    }
    return `${message}（${url}）`;
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
      const requestUrl = buildBackendUrl(path, query);
      let headers: Record<string, string> = {};
      try {
        headers = getAuthRequestHeaders(withAuth);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("AUTH_REQUIRED"));
        return;
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
          const message = attachRequestUrlToMessage(resolveBackendErrorMessageFromPayload(statusCode, res.data), requestUrl);
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

  const requestBackendPost = <T>(path: string, data: Record<string, unknown>, withAuth = false) => {
    return new Promise<T>((resolve, reject) => {
      const requestUrl = buildBackendUrl(path);
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
          const message = attachRequestUrlToMessage(resolveBackendErrorMessageFromPayload(statusCode, res.data), requestUrl);
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

  return {
    inferBackendEndpointModeByUrl,
    applyBackendEndpointMode,
    requestBackendGet,
    requestBackendPost,
  };
};
