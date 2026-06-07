import { miniappChromeTheme } from "../../lib/theme";

export default definePageConfig({
  navigationBarTitleText: "日程表",
  navigationBarBackgroundColor: miniappChromeTheme.navigationBarBackgroundColor,
  navigationBarTextStyle: miniappChromeTheme.navigationBarTextStyle,
  backgroundColor: miniappChromeTheme.backgroundColor,
  enablePullDownRefresh: true,
  backgroundTextStyle: miniappChromeTheme.backgroundTextStyle,
});
