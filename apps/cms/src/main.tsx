import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { CalendarSources } from "./pages/CalendarSources";
import { NotificationChannels } from "./pages/NotificationChannels";
import { PersonalEvents } from "./pages/PersonalEvents";
import { ReminderRules } from "./pages/ReminderRules";
import { ReminderCandidates } from "./pages/ReminderCandidates";
import { Imports } from "./pages/Imports";
import { Roadmap } from "./pages/Roadmap";
import { Login } from "./pages/Login";
import { clearSessionToken, getSessionToken } from "./lib/auth";

type PageKey = "dashboard" | "calendar-sources" | "personal-events" | "reminder-rules" | "reminder-candidates" | "notification-channels" | "imports" | "roadmap";

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => (localStorage.getItem("touchx_cms_theme") as "light" | "dark") || "dark");
  const [page, setPage] = useState<PageKey>(() => (location.hash.replace(/^#\/?/, "") as PageKey) || "dashboard");
  const [authed, setAuthed] = useState(() => Boolean(getSessionToken()));
  const content = useMemo(() => {
    switch (page) {
      case "calendar-sources": return <CalendarSources />;
      case "personal-events": return <PersonalEvents />;
      case "reminder-rules": return <ReminderRules />;
      case "reminder-candidates": return <ReminderCandidates />;
      case "notification-channels": return <NotificationChannels />;
      case "imports": return <Imports />;
      case "roadmap": return <Roadmap />;
      default: return <Dashboard />;
    }
  }, [page]);
  useEffect(() => {
    if (!authed) {
      return;
    }
    fetch("/api/v1/admin/me", { headers: { Authorization: `Bearer ${getSessionToken()}` }, credentials: "omit" })
      .then((response) => {
        if (response.status === 401) {
          clearSessionToken();
          setAuthed(false);
        }
      })
      .catch(() => undefined);
  }, [authed]);

  const navigate = (next: PageKey) => {
    setPage(next);
    location.hash = next;
  };
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("touchx_cms_theme", next);
  };
  if (!authed) {
    return <Login onLoggedIn={() => setAuthed(true)} />;
  }
  return <Layout page={page} theme={theme} onToggleTheme={toggleTheme} onNavigate={navigate}>{content}</Layout>;
}

createRoot(document.getElementById("root")!).render(<App />);
