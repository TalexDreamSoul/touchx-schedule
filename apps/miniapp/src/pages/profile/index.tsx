import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { View, Text, Button, Input, Image, Switch } from "@tarojs/components";
import {
  clearAuthState,
  createWechatClawDBotBindingQr,
  getAuthMe,
  getSessionToken,
  getStoredUser,
  listNotificationBindings,
  login,
  logout,
  register,
  setSessionToken,
  setStoredUser,
  unbindWechatClawDBot,
  updateAuthProfile,
  uploadPdfImportPreview,
  type MiniappUser,
  type NotificationBindingRow,
  type PdfImportPreviewResult,
} from "../../lib/api";
import { miniappPageThemeStyles } from "../../lib/theme";

type InputEvent = { detail: { value: string } };
type SwitchEvent = { detail: { value: boolean } };

type AuthMode = "login" | "register";

const actionItems = [
  { icon: "订", title: "我的订阅", subtitle: "到订阅页取消订阅或发布自定义源" },
  { icon: "导", title: "PDF 日程导入", subtitle: "上传解析 PDF，生成候选日程" },
  { icon: "偏", title: "日程表设置", subtitle: "到日程表页编辑提醒和视图配置" },
];

export default function ProfilePage() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [user, setUser] = useState<MiniappUser | null>(getStoredUser());
  const [message, setMessage] = useState("使用账号密码注册/登录后同步日程、订阅与 Todo。");
  const [loading, setLoading] = useState(false);
  const [bindings, setBindings] = useState<NotificationBindingRow[]>([]);
  const [qrImageUrl, setQrImageUrl] = useState("");
  const [pdfPreview, setPdfPreview] = useState<PdfImportPreviewResult | null>(null);

  const profileName = user ? (user.nickname || user.name || user.accountName || user.studentNo) : "点击登录";
  const profileSub = user ? `${user.accountName || "账号"} · ${user.classLabel || "自定义订阅"}` : "同步课程表与个人日程";
  const wechatBound = bindings.some((item) => item.channelType === "wechat_clawdbot" && item.status === "active");

  const refreshBindings = async () => {
    if (!getSessionToken()) {
      setBindings([]);
      return;
    }
    try {
      const data = await listNotificationBindings();
      setBindings(data.items || []);
    } catch {
      setBindings([]);
    }
  };

  const refreshMe = async () => {
    if (!getSessionToken()) {
      setUser(null);
      setMessage("当前未登录。");
      return;
    }
    setLoading(true);
    try {
      const data = await getAuthMe();
      setUser(data.user);
      setStoredUser(data.user);
      setAccountName(data.user.accountName || "");
      setNickname(data.user.nickname || data.user.name || "");
      setMessage("登录态有效。");
      await refreshBindings();
    } catch (error) {
      clearAuthState();
      setUser(null);
      setMessage(error instanceof Error ? error.message : "登录态已失效");
    } finally {
      setLoading(false);
    }
  };

  const submitAuth = async () => {
    if (!accountName.trim()) {
      setMessage("请输入账号。");
      return;
    }
    if (!password.trim()) {
      setMessage("请输入密码。");
      return;
    }
    setLoading(true);
    try {
      const data = authMode === "register"
        ? await register({ accountName: accountName.trim(), password, confirmPassword, nickname: nickname.trim() || undefined })
        : await login({ accountName: accountName.trim(), password, nickname: nickname.trim() || undefined });
      setSessionToken(data.sessionToken);
      setStoredUser(data.user);
      setUser(data.user);
      setPassword("");
      setConfirmPassword("");
      setMessage(authMode === "register" ? "注册成功，已自动登录。" : "登录成功，今日/日程表已可读取真实日程。");
      await refreshBindings();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const saveNickname = async () => {
    if (!getSessionToken()) return;
    setLoading(true);
    try {
      const data = await updateAuthProfile({ nickname: nickname.trim() });
      setUser(data.user);
      setStoredUser(data.user);
      setMessage("昵称已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存昵称失败");
    } finally {
      setLoading(false);
    }
  };

  const submitLogout = async () => {
    setLoading(true);
    try {
      if (getSessionToken()) await logout();
    } catch {
      // 本地退出必须可用，远端会话清理失败不阻断用户重新登录。
    } finally {
      clearAuthState();
      setUser(null);
      setBindings([]);
      setQrImageUrl("");
      setMessage("已退出登录。");
      setLoading(false);
    }
  };

  const createQr = async () => {
    if (!getSessionToken()) {
      setMessage("请先登录后绑定微信 ClawDBot。");
      return;
    }
    setLoading(true);
    try {
      const data = await createWechatClawDBotBindingQr();
      setQrImageUrl(data.qrImageUrl);
      setMessage("二维码已生成，请用微信/ClawDBot 扫码或发送绑定口令。");
      await refreshBindings();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成二维码失败");
    } finally {
      setLoading(false);
    }
  };

  const unbindWechat = async () => {
    setLoading(true);
    try {
      await unbindWechatClawDBot();
      setQrImageUrl("");
      setMessage("已取消微信 ClawDBot 绑定。");
      await refreshBindings();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "解绑失败");
    } finally {
      setLoading(false);
    }
  };

  const choosePdf = async () => {
    if (!getSessionToken()) {
      setMessage("请先登录后上传 PDF。");
      return;
    }
    setLoading(true);
    try {
      const result = await Taro.chooseMessageFile({ count: 1, type: "file", extension: ["pdf"] });
      const file = result.tempFiles?.[0];
      if (!file?.path) {
        setMessage("未选择文件。");
        return;
      }
      const preview = await uploadPdfImportPreview(file.path, file.name || "schedule.pdf");
      setPdfPreview(preview);
      setMessage(`PDF 已解析出 ${preview.total} 条候选日程。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF 上传解析失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshMe(); }, []);

  return (
    <View className="tx-page" style={miniappPageThemeStyles.green}>
      <View className="tx-safe-top">
        <Text className="tx-safe-title">我的</Text>
      </View>
      <View className="tx-scroll-page">
        <View className="tx-profile-head-card tx-card">
          <View className="tx-profile-row">
            <View className="tx-avatar">
              {user?.avatarUrl ? <Image src={user.avatarUrl} mode="aspectFill" style={{ width: "100%", height: "100%" }} /> : <Text>{profileName.slice(0, 1)}</Text>}
            </View>
            <View className="tx-profile-main">
              <Text className="tx-profile-name">{profileName}</Text>
              <Text className="tx-profile-sub">{profileSub}</Text>
              {user ? <Text className="tx-pill tx-pill-active" style={{ marginTop: "12rpx", alignSelf: "flex-start" }}>已登录</Text> : null}
            </View>
          </View>
        </View>

        <View className="tx-card">
          <View className="tx-card-head">
            <View>
              <Text className="tx-section-title">账号密码</Text>
              <Text className="tx-section-sub">{message}</Text>
            </View>
            <Switch checked={authMode === "register"} onChange={(event: SwitchEvent) => setAuthMode(event.detail.value ? "register" : "login")} />
          </View>
          <Text className="tx-tip">当前：{authMode === "register" ? "注册新账号" : "登录已有账号"}</Text>
          <Input className="tx-input" value={accountName} placeholder="账号 / 邮箱" onInput={(event: InputEvent) => setAccountName(event.detail.value)} />
          <Input className="tx-input" password value={password} placeholder="密码" onInput={(event: InputEvent) => setPassword(event.detail.value)} />
          {authMode === "register" ? <Input className="tx-input" password value={confirmPassword} placeholder="确认密码" onInput={(event: InputEvent) => setConfirmPassword(event.detail.value)} /> : null}
          <Input className="tx-input" value={nickname} placeholder="昵称，可修改" onInput={(event: InputEvent) => setNickname(event.detail.value)} />
          <View className="tx-action-row">
            <Button className="tx-button" loading={loading} onClick={submitAuth}>{authMode === "register" ? "注册并登录" : "登录"}</Button>
            {user ? <Button className="tx-button tx-button-secondary" loading={loading} onClick={saveNickname}>保存昵称</Button> : null}
            <Button className="tx-button tx-button-secondary" loading={loading} onClick={refreshMe}>刷新登录态</Button>
            {user ? <Button className="tx-button tx-button-secondary" loading={loading} onClick={submitLogout}>退出</Button> : null}
          </View>
        </View>

        <View className="tx-card">
          <Text className="tx-section-title">微信 ClawDBot</Text>
          <Text className="tx-section-sub">扫码绑定后可用于自定义日程提醒。当前状态：{wechatBound ? "已绑定" : "未绑定"}</Text>
          {qrImageUrl ? <Image src={qrImageUrl} mode="aspectFit" className="tx-qr-image" /> : null}
          <View className="tx-action-row">
            <Button className="tx-button" loading={loading} onClick={createQr}>{wechatBound ? "重新生成二维码" : "生成二维码绑定"}</Button>
            {wechatBound ? <Button className="tx-button tx-button-secondary" loading={loading} onClick={unbindWechat}>取消绑定</Button> : null}
          </View>
        </View>

        <View className="tx-card">
          <Text className="tx-section-title">上传解析 PDF 日程</Text>
          <Text className="tx-section-sub">支持从 PDF 课表/日程表中解析候选项，后续可提交到个人或日程源。</Text>
          <View className="tx-action-row">
            <Button className="tx-button" loading={loading} onClick={choosePdf}>选择 PDF</Button>
          </View>
          {pdfPreview ? (
            <View style={{ marginTop: "14rpx" }}>
              <Text className="tx-muted">{pdfPreview.fileName} · {pdfPreview.total} 条</Text>
              {pdfPreview.previewEntries.slice(0, 5).map((item) => (
                <View className="tx-event-card event-course" key={item.previewEntryId}>
                  <Text className="tx-event-title">{item.courseName}</Text>
                  <Text className="tx-event-meta">周{item.day} · 第 {item.startSection}-{item.endSection} 节 · {item.classroom || "地点待定"}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View className="tx-card">
          <Text className="tx-section-title">功能入口</Text>
          <Text className="tx-section-sub">不再要求学号；通过自定义订阅和 PDF 导入配置你的日程。</Text>
          <View className="tx-action-list" style={{ marginTop: "16rpx" }}>
            {actionItems.map((item) => (
              <View className="tx-action-item" key={item.title}>
                <View className="tx-action-icon">{item.icon}</View>
                <View className="tx-action-main">
                  <Text className="tx-action-title">{item.title}</Text>
                  <Text className="tx-action-sub">{item.subtitle}</Text>
                </View>
                <Text className="tx-action-arrow">›</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="tx-card">
          <Text className="tx-section-title">V2 已接入</Text>
          <View className="tx-pill-row">
            <Text className="tx-pill tx-pill-active">账号密码</Text>
            <Text className="tx-pill tx-pill-active">昵称修改</Text>
            <Text className="tx-pill tx-pill-active">ClawDBot 绑定</Text>
            <Text className="tx-pill tx-pill-active">PDF 解析</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
