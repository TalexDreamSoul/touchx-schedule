export default defineAppConfig({
  pages: [
    "pages/today/index",
    "pages/week/index",
    "pages/sources/index",
    "pages/profile/index",
  ],
  window: {
    navigationBarTitleText: "TouchX",
    navigationBarBackgroundColor: "#0a0a0a",
    navigationBarTextStyle: "white",
    backgroundColor: "#0a0a0a",
  },
  tabBar: {
    color: "#737373",
    selectedColor: "#171717",
    backgroundColor: "#ffffff",
    borderStyle: "black",
    list: [
      { pagePath: "pages/today/index", text: "今日" },
      { pagePath: "pages/week/index", text: "周视图" },
      { pagePath: "pages/sources/index", text: "订阅" },
      { pagePath: "pages/profile/index", text: "我的" },
    ],
  },
});
