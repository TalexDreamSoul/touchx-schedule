import { computed, ref } from "vue";
import {
  clearAuthSessionStorage,
  fetchMiniProgramCode,
  uploadBackendImage,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveStudentIdByStudentNo,
  resolveBackendBaseUrlFromStorage,
  resolveClientPlatform,
  persistAuthSessionToStorage,
  tryGetWechatProfile,
  type AuthSessionState,
} from "@/utils/profile-service";
import { useSocialDashboard, type SocialDashboardResponse, type SocialUserItem } from "@/composables/useSocialDashboard";

interface AuthUserProfile {
  openId: string;
  studentId: string;
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
  if (/timeout/i.test(rawMessage)) {
    return "网络请求超时，请稍后重试";
  }
  if (/request:fail/i.test(rawMessage)) {
    return "网络请求失败，请检查网络或后端地址";
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
  const isBound = computed(() => Boolean(authSession.value.user?.studentId));
  const boundStudentName = computed(() => {
    const name = String(dashboard.value?.me?.name || authSession.value.user?.studentName || "").trim();
    const classLabel = String(dashboard.value?.me?.classLabel || "").trim();
    if (!name) {
      return "";
    }
    return classLabel ? `${name}（${classLabel}）` : name;
  });
  const boundStudentNo = computed(() => {
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
      return "重新授权登录";
    }
    return "微信授权登录";
  });

  const requestAuthProfile = async () => {
    if (!authSession.value.token) {
      return;
    }
    const data = await requestBackendGet<BackendAuthMeResponse>(backendBaseUrl.value, "/api/auth/me", {}, authSession.value.token);
    if (!data.user?.openId) {
      throw new Error("登录状态异常");
    }
    persistAuthSessionToStorage({
      token: authSession.value.token,
      expiresAt: Number(data.expiresAt || 0),
      mode: data.mode === "wechat" ? "wechat" : "mock",
      user: {
        openId: String(data.user.openId || ""),
        studentId: String(data.user.studentId || ""),
        studentName: String(data.user.studentName || ""),
        classLabel: String(data.user.classLabel || ""),
        nickname: String(data.user.nickname || ""),
        avatarUrl: String(data.user.avatarUrl || ""),
      },
    });
    authSession.value = readAuthSessionFromStorage();
  };

  const refreshSocialMe = async () => {
    if (!isAuthed.value) {
      clearDashboard();
      avatarUrl.value = "";
      return;
    }
    const data = await refreshSocialDashboardData(() =>
      requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/social/me", {}, authSession.value.token),
    );
    avatarUrl.value = String(data.me?.avatarUrl || authSession.value.user?.avatarUrl || "").trim();
  };

  const refreshState = async () => {
    backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
    authSession.value = readAuthSessionFromStorage();
    hintText.value = "";
    avatarUrl.value = String(authSession.value.user?.avatarUrl || "").trim();
    clearDashboard();
    if (!isAuthed.value) {
      return;
    }
    try {
      await requestAuthProfile();
      await refreshSocialMe();
      if (!isBound.value) {
        hintText.value = "请先绑定一个课表账号";
      }
    } catch (error) {
      clearAuthSessionStorage();
      authSession.value = readAuthSessionFromStorage();
      hintText.value = "登录已失效，请重新授权";
    }
  };

  const authLogin = async (studentNo = "") => {
    if (loginPending.value) {
      return;
    }
    const normalizedStudentNo = normalizeStudentNoInput(studentNo);
    if (!normalizedStudentNo && !isAuthed.value) {
      hintText.value = "请输入学号";
      uni.showToast({ title: "请输入学号", icon: "none", duration: 1400 });
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
        "/api/auth/wechat-login",
        {
          code,
          student_id: studentId || undefined,
          student_no: normalizedStudentNo,
          nickname: profile.nickname || "",
          avatar_url: profile.avatarUrl || "",
          client_platform: resolveClientPlatform(),
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
          openId: String(data.user.openId || ""),
          studentId: String(data.user.studentId || ""),
          studentName: String(data.user.studentName || ""),
          classLabel: String(data.user.classLabel || ""),
          nickname: String(data.user.nickname || ""),
          avatarUrl: String(data.user.avatarUrl || ""),
        },
      });
      authSession.value = readAuthSessionFromStorage();
      await refreshSocialMe();
      hintText.value = isBound.value ? "登录成功" : "登录成功，请先绑定课表账号";
      uni.showToast({ title: "授权成功", icon: "none", duration: 1200 });
    } catch (error) {
      const message = resolveActionErrorMessage(error, "授权失败");
      hintText.value = message;
      uni.showToast({ title: message, icon: "none", duration: 1800 });
    } finally {
      loginPending.value = false;
    }
  };

  const goBindStudentPage = () => {
    if (!isAuthed.value) {
      uni.showToast({ title: "请先登录", icon: "none", duration: 1400 });
      return;
    }
    uni.navigateTo({ url: "/pages/profile/bind-student" });
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
        "/api/social/upload/avatar",
        filePath,
        authSession.value.token,
      );
      const nextAvatar = String(response.avatarUrl || response.me?.avatarUrl || avatarUrl.value || "").trim();
      avatarUrl.value = nextAvatar;
      updateAuthedAvatar(nextAvatar);
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
    uni.showModal({
      title: "绑定微信通知",
      content: "请输入企业微信用户ID（或 wecom://用户ID）",
      editable: true,
      placeholderText: "企业微信用户ID",
      success: async (result) => {
        if (!result.confirm) {
          return;
        }
        const value = String((result as { content?: string }).content || "").trim();
        if (!value) {
          uni.showToast({ title: "请输入企业微信用户ID", icon: "none", duration: 1600 });
          return;
        }
        notifyPending.value = true;
        try {
          await requestBackendPost(backendBaseUrl.value, "/api/social/notify/bind", { channel_url: value }, authSession.value.token);
          await refreshSocialMe();
          uni.showToast({ title: "绑定成功", icon: "none", duration: 1200 });
        } catch (error) {
          const message = resolveActionErrorMessage(error, "绑定失败");
          uni.showToast({ title: message, icon: "none", duration: 1800 });
        } finally {
          notifyPending.value = false;
        }
      },
    });
  };

  const unbindNotify = async () => {
    if (!ensureNotifyActionAllowed() || notifyPending.value) {
      return;
    }
    notifyPending.value = true;
    try {
      await requestBackendPost(backendBaseUrl.value, "/api/social/notify/unbind", {}, authSession.value.token);
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
                "/api/social/random-code",
                { random_code: nextCode },
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
          await requestBackendPost(backendBaseUrl.value, "/api/auth/unbind", {}, authSession.value.token);
          clearAuthSessionStorage();
          authSession.value = readAuthSessionFromStorage();
          clearDashboard();
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
    boundStudentName,
    myRandomCode,
    notifyBound,
    editStudentNoSubText,
    authStatusLabel,
    authButtonText,
    refreshState,
    authLogin,
    goBindStudentPage,
    uploadAvatarByPath,
    uploadAvatar,
    goAvatarPage,
    goStudentNoPage,
    bindNotify,
    unbindNotify,
    updateRandomCode,
    unbindAuth,
  };
};
