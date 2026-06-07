# TouchX 通用日程平台重构 Roadmap

> 状态：规划落地稿，2026-06-01 补充 V1 收口状态
> 当前日期：2026-06-01
> 目标：把 TouchX 从“课表系统”升级为“通用可订阅日程平台 + 多端 App + 多渠道提醒 + 可 Docker 部署的服务端”。

---

## 1. 核心结论

TouchX 后续不再以“班级课表”作为唯一核心，而是升级为：

> 支持多种日程源订阅、个人覆盖修改、智能导入、多渠道提醒、跨端展示的学生日程中心。

新的核心能力：

1. **通用日程源**：班级课表只是 `CalendarSource` 的一种。
2. **订阅系统**：用户可以订阅任意公开 / 班级 / 邀请制日程源。
3. **个人覆盖**：用户可以隐藏某个源事件、关闭某个事件提醒、修改某个事件的个人视图。
4. **个人事项 / Todo**：不再把所有东西塞进课表，支持个人日程、todo、考试、活动、AI 生成事项。
5. **智能导入**：PDF、图片、文本、教务系统都先进入导入任务和候选事件，再由用户 / 管理员确认。
6. **双渠道通知**：不再走公司企业微信，改为微信 ClawDBot + 飞书，可配置策略。
7. **React Native 作为长期移动端主路线**：未来 iOS / Android 高质量原生 App 使用 React Native CLI / 原生 RN 工程，不使用 Expo。
8. **小程序逐步 React 化**：微信小程序不能直接运行 React Native runtime，后续通过 Taro / React 小程序或保留 uni-app 过渡，复用领域包和 API 包。
9. **Docker 服务器部署**：从 Cloudflare Worker + D1 JSON blob 逐步迁移到 Node/Nuxt + PostgreSQL + Redis + Worker。

---

## 2. 当前项目现状

当前仓库已经是 pnpm monorepo：

```txt
apps/
  backend/       # Nuxt 3 后台 API + ScheduleNexus 管理页面
  microapp/      # uni-app 微信小程序
packages/
  shared/        # 共享类型和常量
```

当前配置：

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

现有后端特点：

- `apps/backend` 使用 Nuxt 3 + Nitro。
- 当前 Nitro preset 是 `cloudflare_module`。
- 状态主要存在 `domain-store.ts` 的大 `NexusStore` 中。
- D1 中的 `nexus_state.payload` 是大 JSON blob。
- 后台已从旧 `NexusConsole.vue` 拆成独立 Nuxt 页面，`/nexus/[module]` 仅保留兼容重定向。
- 已有课表版本、订阅、patch、冲突、提醒入队、PDF 导入雏形。

---

## 3. 目标 monorepo 结构

长期目标：

```txt
apps/
  backend/                 # Nuxt：API + 内置后台页面
  microapp/                # 过渡期：uni-app 微信小程序
  mobile/                  # React Native CLI：iOS + Android 原生 App
  miniapp/                 # Taro / React 微信小程序，未来替代 uni-app
  notification-worker/     # 可选：通知投递 worker
  import-worker/           # 可选：PDF / 教务系统导入 worker

packages/
  shared/                  # 通用类型、枚举、常量
  calendar-core/           # 日程源、订阅、合成、冲突、提醒候选等纯函数
  api-client/              # 后台 / 小程序 / RN App 共用 API SDK
  notification-core/       # 通知模板、渠道抽象、提醒策略
  import-core/             # 导入任务、候选事件、解析标准化
  ui-tokens/               # 颜色、间距、圆角、字体、主题 token
  config/                  # tsconfig / eslint 等统一配置，可选
```

短期先新增：

```txt
packages/calendar-core/
packages/api-client/
packages/notification-core/
```

等业务稳定后再新增：

```txt
apps/mobile/
apps/notification-worker/
apps/import-worker/
```

---

## 4. RN 与小程序技术路线

### 4.1 决策

移动端长期路线选择：

```txt
iOS / Android App：React Native CLI / 原生 RN 工程，不使用 Expo
微信小程序：短期继续 uni-app，长期迁移到 React/Taro 小程序或同构 React 体系
```

### 4.2 为什么选择 RN

React Native CLI / 原生 RN 工程适合后续目标：

- 原生性能和交互体验更好。
- 更容易做高质量日历视图、动画、手势、触感反馈。
- 能接 iOS 系统特性：Widget、Live Activities、本地通知、App Intents、快捷指令、系统日历等。
- 可复用 TypeScript packages：`shared`、`calendar-core`、`api-client`、`notification-core`。
- Android / iOS 双端统一开发。

