import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AdminLayout from "./components/AdminLayout.vue";
import CampaignsView from "./views/CampaignsView.vue";
import ClassesView from "./views/ClassesView.vue";
import CoursesView from "./views/CoursesView.vue";
import DashboardView from "./views/DashboardView.vue";
import FoodsView from "./views/FoodsView.vue";
import LoginView from "./views/LoginView.vue";
import MediaView from "./views/MediaView.vue";
import PreviewView from "./views/PreviewView.vue";
import SettingsView from "./views/SettingsView.vue";
import UsersView from "./views/UsersView.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    component: LoginView,
  },
  {
    path: "/",
    component: AdminLayout,
    children: [
      { path: "", redirect: "/dashboard" },
      { path: "dashboard", component: DashboardView },
      { path: "users", component: UsersView },
      { path: "classes", component: ClassesView },
      { path: "courses", component: CoursesView },
      { path: "foods", component: FoodsView },
      { path: "campaigns", component: CampaignsView },
      { path: "media", component: MediaView },
      { path: "settings", component: SettingsView },
      { path: "preview", component: PreviewView },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL || "/admin/"),
  routes,
});

const AUTH_KEY = "touchx_admin_v1_logged_in";

router.beforeEach((to) => {
  if (to.path === "/login") {
    return true;
  }
  if (localStorage.getItem(AUTH_KEY)) {
    return true;
  }
  return { path: "/login" };
});

export { router };
