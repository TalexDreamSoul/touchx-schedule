# TouchX TODO

## Taro + React Native 多端路线确认

### 核心决策

- 后台 + CMS：继续使用 `apps/backend`，基于 Nuxt。
- 微信小程序 / 多小程序：新增 Taro + React 应用作为未来小程序主路线。
- iOS / Android 原生 App：使用 React Native CLI / 原生 RN 工程，不使用 Expo。
- 旧 uni-app 小程序：短期保留，作为线上稳定版本和迁移参照。
- 跨端共享逻辑：放在 `packages/*`，不要绑定具体 UI 平台。

目标架构：

```txt
apps/
  backend/          # Nuxt API + CMS
  microapp/         # 旧 uni-app，小程序迁移期保留
  miniapp/          # 新 Taro React 小程序
  mobile/           # React Native CLI App

packages/
  shared/           # 类型、枚举、常量
  calendar-core/    # 日程合成、覆盖、冲突、提醒候选
  api-client/       # API SDK
  notification-core/# 通知模型、渠道抽象、提醒策略
  ui-tokens/        # 跨端设计 token
  app-models/       # 可选：跨端业务 view-model / hooks
```

---

## 为什么可以直接用 Taro

- Taro 与 RN 不冲突。
- Taro 负责小程序和 H5，RN 负责 iOS / Android 原生 App。
- 两者都使用 React 心智，便于统一团队技术栈。
- 可以共享 TypeScript 业务包：
  - `@touchx/shared`
  - `@touchx/calendar-core`
  - `@touchx/api-client`
  - `@touchx/notification-core`
  - `@touchx/ui-tokens`
- UI 层不强行共享，避免牺牲端体验。

需要注意：

> 微信小程序不能直接运行 React Native runtime。

所以“小程序也用 RN”应理解为：

```txt
RN App 和 Taro 小程序共享 React 体系、业务模型、API、设计 token，
但 UI 组件分别用 RN / Taro 原生组件实现。
```

---

## 推荐技术栈

### Taro 小程序

- Taro 4
- React
- TypeScript
- Zustand / Jotai 作为状态管理候选
- 基础组件可评估 NutUI React Taro / Taroify
- 核心日历 UI 自研

### React Native App

- React Native CLI / 原生 RN 工程
- 不使用 Expo
- TypeScript
- React Navigation / Native Stack / Tabs
- iOS / Android 原生模块按需接入
- 本地通知、Widget、Live Activities 后续预研
- iOS 优先体验：手势、Sheet、Haptics、系统日历等

### 共享包

- `packages/shared`：领域类型、枚举、通用常量。
- `packages/calendar-core`：纯 TS 日程合成、订阅、覆盖、冲突、提醒候选。
- `packages/api-client`：小程序 / RN / CMS 共用 API SDK。
- `packages/notification-core`：通知渠道、模板、投递策略。
- `packages/ui-tokens`：颜色、间距、圆角、字体等设计 token。

---

## 短期执行计划

### 1. 更新 Roadmap 文档

- [x] 更新 `docs/touchx-calendar-platform-roadmap.md`：
  - 明确 Taro 是未来小程序主路线。
  - uni-app 是迁移期保留。
  - React Native CLI 是 iOS / Android 原生 App 主路线，不使用 Expo。
  - Taro 与 RN 共享业务包，但不强行共享 UI 组件。

### 2. 新增 Taro 小程序骨架

- [x] 新增 `apps/miniapp`。
- [x] 初始化 Taro + React + TypeScript。
- [x] 接入 monorepo workspace。
- [x] 配置基础页面：
  - `pages/today/index`
  - `pages/week/index`
  - `pages/sources/index`
  - `pages/profile/index`
- [x] 接入共享包：
  - `@touchx/shared`
  - `@touchx/calendar-core`
  - `@touchx/api-client`
  - `@touchx/ui-tokens`

### 3. 保留旧 uni-app

- [ ] 保持 `apps/microapp` 不动。
- [ ] 当前线上小程序继续由 uni-app 版本承载。
- [ ] 后续按页面逐步迁移到 Taro。

### 4. 新增共享包

- [ ] 拆分 `packages/shared/src/calendar.ts`。
- [ ] 拆分 `packages/shared/src/notification.ts`。
- [ ] 拆分 `packages/shared/src/import.ts`。
- [x] 新增 `packages/calendar-core`。
- [x] 新增 `packages/api-client`。
- [x] 新增 `packages/ui-tokens`。

### 5. Taro 首批页面目标

- [ ] 今日视图：展示今日有效日程。
- [ ] 周视图：展示周维度日程网格。
- [ ] 订阅源列表：展示可订阅日程源。
- [ ] 我的页面：登录态、用户信息、提醒入口。

---

## 中期迁移计划

- [ ] Taro 接入新 `CalendarSource` API。
- [ ] 迁移 uni-app 今日页面。
- [ ] 迁移 uni-app 周课表 / 周日程页面。
- [ ] 迁移订阅管理。
- [ ] 迁移提醒设置。
- [ ] 迁移个人事项 / Todo。
- [ ] 对比 Taro 与 uni-app：
  - 首屏速度
  - 包体积
  - 滚动性能
  - 日历网格性能
  - UI 还原度
  - 微信小程序兼容性
- [ ] Taro 稳定后，将 `apps/microapp` 归档或替换。

---

## 长期计划

- [x] 新增 `apps/mobile`，使用 React Native CLI / 原生 RN 工程骨架。
- [ ] RN App 接入共享包和新 Calendar API。
- [ ] RN 实现高质量 iOS / Android 日程体验。
- [ ] 小程序和 RN 共享：
  - 类型模型
  - API client
  - 日程合成逻辑
  - 提醒规则
  - 设计 token
  - 部分业务 view-model
- [ ] 小程序和 RN 分端实现 UI，避免牺牲体验。

---

## UI 组件原则

- 不追求一套 UI 跑所有端。
- 追求一套业务核心跑所有端。
- Taro 使用 `@tarojs/components`。
- RN 使用 `react-native` 组件。
- 核心日历组件分别实现。
- 视觉一致性通过 `packages/ui-tokens` 保证。

示例：

```txt
共享：
  colors
  spacing
  radius
  typography
  event type colors

分端：
  TaroEventCard
  RNEventCard
  TaroWeekCalendar
  RNWeekCalendar
```

---

## 下一步推荐

优先执行：

1. 更新 Roadmap 文档里的 Taro 决策。
已完成首批：

1. 更新 `docs/touchx-calendar-platform-roadmap.md`。
2. 创建 `apps/cms` React CMS 骨架。
3. 创建 `apps/miniapp` Taro 骨架。
4. 创建 `apps/mobile` React Native CLI 骨架。
5. 创建 `packages/ui-tokens` / `packages/calendar-core` / `packages/api-client` / `packages/notification-core`。
6. 接入后端 `/api/v1/calendar/*` 兼容 API。

下一步优先：安装新依赖并更新 lockfile，然后把 `apps/cms` 接入登录页、真实路由和更多 CRUD。
