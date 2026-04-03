import { computed, ref } from "vue";
import {
  clearAuthSessionStorage,
  fetchMiniProgramCode,
  isAuthSessionInvalidError,
  uploadBackendImage,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveStudentIdByStudentNo,
  resolveBackendBaseUrlFromStorage,
  resolveBackendMediaUrl,
  resolveClientPlatform,
  persistAuthSessionToStorage,
  tryGetWechatProfile,
  type AuthSessionState,
} from "@/utils/profile-service";
import { useSocialDashboard, type SocialDashboardResponse, type SocialUserItem } from "@/composables/useSocialDashboard";

interface AuthUserProfile {
  openId?: string;
  studentId: string;
  studentNo?: string;
  studentName: string;
  classLabel?: string;
  nickname: string;
  avatarUrl: string;
}

interface BackendAuthLoginResponse {
  token?: string;
  expiresAt?: number;
  mode?: "wechat" | "mock";
  user?: AuthUserProfile;
}

interface BackendAuthMeResponse {
  mode?: "wechat" | "mock";
  expiresAt?: number;
  user?: AuthUserProfile;
}

interface UploadImageResponse {
  avatarUrl?: string;
  me?: SocialUserItem;
}

interface UpdateRandomCodeResponse {
  removedSubscriberCount?: number;
}

const resolveActionErrorMessage = (error: unknown, fallback: string) => {
  const rawMessage = error instanceof Error ? String(error.message || "").trim() : "";
  if (!rawMessage) {
    return fallback;
  }
  const urlSuffix = rawMessage.match(/（https?:\/\/[^）]+）/)?.[0] || "";
  if (/timeout/i.test(rawMessage)) {
    return `网络请求超时，请稍后重试${urlSuffix}`;
  }
  if (/request:fail/i.test(rawMessage)) {
    return `网络请求失败，请检查网络或后端地址${urlSuffix}`;
  }
  return rawMessage;
};

const getLocalFileSize = (filePath: string) => {
  return new Promise<number>((resolve) => {
    uni.getFileInfo({
      filePath,
      success: (result) => {
        resolve(Number(result.size || 0));
      },
      fail: () => {
        resolve(0);
      },
    });
  });
};

const chooseSingleImage = () => {
  return new Promise<string>((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const filePath = String(result.tempFilePaths?.[0] || "").trim();
        if (!filePath) {
          reject(new Error("未选择图片"));
          return;
        }
        resolve(filePath);
      },
      fail: (error) => {
        reject(new Error(error?.errMsg || "选择图片失败"));
      },
    });
  });
};

const normalizeStudentNoInput = (value: unknown) => {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(0, 32);
};

const promptStudentNoInput = () => {
  return new Promise<string | null>((resolve) => {
    uni.showModal({
      title: "请输入学号",
      content: "",
      editable: true,
      placeholderText: "仅数字，6-32位",
      success: (result) => {
        if (!result.confirm) {
          resolve(null);
          return;
        }
        const content = normalizeStudentNoInput((result as { content?: string }).content);
        resolve(content);
      },
      fail: () => {
        resolve(null);
      },
    });
  });
};

const normalizeRandomCodeInput = (value: unknown) => {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(0, 4);
};