### 4.3 关于“小程序也用 RN”

需要明确：

> 微信小程序不能直接运行 React Native runtime。

所以“小程序 RN 化”不能理解成把 RN App 直接编译成微信小程序。可行路线是：

1. **短期**：继续保留 `apps/microapp` 的 uni-app，保证现有微信小程序稳定。
2. **中期**：继续建设现有 `apps/miniapp`，使用 Taro / React 小程序技术栈。
3. **长期**：RN App 和 React 小程序共享：
   - 领域模型：`packages/shared`
   - 日程计算：`packages/calendar-core`
   - API SDK：`packages/api-client`
   - 主题 token：`packages/ui-tokens`
   - 部分业务 hooks / view-model
4. **UI 层分端适配**：RN 使用 React Native 组件，小程序使用 Taro / 小程序组件，不能完全共用同一套 UI 组件。

目标不是“一份 UI 到所有端”，而是：

```txt
共享核心逻辑 + 分端高质量 UI
```

### 4.4 桌面版与跨平台边界

TouchX 的桌面版短期不单独启动 Electron / Tauri 工程，先把桌面体验定义为 `apps/backend` 内置 Nexus Web 管理台：

- **桌面后台**：面向管理员、运营和导入审核，继续走 Nuxt 页面，保持 `/`、`/nexus/**` 和 `/api/**` 的页面 / API 边界。
- **桌面学生端**：V1 不新增单独工程；如需要浏览器访问学生日程，优先复用 Calendar API 和 `@touchx/api-client` 做轻量 Web/PWA 页面，而不是复制小程序逻辑。
- **跨平台共享层**：只共享领域模型、日程计算、API SDK、通知模型、导入模型和设计 token；不共享具体 UI 组件。
- **平台 UI 层**：后台 Web 使用 shadcn 风格的密集工作台；RN 使用 iOS / Android 原生交互；Taro 小程序使用微信生态轻量入口；旧 uni-app 只作为迁移参照。

这条边界避免“一套 UI 编译所有端”的高复杂度，同时保证业务规则、接口契约和主题语义是一套。

### 4.5 设计主题映射

整体设计主题以 `packages/ui-tokens` 为源头，分为两层：

1. **语义 token**：`background`、`foreground`、`card`、`muted`、`border`、`primary`、`destructive` 和 `calendarEventColors`，由所有端引用或映射。
2. **平台表现 token**：后台映射为 shadcn 黑白灰工作台；iOS 映射为 Liquid Glass / native stack / bottom tabs；Android 映射为 elevation / ripple / state layer；小程序映射为轻量卡片、周视图和微信控件约束。

后续新增端侧样式时优先从 token 映射，端内只保留平台必要的布局尺寸、状态反馈和组件限制。若端侧需要新增颜色，先判断是否应进入 `packages/ui-tokens`，避免 miniapp、mobile、Nexus 各自发散。

---

## 5. 通用日程领域模型

### 5.1 CalendarSource：日程源

日程源是所有可订阅时间表的统一抽象。

```ts
export type CalendarSourceType =
  | "class_schedule"       // 班级课表
  | "exam_schedule"        // 考试安排
  | "school_calendar"      // 校历
  | "club_activity"        // 社团活动
  | "organization_event"   // 组织活动
  | "public_calendar"      // 公开日历
  | "academic_system"      // 教务系统导入
  | "pdf_import"           // PDF 导入
  | "manual_collection"    // 手工维护合集
  | "personal_template"    // 个人模板
  | "custom";
```

```ts
export interface CalendarSource {
  id: string;
  type: CalendarSourceType;
  title: string;
  description: string;
  ownerType: "system" | "class" | "user" | "organization";
  ownerId: string;
  timezone: string;
  visibility: "public" | "class_only" | "invite_only" | "private";
  status: "draft" | "published" | "archived";
  currentVersionId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### 5.2 CalendarSourceVersion：日程源版本

```ts
export interface CalendarSourceVersion {
  id: string;
  sourceId: string;
  versionNo: number;
  status: "draft" | "published" | "deprecated";
  changeSummary: string;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
}
```

### 5.3 CalendarSourceEvent：源事件

```ts
export type CalendarEventType =
  | "course"
  | "exam"
  | "todo"
  | "activity"
  | "holiday"
  | "deadline"
  | "custom";
