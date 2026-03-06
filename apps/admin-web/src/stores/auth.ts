import { defineStore } from "pinia";
import { ref } from "vue";
import { apiPost } from "../api";

interface AdminLoginResponse {
  ok: boolean;
  expiresAt: number;
  sessionToken: string;
}

const STORAGE_KEY = "touchx_admin_v1_logged_in";

export const useAuthStore = defineStore("admin-auth", () => {
  const loggedIn = ref(Boolean(localStorage.getItem(STORAGE_KEY)));
  const expiresAt = ref(0);

  const login = async (token: string) => {
    const data = await apiPost<AdminLoginResponse>("/api/admin/login", { token });
    loggedIn.value = Boolean(data.ok);
    expiresAt.value = Number(data.expiresAt || 0);
    if (loggedIn.value) {
      localStorage.setItem(STORAGE_KEY, "1");
    }
  };

  const logout = async () => {
    await apiPost<{ ok: boolean }>("/api/admin/logout", {});
    loggedIn.value = false;
    expiresAt.value = 0;
    localStorage.removeItem(STORAGE_KEY);
  };

  const markLoggedOut = () => {
    loggedIn.value = false;
    expiresAt.value = 0;
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    loggedIn,
    expiresAt,
    login,
    logout,
    markLoggedOut,
  };
});
