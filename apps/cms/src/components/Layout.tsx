export type PageKey = "dashboard" | "calendar-sources" | "personal-events" | "reminder-rules" | "reminder-candidates" | "notification-channels" | "notification-deliveries" | "imports" | "audit-logs" | "roadmap";

const navItems: Array<{ key: PageKey; label: string }> = [
  { key: "dashboard", label: "总览" },
  { key: "calendar-sources", label: "日程源" },
  { key: "personal-events", label: "个人事项" },
  { key: "reminder-rules", label: "提醒规则" },
  { key: "reminder-candidates", label: "提醒候选" },
  { key: "notification-channels", label: "通知通道" },
  { key: "notification-deliveries", label: "投递记录" },
  { key: "imports", label: "导入中心" },
  { key: "audit-logs", label: "审计日志" },
  { key: "roadmap", label: "React Roadmap" },
];

export function Layout(props: {
  page: PageKey;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onNavigate: (page: PageKey) => void;
  children: JSX.Element;
}) {
  return (
    <div className="app" data-theme={props.theme}>
      <header className="topbar">
        <div>
          <p className="kicker">TouchX CMS</p>
          <h1>React Admin Console</h1>
        </div>
        <div className="actions">
          <button className="button ghost" onClick={props.onToggleTheme}>{props.theme === "dark" ? "浅色" : "深色"}</button>
          <a className="button ghost" href="/nexus">Nuxt Nexus</a>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-link ${props.page === item.key ? "active" : ""}`}
              onClick={() => props.onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </aside>
        <main className="main">{props.children}</main>
      </div>
    </div>
  );
}
