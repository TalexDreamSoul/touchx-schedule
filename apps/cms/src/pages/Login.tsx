import { useEffect, useState } from "react";
import { setSessionToken } from "../lib/auth";

interface BootstrapStatusPayload {
  ok: boolean;
  data?: {
    bootstrapStudentNo?: string;
    requirePassword?: boolean;
    passwordInitialized?: boolean;
  };
  error?: { message?: string };
}

interface LoginPayload {
  ok: boolean;
  data?: {
    sessionToken?: string;
    needInit?: boolean;
    bootstrapStudentNo?: string;
  };
  error?: { message?: string };
}

export function Login(props: { onLoggedIn: () => void }) {
  const [studentNo, setStudentNo] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadBootstrapStatus = async () => {
    try {
      const response = await fetch("/api/v1/admin/bootstrap-status");
      const payload = (await response.json()) as BootstrapStatusPayload;
      if (!response.ok || !payload.ok) {
        return;
      }
      const requirePassword = Boolean(payload.data?.requirePassword ?? payload.data?.passwordInitialized ?? true);
      setPasswordRequired(requirePassword);
      if (!requirePassword && payload.data?.bootstrapStudentNo) {
        setStudentNo(payload.data.bootstrapStudentNo);
      }
    } catch {
      setPasswordRequired(true);
    }
  };

  const login = async () => {
    if (!studentNo.trim()) {
      setError("请输入管理员学号");
      return;
    }
    if (passwordRequired && !password.trim()) {
      setError("请输入密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentNo, password }),
      });
      const payload = (await response.json()) as LoginPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message || `HTTP ${response.status}`);
      }
      const token = String(payload.data?.sessionToken || "").trim();
      if (!token) {
        throw new Error("登录成功但缺少 sessionToken");
      }
      setSessionToken(token);
      props.onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadBootstrapStatus(); }, []);

  return (
    <div className="app" data-theme="dark">
      <div className="login-wrap">
        <section className="card login-card">
          <p className="kicker">TouchX CMS</p>
          <h1>React Admin 登录</h1>
          <p>使用 ScheduleNexus 管理员账号进入全新 React CMS。</p>
          <label className="field-label">学号</label>
          <input className="input login-input" value={studentNo} onChange={(event: any) => setStudentNo(event.target.value)} placeholder="管理员学号" />
          <label className="field-label">密码</label>
          <input
            className="input login-input"
            value={password}
            onChange={(event: any) => setPassword(event.target.value)}
            type="password"
            placeholder={passwordRequired ? "管理密码" : "首次初始化可留空"}
          />
          {error ? <p className="muted">{error}</p> : null}
          <button className="button login-button" disabled={loading} onClick={() => void login()}>
            {loading ? "登录中..." : "进入 React CMS"}
          </button>
          <a className="muted" href="/nexus/login">去旧 Nexus 登录</a>
        </section>
      </div>
    </div>
  );
}
