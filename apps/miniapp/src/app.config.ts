import { miniappChromeTheme } from "./lib/theme";

export default defineAppConfig({
  pages: [
    "pages/today/index",
    "pages/week/index",
    "pages/sources/index",
    "pages/profile/index",
  ],
  window: {
    navigationBarTitleText: "TouchX",
    navigationBarBackgroundColor: miniappChromeTheme.navigationBarBackgroundColor,
    navigationBarTextStyle: miniappChromeTheme.navigationBarTextStyle,
    backgroundColor: miniappChromeTheme.backgroundColor,
  },
  tabBar: {
    color: miniappChromeTheme.tabBarColor,
    selectedColor: miniappChromeTheme.tabBarSelectedColor,
    backgroundColor: miniappChromeTheme.tabBarBackgroundColor,
    borderStyle: miniappChromeTheme.tabBarBorderStyle,
    list: [
      { pagePath: "pages/today/index", text: "今日" },
      { pagePath: "pages/week/index", text: "日程表" },
      { pagePath: "pages/sources/index", text: "订阅" },
      { pagePath: "pages/profile/index", text: "我的" },
    ],
  },
});
