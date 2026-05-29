export default defineAppConfig({
  pages: [
    "pages/today/index",
    "pages/week/index",
    "pages/sources/index",
    "pages/profile/index",
  ],
  window: {
    navigationBarTitleText: "TouchX",
    navigationBarBackgroundColor: "#f3f4f7",
    navigationBarTextStyle: "black",
    backgroundColor: "#f3f4f7",
  },
  tabBar: {
    color: "#5f5f5f",
    selectedColor: "#111111",
    backgroundColor: "#ffffff",
    borderStyle: "black",
    list: [
      { pagePath: "pages/today/index", text: "今日" },
      { pagePath: "pages/week/index", text: "日程表" },
      { pagePath: "pages/sources/index", text: "订阅" },
      { pagePath: "pages/profile/index", text: "我的" },
    ],
  },
});
