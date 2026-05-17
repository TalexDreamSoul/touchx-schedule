import { buildNexusLoginPath, clearNexusSessionToken, getNexusSessionToken } from "../../utils/nexus-auth";

interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

export const useNexusApi = () => {
  const route = useRoute();
  const sessionToken = useState<string>("nexus-admin-session-token", () => "");

  const ensureSessionToken = () => {
    if (!sessionToken.value) {
      sessionToken.value = getNexusSessionToken();
    }
    return sessionToken.value;
  };

  const goToLogin = async () => {
    clearNexusSessionToken();
    sessionToken.value = "";
    await navigateTo(buildNexusLoginPath(route.fullPath), { replace: true });
  };

  const request = async <T = unknown>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}) => {
    const method = options.method || "GET";
    const headers: Record<string, string> = {};
    const token = ensureSessionToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (method === "POST") {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(path, {
      method,
      headers,
      credentials: "omit",
      body: method === "POST" ? JSON.stringify(options.body || {}) : undefined,
    });
    const json = (await response.json()) as ApiEnvelope<T>;
    if (response.status === 401 || String(json?.error?.code || "").includes("AUTH")) {
      await goToLogin();
      throw new Error("登录已失效，请重新登录");
    }
    if (!response.ok || !json.ok) {
      throw new Error(String(json?.error?.message || `HTTP ${response.status}`));
    }
    return json.data as T;
  };

  return {
    sessionToken,
    ensureSessionToken,
    request,
    goToLogin,
  };
};