```

```ts
export interface CalendarSourceEvent {
  id: string;
  sourceId: string;
  versionId: string;
  title: string;
  description: string;
  eventType: CalendarEventType;
  location: string;
  teacherOrOwner: string;
  recurrenceType: "weekly" | "date" | "range";
  weekday?: number;
  weekExpr?: string;
  parity?: "all" | "odd" | "even";
  date?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  tags: string[];
  metadata: Record<string, unknown>;
}
```

### 5.4 CalendarSubscription：用户订阅

```ts
export interface CalendarSubscription {
  id: string;
  userId: string;
  sourceId: string;
  sourceVersionId: string;
  followMode: "auto" | "manual_review" | "pinned_version";
  status: "active" | "paused" | "cancelled";
  defaultReminderEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 5.5 UserEventOverride：个人覆盖

```ts
export interface UserEventOverride {
  id: string;
  userId: string;
  sourceEventId: string;
  action: "hide" | "modify" | "reminder_only";
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  reminderRules?: ReminderRule[];
  reason?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 5.6 PersonalEvent：个人事项 / Todo

```ts
export interface PersonalEvent {
  id: string;
  userId: string;
  title: string;
  description: string;
  eventType: "todo" | "note" | "exam" | "activity" | "custom";
  status: "pending" | "done" | "cancelled" | "archived";
  priority: "low" | "normal" | "high";
  date?: string;
  weekday?: number;
  weekExpr?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  dueAt?: string;
  tags: string[];
  source: "manual" | "ai" | "pdf" | "academic_system" | "bot";
  createdAt: string;
  updatedAt: string;
}
```

### 5.7 EffectiveCalendarEvent：最终展示事件

客户端最终不直接消费 `CalendarSourceEvent`，而是消费后端 / core 合成后的有效事件：

```ts
export interface EffectiveCalendarEvent {
  id: string;
  originType: "source" | "personal" | "activity" | "system";
  originId: string;
  sourceId?: string;
  subscriptionId?: string;
  title: string;
  description: string;
  eventType: CalendarEventType;
  date?: string;
  weekday?: number;
  weekExpr?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  location: string;
  tags: string[];
  reminderEnabled: boolean;
  overrideState: "none" | "hidden" | "modified" | "reminder_only";
  metadata: Record<string, unknown>;
}
```

---

## 6. 通知与提醒目标模型

### 6.1 通知渠道

```ts
export type NotificationChannelType = "wechat_clawdbot" | "feishu";
```

```ts
export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: {
    webhookUrl?: string;
    appId?: string;
    appSecret?: string;
    tenantKey?: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

### 6.2 用户渠道绑定

```ts
export interface UserNotificationBinding {
  id: string;
  userId: string;
  channelType: NotificationChannelType;
  externalUserId: string;
  externalOpenId?: string;
  externalUnionId?: string;
  status: "active" | "disabled" | "expired";
  createdAt: string;
  updatedAt: string;
}
```

### 6.3 提醒规则

```ts
export interface ReminderRule {
  id: string;
  targetType: "subscription" | "source_event" | "personal_event" | "global";
  targetId: string;
  enabled: boolean;
  offsetMinutes: number;
  templateKey: string;
  channelStrategy: "both" | "primary_then_fallback" | "primary_only";
  quietHoursRespect: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 6.4 投递记录

```ts
export interface NotificationDelivery {
  id: string;
  userId: string;
  channelType: NotificationChannelType;
  templateKey: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  dedupeKey: string;
  scheduledAt: string;
  sentAt?: string;
  externalMessageId?: string;
  errorMessage?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. 导入系统目标模型

### 7.1 ImportJob

```ts
export interface ImportJob {
  id: string;
  type: "pdf" | "image" | "academic_system" | "text" | "manual";
  status: "uploaded" | "parsing" | "parsed" | "reviewing" | "committed" | "failed";
  ownerUserId: string;
  targetSourceId?: string;
  fileObjectKey?: string;
  rawText?: string;
  parserVersion: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 7.2 ImportCandidateEvent

```ts
export interface ImportCandidateEvent {
  id: string;
  jobId: string;
  title: string;
  eventType: CalendarEventType;
  location: string;
  weekday?: number;
  weekExpr?: string;
  startSection?: number;
  endSection?: number;
  date?: string;
  confidence: number;
  warnings: string[];
  rawPayload: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected" | "corrected";
}
```

导入流程：

```txt
上传 PDF / 图片 / 文本 / 教务系统同步
  -> ImportJob
  -> 解析
  -> ImportCandidateEvent[]
  -> 用户 / 管理员审核修正
  -> 提交到 CalendarSourceVersion 或 PersonalEvent
```

---

## 8. 后台重构目标

旧 `NexusConsole.vue` 已拆分并删除。

新决策：独立 `apps/cms` 已移除，后台统一收敛到 `apps/backend` 内置 Nuxt 页面。`/` 是主 Dashboard，`/nexus/**` 作为后台兼容路径；`/nexus/[module]` 仅保留旧模块别名重定向，新页面统一位于 `apps/backend/app/pages/nexus` 并使用 shadcn 简约风格。

目标后台模块：

```txt
Dashboard
Users
Classes
Calendar Sources
Calendar Source Versions
Calendar Source Events
Subscriptions
User Overrides
Personal Events / Todo
Reminders
Notification Channels
Import Center
Audit Logs
```

建议目录：

```txt
apps/backend/app/
  pages/nexus/
    index.vue
    users.vue
    classes.vue
    calendar-sources.vue
    subscriptions.vue
    reminders.vue
    notification-channels.vue
    imports.vue
    foods.vue
    media.vue
    bots.vue
    campaigns.vue
    heart-open-word-bank.vue
    audit.vue
  components/nexus/
    layout/
    users/
    classes/
    calendar-sources/
    subscriptions/
    reminders/
    notification/
    imports/
    shared/
  composables/nexus/
    useNexusApi.ts
    useNexusTable.ts
    useNexusToast.ts
```

---

## 9. Docker 部署目标

### 9.1 起步架构

```txt
backend       # Nuxt API + 内置后台
postgres      # 主数据库
redis         # 队列 / 缓存 / 分布式锁
worker        # 通知和导入任务 worker，可先合并一个
```

### 9.2 后续 docker-compose 目标

```yaml
services:
  postgres:
    image: postgres:16

  redis:
    image: redis:7

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    environment:
      DATABASE_URL: postgres://touchx:password@postgres:5432/touchx
      REDIS_URL: redis://redis:6379
    ports:
      - "9986:9986"
    depends_on:
      - postgres
      - redis

  worker:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    command: ["node", ".output/server/worker.mjs"]
    environment:
      DATABASE_URL: postgres://touchx:password@postgres:5432/touchx
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
```

### 9.3 Nitro preset

当前是 Cloudflare preset。后续 Docker 需要支持：

```ts
nitro: {
  preset: process.env.NITRO_PRESET || "node-server"
}
```

迁移时需要兼容 Cloudflare 和 Node 部署，避免一次性切断现有部署。

---

## 10. 分阶段 Roadmap

## Phase 0：规划与边界确认

目标：把方向固化为文档和代码边界。

任务：

- [x] 落地本 Roadmap 文档。
- [x] 确认通用日程源模型命名。
- [x] 确认 React Native CLI / 原生 RN 工程作为未来 App 主路线，不使用 Expo。
- [x] 确认小程序迁移策略：uni-app 过渡，未来 Taro / React 小程序。
- [ ] 确认 Docker 部署目标：Nuxt node-server + PostgreSQL + Redis。

验收标准：

- 团队后续所有开发以 `CalendarSource` 而不是 `Schedule` 作为新核心概念。
- 新功能优先写入 `packages/*`，避免继续堆进旧大文件。

---

## Phase 1：共享模型与 calendar-core

目标：先新增通用模型和纯函数，不破坏现有业务。

任务：

- [x] 在 `packages/shared` 拆分文件：
  - `calendar.ts`
  - `notification.ts`
  - `import.ts`
  - `index.ts` 统一导出
- [x] 新增 `packages/calendar-core`。
- [x] 实现纯函数：
  - `applyUserEventOverrides`
  - `resolveEffectiveCalendarEvents`
  - `detectCalendarConflicts`
  - `expandRecurringEvents`
  - `resolveReminderCandidates`
- [x] 为 core 增加基础测试。

验收标准：

- 不依赖 Nuxt / uni-app / RN。
- 后台、小程序、未来 RN App 均可引用。
- 旧 `Schedule` 数据可以被映射为新 `CalendarSource` 视角。

---

## Phase 2：后端 Calendar Module 兼容层

目标：在不重写数据库的前提下，先提供新 API 视角。

任务：

- [x] 新增：

```txt
apps/backend/server/modules/calendar/
  calendar-adapter.ts
  calendar-source-service.ts
  effective-calendar-service.ts
  calendar-subscription-service.ts
```

- [x] 兼容映射：
  - `ScheduleRecord` -> `CalendarSource`
  - `ScheduleVersion.entries` -> `CalendarSourceEvent`
  - `ScheduleSubscription` -> `CalendarSubscription`
  - `SchedulePatch` -> `UserEventOverride`
  - `UserScheduleEvent` -> `PersonalEvent`
- [x] 新增 API：
  - `GET /api/v1/calendar/sources`
  - `GET /api/v1/calendar/sources/:id`
  - `GET /api/v1/calendar/me/effective`
  - `GET /api/v1/calendar/me/subscriptions`
  - `POST /api/v1/calendar/sources/:id/subscribe`

验收标准：

- 旧小程序不受影响。
- 新 API 可以用通用日程源视角读取当前课表数据。
- 后台可以先读取新 API 做“日程源”页面。

---

## Phase 3：后台拆分第一轮

目标：停止继续扩张并移除 `NexusConsole.vue`。

任务：

- [x] 新增 `/nexus/calendar-sources` 页面。
- [x] 新增 `/nexus/notification-channels` 页面。
- [x] 新增 `/nexus/imports` 页面雏形。
- [x] 新增后台投递记录页面，支持查看 `NotificationDelivery` 与手动投递 pending。
- [x] 新增 Nuxt `/nexus/notification-deliveries` 页面，覆盖 Worker 交付路径。
- [x] 新增 Nuxt 审计日志页面，支持查看关键操作 audit logs。
- [x] 抽出通用后台 shell：
  - sidebar
  - topbar
  - panel
  - table
  - modal
- [x] 新增 Nuxt `/nexus/users`、`/nexus/classes`、`/nexus/schedules`、`/nexus/schedule-import`、`/nexus/preview`、`/nexus/settings` 页面。
- [x] 新增 Nuxt `/nexus/foods`、`/nexus/media`、`/nexus/bots`、`/nexus/campaigns`、`/nexus/heart-open-word-bank` 页面。
- [x] 删除旧 `NexusConsole.vue`，`/nexus/[module]` 改为兼容重定向。
- [ ] 把旧 `schedules` 模块逐步替换为 `calendar-sources` 视角。

验收标准：

- 新增模块不再写进 `NexusConsole.vue`。
- 旧 `NexusConsole.vue` 已删除；旧模块路径通过 `/nexus/[module]` 自动重定向。
- 日程源列表可以展示：源类型、可见性、订阅数、当前版本、事件数。

---

## Phase 4：通知通道重构

目标：不再走公司企业微信，支持微信 ClawDBot + 飞书。

任务：

- [x] 新增 `packages/notification-core`。
- [x] 定义：
  - `NotificationChannel`
  - `UserNotificationBinding`
  - `NotificationDelivery`
  - `ReminderRule`
- [x] 后端新增通知 service：
  - `notification-channel-service.ts`
  - `notification-delivery-service.ts`
  - `wechat-clawdbot-adapter.ts`
  - `feishu-adapter.ts`
- [x] ReminderRule 后台 + API 基线。
- [x] ReminderCandidate 生成与 NotificationDelivery 入队 API / 后台基线。
- [x] 投递策略支持：
  - `both`
  - `primary_then_fallback`
  - `primary_only`
- [x] 支持 pending delivery 手动 dispatch 与 webhook adapter 基线。
- [x] 后台支持配置渠道和测试发送（已接真实 webhook / 飞书应用 adapter）。
- [x] 后台支持查看投递记录、失败信息、重试次数与外部消息 ID。
- [x] 飞书 provider 支持两种接入方式：
  - 自定义机器人 webhook：`provider=webhook_bot` + `webhookUrl`。
  - 企业自建应用：`provider=tenant_app` + `appId/appSecret` + `receiveIdType/defaultReceiveId`。
- [x] 飞书应用 provider 支持获取 `tenant_access_token` 并调用 `/im/v1/messages` 发送文本消息。
- [x] 飞书机器人签名发送支持 timestamp/sign 计算。
- [x] reminder candidate 入队使用统一 `resolveChannelOrder` 处理 `both` / `primary_only` / `primary_then_fallback`。
- [x] 飞书应用接收人绑定从全局 `defaultReceiveId` 升级为用户级 binding。
- [x] 本地默认 reminder delivery 已迁移为通用 `notification_deliveries`，旧 `schedule_reminder_deliveries` 仅作为显式 `legacy` fallback 保留。

验收标准：

- 提醒不再依赖旧企业微信绑定逻辑。
- ClawDBot 和飞书可以同时配置。
- 飞书可选择机器人 webhook 或企业自建应用 provider。
- 失败投递可 fallback、可审计。

---

## Phase 5：PersonalEvent / Todo 能力

目标：日程不再只有课表，用户可以管理个人事项。

任务：

- [x] 新增个人事项 API：
  - `GET /api/v1/calendar/me/personal-events`
  - `POST /api/v1/calendar/me/personal-events`
  - `PATCH /api/v1/calendar/me/personal-events/:id`
  - `POST /api/v1/calendar/me/personal-events/:id/done`
- [x] 支持 todo 状态：pending / done / archived（cancelled 待补）。
- [x] 支持手动来源，并可由导入候选提交为个人事项。
- [ ] 支持 AI / PDF 直接创建个人事项。
- [x] 小程序先接入简单 todo 创建与今日视图展示。
- [x] 后台先接入简单 todo 创建、完成、归档。

验收标准：

- 用户今日视图能同时展示课程、订阅事件、个人 todo。
- todo 可以完成 / 取消。
- 个人事件进入提醒候选逻辑。

---

## Phase 6：导入中心升级

目标：PDF / 教务系统导入不再直接写课表，而是先生成候选事件。

任务：

- [x] 新增 `packages/import-core`。
- [x] 定义 `ImportJob` 和 `ImportCandidateEvent`。
- [x] 后台导入中心兼容读取现有 PDF 导入任务。
- [x] 旧 PDF 导入可转换为候选事件。
- [x] 候选事件支持审核、修正、接受 / 拒绝。
- [x] 候选事件支持提交到日程源或个人事件。
- [x] 新导入中心支持上传 PDF 到旧解析队列，并转入候选事件审核流。
- [ ] 图片 OCR / 教务系统导入入口产品化。
- [ ] 为教务系统预留 connector：
  - 登录态 / cookie
  - 拉取课程
  - 标准化
  - 差异比较

验收标准：

- PDF 导入结果可审核、可修正、可回放。
- 同一套候选事件模型可服务 PDF 和教务系统。

---

## Phase 7：React Native App 起步

目标：建立未来 iOS / Android 主 App。

任务：

- [x] 新增 `apps/mobile` 骨架。
- [x] 使用 React Native CLI / 原生 RN 工程，不使用 Expo。
- [x] 接入：
  - `packages/shared`
  - `packages/calendar-core`
  - `packages/api-client`
  - `packages/ui-tokens`
- [ ] 首屏能力：
  - 登录
  - 今日视图
  - 周视图
  - 订阅源列表
  - 个人 todo
  - 提醒设置
- [ ] 设计 iOS 优先的交互：
  - native stack
  - bottom tabs
  - sheet
  - haptic feedback
  - local notification 预研

验收标准：

- RN App 可以读取后端新 calendar API。
- 今日视图和周视图体验优于小程序。
- 核心业务逻辑来自共享包，而不是 App 内重复实现。

---

## Phase 8：小程序 React 化迁移预研

目标：为未来替代 uni-app 小程序做准备。

任务：

- [x] 评估 Taro React 小程序。
- [x] 新增 `apps/miniapp` PoC。
- [x] 接入共享包。
- [x] 复刻最小页面：
  - 今日视图
  - 周视图
  - 订阅源列表
- [x] 接入学号登录、日程源订阅和个人 Todo 的 V1 用户闭环。
- [ ] 对比 uni-app：
  - 包体积
  - 首屏性能
  - 滚动性能
  - UI 还原度
  - 开发效率

验收标准：

- 明确是否用 Taro / React 替代 uni-app。
- 明确哪些 UI 可以与 RN 共享设计，哪些必须分端实现。

### Phase 8.1：小程序 parity 收口

目标：把 `apps/miniapp` 从 PoC 推到可替代 `apps/microapp` 的主线候选。

任务：

- [ ] 今日 / 周视图覆盖真实 API 的 loading、empty、error、未登录、已登录状态。
- [ ] 个人资料、通知绑定、PDF 导入和自定义日程源发布全部通过真实 API 闭环。
- [ ] 对 `apps/microapp` 高频入口建立 Taro 对应页，不能覆盖的入口写入 V1 defer 决策。
- [ ] 小程序主题统一从 `packages/ui-tokens` 映射出页面变量，端侧只保留微信小程序布局差异。
- [ ] 每次替换判断前运行 `pnpm verify:v1-release` 并补一次 WeChat DevTools 手工 smoke。

验收标准：

- `apps/miniapp` 可以独立完成学生核心日程、订阅、导入、通知和 profile 流程。
- `apps/microapp` 的归档或替换有清晰证据，而不是按技术偏好强行切换。

## Phase 8.2：桌面版 / Web 工作台细化

目标：让桌面体验先服务管理和运营效率，再评估学生端 Web/PWA。

任务：

- [x] Nexus 后台统一收敛到 `apps/backend` 内置 Nuxt 页面。
- [x] 后台页面复用 `NexusAdminShell` / `NexusDashboard`，共享 `.rx-*` 基础类由 smoke gate 固化。
- [ ] 将 Calendar Source 版本、订阅、用户覆盖、导入候选和通知投递继续拆成高密度工作台页面。
- [ ] 对导入审核、通知失败重试、用户订阅排查补批量操作和审计入口。
- [ ] 学生 Web/PWA 只在 miniapp/RN 核心流程稳定后评估，优先复用 `@touchx/api-client` 和 `packages/ui-tokens`。

验收标准：

- 桌面版管理台是可重复运营的工作界面，不是移动端页面放大版。
- 新后台功能不得回流旧 `NexusConsole`，不得绕过 `/api/**` 和 `/nexus/**` 边界。

---

## Phase 9：Docker + PostgreSQL 迁移

目标：服务器部署正式化。

任务：

- [ ] 后端支持 `NITRO_PRESET=node-server`。
- [ ] 增加 `apps/backend/Dockerfile`。
- [ ] 增加 `docker-compose.yml`。
- [ ] 引入 PostgreSQL schema：
  - users
  - classes
  - calendar_sources
  - calendar_source_versions
  - calendar_source_events
  - calendar_subscriptions
  - user_event_overrides
  - personal_events
  - notification_channels
  - notification_deliveries
  - import_jobs
  - import_candidate_events
  - audit_logs
- [ ] 编写 D1 JSON blob -> PostgreSQL 迁移脚本。
- [ ] 增加 Redis 队列或轻量 job runner。

验收标准：

- 本地 `docker compose up` 可以跑起后端、数据库和 worker。
- 生产部署不再依赖 Cloudflare D1。
- 旧 Cloudflare 部署可作为过渡保留。

---

## 11. 推荐近期开发顺序

接下来建议按这个顺序做：

```txt
1. V1 收口：聚焦 backend 内置后台 + 通知渠道，不再扩大 RN/小程序迁移范围
2. 外部验收：用生产 ClawDBot / 飞书配置跑真实投递 smoke，用真实 PDF 样本跑解析质量门禁
3. 安全收口：本地已补 logout 撤销策略与 CalendarSource 私有详情权限；生产 session secret / 管理员密码已纳入 smoke 门禁
4. 数据收敛：将 notification queue 默认模式灰度到生产，确认旧 schedule_reminder_deliveries 不再承载新投递
5. 小程序迁移：apps/miniapp 继续补齐 parity gates，apps/microapp V1 仍保留线上稳定参照
6. 验证门槛：focused type-check / build / node tests / smoke / git diff --check
7. V1 后：Docker + PostgreSQL + Redis 迁移、RN 正式版、教务系统 connector
```

截至 2026-06-01，后端 `/api/v1/*` 主入口已完成 handler/service 拆分，`v1-api.ts` 主要保留入口校验、兼容路由委托、统一分发和 error boundary，当前约 508 行，并由 `smoke:api-boundaries` 固定行数预算和模块委托边界。旧兼容 `social-v1-api.ts` 已按子域拆分，`/api/v1/notifications*`、ClawDBot simulate / webhook、AI chat / OCR preview-confirm / schedule parse-commit、`social/circles*`、`social/me` / users search / subscription requests / subscriptions、`social/subscribe*`、social activity / free-heatmap / smart lead、food candidate / admin food candidate 非上传路由、`social/food-campaigns*`、auth/profile/bind-student/upload/schedules-student 等账号资料尾部路由、`ai/attachments` / `social/food-candidates/evidence` 上传边界，以及 exams/calendar/today brief/theme images/schedule corrections 尾部接口已迁入 legacy handlers。legacy 共享状态、持久化 snapshot hydrate / serialize、通知绑定兼容判断已迁入 `legacy-state`，用户查找、绑定目标、展示名、ClawDBot 用户创建 helper 已迁入 `legacy-user-utils`，社交订阅边同步、可见性、通知去重、候选日程冲突 helper 已迁入 `legacy-social-utils`，error/auth/session/env/url/audit/exam date/path 运行时 helper 已迁入 `legacy-runtime-utils`，`social-v1-api.ts` 收敛到约 318 行。后台页面已统一复用 `NexusAdminShell` / `NexusDashboard`，共享 `.rx-*` 基础类和旧 `NexusConsole` 不回流由 `smoke:admin-ui-boundaries` 固化。`apps/miniapp` 与 `apps/mobile` 核心 API wrapper 已收敛到 `@touchx/api-client`，API base URL 均支持运行时或环境变量覆盖，解析优先级已由 `api-client` focused tests 覆盖；通知提醒本地默认写入通用 `notificationDeliveries`，旧 `schedule_reminder_deliveries` 仅在显式 `NEXUS_REMINDER_DELIVERY_QUEUE=legacy` 时作为兼容 fallback；logout 撤销态与 CalendarSource 私有详情权限已补 focused 回归，旧 D1 payload 缺少新增顶层集合字段时会统一补齐，已存在但损坏的 D1 payload 会中止请求以避免被 bootstrap 覆盖，生产 smoke 脚本已增加 bootstrap 管理员密码初始化、弱 fallback session token 拒绝检查、ClawDBot webhook 入站门禁、ClawDBot + 飞书双通道外部投递门禁、真实 PDF 解析质量门禁和 opt-in logout 撤销门禁，生产聚合 gate 会先跑本地真实 PDF smoke 并拒绝非本地 `SMOKE_BASE_URL`，同时拒绝本地/私网 `TOUCHX_SMOKE_BASE_URL`，避免导入 smoke 误写生产数据或把本地/内网 API 当生产验收，Cloudflare 配置静态 smoke 已覆盖 D1/R2/Queue binding、Cron 和 migration 文件。最近本地 gate：`pnpm --filter @touchx/backend verify:v1-local` 通过，覆盖 backend type-check、后端 node tests 231/231、api-client tests、calendar-core tests、miniapp / mobile type-check、`smoke:api-boundaries`、`smoke:admin-ui-boundaries`、`smoke:client-boundaries`、`smoke:data-boundaries`、`smoke:cloudflare-config`、`bash -n apps/backend/scripts/smoke-*.sh`、`git diff --check`；`pnpm --filter @touchx/miniapp build:weapp` 已通过，根命令 `pnpm verify:v1-release` 用于发版前串起本地 gate 和 Taro 小程序构建。

V1 收口功能清单、生产验收材料、验收命令和建议提交批次见 `docs/v1-closeout-status.md`。

短期不要做：

- 不要立刻删除旧 Schedule 模型。
- 不要立刻重写小程序。
- 不要立刻全量迁移数据库。
- 不要继续把新后台功能塞进 `NexusConsole.vue`。

---

## 12. 第一轮具体落地任务清单

第一轮 PR / 开发批次建议：

### Batch 1：类型与包结构

- [x] `packages/shared/src/calendar.ts`
- [x] `packages/shared/src/notification.ts`
- [x] `packages/shared/src/import.ts`
- [x] `packages/shared/src/index.ts` 导出上述模块
- [x] `packages/calendar-core/package.json`
- [x] `packages/calendar-core/src/index.ts`
- [x] `packages/calendar-core/src/effective-calendar.ts`
- [x] `packages/calendar-core/src/overrides.ts`
- [x] `packages/calendar-core/src/conflicts.ts`

### Batch 2：后端兼容 API

- [x] `apps/backend/server/modules/calendar/calendar-adapter.ts`
- [x] `apps/backend/server/modules/calendar/effective-calendar-service.ts`
- [x] `GET /api/v1/calendar/sources`
- [x] `GET /api/v1/calendar/me/effective`

### Batch 3：后台新页面

- [x] `/nexus/calendar-sources`
- [x] sidebar 增加“日程源”入口
- [x] 日程源列表使用新 API

### Batch 4：通知通道

- [x] `packages/notification-core`
- [x] `wechat-clawdbot-adapter`
- [x] `feishu-adapter`
- [x] 后台通知渠道配置页面
- [x] 后台投递记录与 pending 手动 dispatch 页面

---

## 13. 长期原则

1. **新概念用 Calendar，不再用 Schedule 命名作为核心。**
2. **业务逻辑尽量进 packages，不绑定某个端。**
3. **UI 分端实现，领域逻辑共享。**
4. **旧系统通过 adapter 兼容，避免一次性推倒。**
5. **通知、导入、提醒都用队列化和可审计模型。**
6. **Docker 化前先稳定领域模型。**
7. **RN App 追求高质量体验，小程序追求轻量入口和微信生态触达。**