export const useProfileAccountPage = () => {
  const backendBaseUrl = ref("");
  const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
  const {
    dashboard,
    refreshDashboard: refreshSocialDashboardData,
    hydrateDashboardFromStorage,
    clearDashboard,
  } = useSocialDashboard();
  const avatarUrl = ref("");
  const hintText = ref("");
  const loginPending = ref(false);
  const avatarPending = ref(false);
  const notifyPending = ref(false);
  const randomCodePending = ref(false);
  const authUnbindPending = ref(false);

  const isAuthed = computed(() => Boolean(authSession.value.token && authSession.value.user));
  const isBound = computed(() => Boolean(dashboard.value?.bound && String(dashboard.value?.me?.studentId || "").trim()));
  const isAdmin = computed(() => Boolean(dashboard.value?.me?.isAdmin));
  const boundStudentDisplay = computed(() => {
    if (!isBound.value) {
      return "";
    }
    const name = String(dashboard.value?.me?.name || authSession.value.user?.studentName || "").trim();
    const studentNo = String(dashboard.value?.me?.studentNo || authSession.value.user?.studentNo || "").trim();
    const classLabel = String(dashboard.value?.me?.classLabel || "").trim();
    const primary = name || studentNo;
    if (!primary) {
      return "";
    }
    return classLabel ? `${primary}（${classLabel}）` : primary;
  });
  const boundStudentNo = computed(() => {
    if (!isBound.value) {
      return "";
    }
    return String(dashboard.value?.me?.studentNo || "").trim();
  });
  const editStudentNoSubText = computed(() => {
    if (!isBound.value) {
      return "未绑定";
    }
    return boundStudentNo.value ? `学号：${boundStudentNo.value}` : "未绑定";
  });
  const myRandomCode = computed(() => {
    return String(dashboard.value?.me?.randomCode || "").trim();
  });
  const notifyBound = computed(() => {
    return Boolean(dashboard.value?.me?.notifyBound);
  });

  const authStatusLabel = computed(() => {
    if (!isAuthed.value) {
      return "未授权";
    }
    if (!isBound.value) {
      return "已登录（未绑定课表）";
    }
    return authSession.value.mode === "wechat" ? "微信已授权" : "开发已授权";
  });

  const authButtonText = computed(() => {
    if (isAuthed.value) {
      return "退出登录";
    }
    return "微信授权登录";
  });

  const requestAuthProfile = async () => {
    if (!authSession.value.token) {
      return;
    }
    const data = await requestBackendGet<BackendAuthMeResponse>(backendBaseUrl.value, "/api/v1/auth/me", {}, authSession.value.token);
    const studentId = String(data.user?.studentId || "").trim();
    const studentNo = String(data.user?.studentNo || "").trim();
    if (!data.user || (!studentId && !studentNo)) {
      throw new Error("登录状态异常");
    }
    const openId = String(data.user.openId || "").trim() || `wx_${studentNo || studentId}`;
    persistAuthSessionToStorage({
      token: authSession.value.token,
      expiresAt: Number(data.expiresAt || 0),
      mode: data.mode === "wechat" ? "wechat" : "mock",
      user: {
        openId,
        studentId,
        studentNo,
        studentName: String(data.user.studentName || "").trim(),
        classLabel: String(data.user.classLabel || ""),
        nickname: String(data.user.nickname || ""),
        avatarUrl: String(data.user.avatarUrl || ""),
      },
    });
    authSession.value = readAuthSessionFromStorage();
  };

  const refreshSocialMe = async () => {
    if (!isAuthed.value) {
      clearDashboard(true);
      avatarUrl.value = "";
      return;
    }
    const data = await refreshSocialDashboardData(() =>
      requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/v1/social/me", {}, authSession.value.token),
      backendBaseUrl.value,
    );
    avatarUrl.value = resolveBackendMediaUrl(
      backendBaseUrl.value,
      String(data.me?.avatarUrl || authSession.value.user?.avatarUrl || "").trim(),
    );
  };

  const refreshState = async () => {
    backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
    authSession.value = readAuthSessionFromStorage();
    hintText.value = "";
    avatarUrl.value = resolveBackendMediaUrl(backendBaseUrl.value, String(authSession.value.user?.avatarUrl || "").trim());
    clearDashboard(false);
    if (!isAuthed.value) {
      clearDashboard(true);
      return;
    }
    try {
      await requestAuthProfile();
      await refreshSocialMe();
      if (!isBound.value) {
        hintText.value = "请先前往绑定指引页，在机器人发送 bind 学号或姓名";
      }
    } catch (error) {
      if (isAuthSessionInvalidError(error)) {
        clearAuthSessionStorage();
        authSession.value = readAuthSessionFromStorage();
        clearDashboard(true);
        hintText.value = "登录已失效，请重新授权";
        return;
      }
      if (hydrateDashboardFromStorage(backendBaseUrl.value)) {
        avatarUrl.value = resolveBackendMediaUrl(
          backendBaseUrl.value,
          String(dashboard.value?.me?.avatarUrl || authSession.value.user?.avatarUrl || "").trim(),
        );
      }
      hintText.value = "网络异常，已保留本地登录缓存";
    }
  };

  const authLogin = async (studentNo = "") => {
    if (loginPending.value) {
      return;
    }
    let normalizedStudentNo = normalizeStudentNoInput(studentNo);
    if (!normalizedStudentNo) {
      const manualStudentNo = await promptStudentNoInput();
      if (manualStudentNo === null) {
        return;
      }
      normalizedStudentNo = normalizeStudentNoInput(manualStudentNo);
    }
    if (!normalizedStudentNo) {
      uni.showToast({ title: "请先填写学号", icon: "none", duration: 1600 });
      return;
    }
    if (!/^\d{6,32}$/.test(normalizedStudentNo)) {
      uni.showToast({ title: "学号格式不正确", icon: "none", duration: 1600 });
      return;
    }
    const studentId = normalizedStudentNo ? resolveStudentIdByStudentNo(normalizedStudentNo) : "";
    loginPending.value = true;
    hintText.value = "";
    try {
      const code = await fetchMiniProgramCode();
      const profile = await tryGetWechatProfile();
      const data = await requestBackendPost<BackendAuthLoginResponse>(
        backendBaseUrl.value,
        "/api/v1/auth/wechat-login",
        {
          code,
          studentId: studentId || undefined,
          studentNo: normalizedStudentNo,
          nickname: profile.nickname || "",
          avatarUrl: profile.avatarUrl || "",
          clientPlatform: resolveClientPlatform(),
        },
      );
      if (!data.token || !data.user) {
        throw new Error("授权失败");
      }
      persistAuthSessionToStorage({
        token: data.token,
        expiresAt: Number(data.expiresAt || 0),
        mode: data.mode === "wechat" ? "wechat" : "mock",
        user: {
          openId: String(data.user.openId || "").trim() || `wx_${normalizedStudentNo || studentId}`,
          studentId: String(data.user.studentId || ""),
          studentNo: String(data.user.studentNo || ""),
          studentName: String(data.user.studentName || "").trim(),
          classLabel: String(data.user.classLabel || ""),
          nickname: String(data.user.nickname || ""),
          avatarUrl: String(data.user.avatarUrl || ""),
        },
      });
      authSession.value = readAuthSessionFromStorage();
      await refreshSocialMe();
      hintText.value = isBound.value ? "登录成功" : "登录成功，请前往绑定指引页查看机器人 bind 步骤";
      uni.showToast({ title: "授权成功", icon: "none", duration: 1200 });
    } catch (error) {
      const message = resolveActionErrorMessage(error, "授权失败");
      hintText.value = message;
      uni.showToast({ title: message, icon: "none", duration: 1800 });
    } finally {
      loginPending.value = false;
    }
  };

  const authLogout = async () => {
    if (loginPending.value) {
      return;
    }
    if (!isAuthed.value) {
      uni.showToast({ title: "当前未登录", icon: "none", duration: 1400 });
      return;
    }
    loginPending.value = true;
    try {
      try {
        await requestBackendPost(backendBaseUrl.value, "/api/v1/auth/logout", {}, authSession.value.token);
      } catch (error) {
      }
      clearAuthSessionStorage();
      authSession.value = readAuthSessionFromStorage();
      clearDashboard(true);
      avatarUrl.value = "";
      hintText.value = "已退出登录";
      uni.showToast({ title: "已退出登录", icon: "none", duration: 1200 });
    } finally {
      loginPending.value = false;
    }
  };

  const goBindStudentPage = () => {
    if (!isAuthed.value) {
      uni.showToast({ title: "请先登录", icon: "none", duration: 1400 });
      return;
    }
    if (isBound.value) {
      uni.showToast({ title: "已绑定，可点击“解除微信授权”解绑", icon: "none", duration: 1800 });
      return;
    }
    uni.navigateTo({ url: "/pages/profile/bind-guide" });
  };

  const updateAuthedAvatar = (nextAvatarUrl: string) => {
    if (!authSession.value.user || !authSession.value.token) {
      return;
    }
    const user = {
      ...authSession.value.user,
      avatarUrl: nextAvatarUrl,
    };
    persistAuthSessionToStorage({
      token: authSession.value.token,
      expiresAt: authSession.value.expiresAt,
      mode: authSession.value.mode === "wechat" ? "wechat" : "mock",
      user,
    });
    authSession.value = readAuthSessionFromStorage();
  };

  const ensureAvatarUploadAllowed = () => {
    if (!isAuthed.value) {
      uni.showToast({ title: "请先授权登录", icon: "none", duration: 1600 });
      return false;
    }
    if (!isBound.value) {
      uni.showToast({ title: "请先绑定课表账号", icon: "none", duration: 1600 });
      return false;
    }
    return true;
  };

  const uploadAvatarByPath = async (filePathInput: string) => {
    if (!ensureAvatarUploadAllowed()) {
      return;
    }
    const filePath = String(filePathInput || "").trim();
    if (!filePath) {
      uni.showToast({ title: "未选择头像", icon: "none", duration: 1500 });
      return;
    }
    if (avatarPending.value) {
      return;
    }
    avatarPending.value = true;
    try {
      const fileSize = await getLocalFileSize(filePath);
      const maxBytes = 2 * 1024 * 1024;
      if (fileSize > maxBytes) {
        throw new Error("图片过大，请选择不超过 2MB 的图片");
      }
      const response = await uploadBackendImage<UploadImageResponse>(
        backendBaseUrl.value,
        "/api/v1/social/upload/avatar",
        filePath,
        authSession.value.token,
      );
      const nextAvatar = String(response.avatarUrl || response.me?.avatarUrl || avatarUrl.value || "").trim();
      avatarUrl.value = resolveBackendMediaUrl(backendBaseUrl.value, nextAvatar);
      updateAuthedAvatar(avatarUrl.value);
      uni.showToast({ title: "上传成功", icon: "none", duration: 1200 });
    } catch (error) {
      const message = resolveActionErrorMessage(error, "上传失败");
      uni.showToast({ title: message, icon: "none", duration: 2000 });
    } finally {
      avatarPending.value = false;
    }
  };

  const uploadAvatar = async () => {
    if (!ensureAvatarUploadAllowed()) {
      return;
    }
    try {
      const filePath = await chooseSingleImage();
      await uploadAvatarByPath(filePath);
    } catch (error) {
      const message = resolveActionErrorMessage(error, "上传失败");
      uni.showToast({ title: message, icon: "none", duration: 2000 });
    }
  };

  const goAvatarPage = () => {
    if (!isAuthed.value) {
      uni.showToast({ title: "请先登录", icon: "none", duration: 1400 });
      return;
    }
    uni.navigateTo({ url: "/pages/profile/avatar" });
  };

  const goStudentNoPage = () => {
    if (!isBound.value) {
      uni.showToast({ title: "请先绑定课表账号", icon: "none", duration: 1600 });
      return;
    }
    uni.navigateTo({ url: "/pages/profile/student-no" });
  };

  const ensureNotifyActionAllowed = () => {
    if (!isAuthed.value) {
      uni.showToast({ title: "请先登录", icon: "none", duration: 1400 });
      return false;
    }
    if (!isBound.value) {
      uni.showToast({ title: "请先绑定课表账号", icon: "none", duration: 1600 });
      return false;
    }
    return true;
  };

  const bindNotify = () => {
    if (!ensureNotifyActionAllowed() || notifyPending.value) {
      return;
    }
    hintText.value = "请在机器人发送 bind 学号或姓名，完成后返回本页刷新状态";
    uni.navigateTo({ url: "/pages/profile/bind-guide" });
  };

  const openScheduleImportPage = () => {
    if (!isAdmin.value) {
      uni.showToast({ title: "仅管理员可用", icon: "none", duration: 1600 });
      return;
    }
    uni.navigateTo({ url: "/pages/profile/schedule-import" });
  };

  const unbindNotify = async () => {
    if (!ensureNotifyActionAllowed() || notifyPending.value) {
      return;
    }
    notifyPending.value = true;
    try {
      await requestBackendPost(backendBaseUrl.value, "/api/v1/social/notify/unbind", {}, authSession.value.token);
      await refreshSocialMe();
      uni.showToast({ title: "已解绑", icon: "none", duration: 1200 });
    } catch (error) {
      const message = resolveActionErrorMessage(error, "解绑失败");
      uni.showToast({ title: message, icon: "none", duration: 1800 });
    } finally {
      notifyPending.value = false;
    }
  };

  const updateRandomCode = () => {
    if (!ensureNotifyActionAllowed() || randomCodePending.value) {
      return;
    }
    uni.showModal({
      title: "修改验证码",
      content: "请输入新的 4 位验证码",
      editable: true,
      placeholderText: "4 位数字验证码",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        const nextCode = normalizeRandomCodeInput((result as { content?: string }).content);
        if (nextCode.length !== 4) {
          uni.showToast({ title: "请输入 4 位数字验证码", icon: "none", duration: 1600 });
          return;
        }
        uni.showModal({
          title: "确认修改",
          content: "修改后会移除所有非管理员订阅者，是否继续？",
          success: async (confirmResult) => {
            if (!confirmResult.confirm) {
              return;
            }
            randomCodePending.value = true;
            try {
              const response = await requestBackendPost<UpdateRandomCodeResponse>(
                backendBaseUrl.value,
                "/api/v1/social/random-code",
                { randomCode: nextCode },
                authSession.value.token,
              );
              await refreshSocialMe();
              const removed = Number(response.removedSubscriberCount || 0);
              hintText.value = removed > 0 ? `验证码已更新，已移除 ${removed} 位非管理员订阅者` : "验证码已更新";
              uni.showToast({ title: "验证码已更新", icon: "none", duration: 1400 });
            } catch (error) {
              const message = resolveActionErrorMessage(error, "修改失败");
              uni.showToast({ title: message, icon: "none", duration: 1800 });
            } finally {
              randomCodePending.value = false;
            }
          },
        });
      },
    });
  };

  const unbindAuth = () => {
    if (!isAuthed.value || authUnbindPending.value) {
      if (!isAuthed.value) {
        uni.showToast({ title: "请先登录", icon: "none", duration: 1400 });
      }
      return;
    }
    uni.showModal({
      title: "解除微信授权",
      content: "解除后当前微信与课表账号绑定会清空，后续可由其他人重新登录绑定。",
      success: async (result) => {
        if (!result.confirm) {
          return;
        }
        authUnbindPending.value = true;
        try {
          await requestBackendPost(backendBaseUrl.value, "/api/v1/auth/unbind", {}, authSession.value.token);
          clearAuthSessionStorage();
          authSession.value = readAuthSessionFromStorage();
          clearDashboard(true);
          avatarUrl.value = "";
          hintText.value = "已解除微信授权";
          uni.showToast({ title: "已解除授权", icon: "none", duration: 1400 });
        } catch (error) {
          const message = resolveActionErrorMessage(error, "解除授权失败");
          uni.showToast({ title: message, icon: "none", duration: 1800 });
        } finally {
          authUnbindPending.value = false;
        }
      },
    });
  };

  return {
    avatarUrl,
    hintText,
    loginPending,
    avatarPending,
    notifyPending,
    randomCodePending,
    authUnbindPending,
    isAuthed,
    isBound,
    isAdmin,
    boundStudentDisplay,
    myRandomCode,
    notifyBound,
    editStudentNoSubText,
    authStatusLabel,
    authButtonText,
    refreshState,
    authLogin,
    authLogout,
    goBindStudentPage,
    uploadAvatarByPath,
    uploadAvatar,
    goAvatarPage,
    goStudentNoPage,
    openScheduleImportPage,
    bindNotify,
    unbindNotify,
    updateRandomCode,
    unbindAuth,
  };
};
