# 狼人杀（快节奏局）多人同步策划

## 目标与定位
- 面向 10 人社交局，单局 35~50 分钟。
- 强调节奏快、信息清晰、主持负担低。
- 必须为多人同步在线对局，不支持离线单机。

## 人数与角色配置
- 标准人数：10 人。
- 角色：`2 狼人 + 1 预言家 + 1 女巫 + 1 猎人 + 5 平民`。
- 发言限制：白天每人 45 秒，超时自动过麦。

## 核心规则
- 夜晚顺序：狼人行动 -> 预言家验人 -> 女巫救/毒 -> 公布夜晚结果。
- 白天流程：发言 -> 投票 -> 出局结算。
- 第 2 天起允许 20 秒遗言。
- 胜负：狼人阵营全灭则好人胜；狼人数量达到好人数量则狼人胜。

## 房间状态机
- `waiting`：等待玩家准备。
- `setup`：发身份、发私密信息。
- `night_wolf`：狼人选择击杀目标。
- `night_seer`：预言家验人。
- `night_witch`：女巫使用解药/毒药。
- `dawn`：公布夜晚信息。
- `day_discussion`：轮流发言。
- `day_vote`：白天公投。
- `settlement`：技能结算（含猎人开枪）。
- `finished`：结果展示与回放入口。

## 实时同步设计
### 客户端动作（Action）
- `room.ready.toggle`
- `werewolf.kill.select`
- `werewolf.seer.check`
- `werewolf.witch.use-antidote`
- `werewolf.witch.use-poison`
- `werewolf.vote.submit`
- `werewolf.hunter.shoot`

### 服务端广播（Event）
- `room.snapshot`
- `game.phase.changed`
- `werewolf.private.role-assigned`（单播）
- `werewolf.private.seer-result`（单播）
- `werewolf.vote.progress`
- `werewolf.vote.result`
- `game.finished`

### 同步原则
- 夜晚私密动作只对角色本人可见。
- 公投阶段只广播“已投人数”，不广播票向，避免带节奏。
- 计时统一由服务端推进，客户端仅显示剩余时间。

## 服务端职责与接口草案
- 角色发放、夜晚结算、公投裁决全部由服务端执行。
- 服务端维护 `alivePlayers`、`roleState`、`dayNo`、`voteLedger`。
- 关键接口：
  - `POST /api/v1/party-games/rooms/{roomId}/actions`
  - `GET /api/v1/party-games/rooms/{roomId}`
  - `GET /api/v1/party-games/rooms/{roomId}/events`

## 客户端交互流程
- 房间页：座位、准备、在线状态、房主开局。
- 对局页：
  - 顶部：阶段 + 倒计时。
  - 中部：玩家席位与存活状态。
  - 底部：当前角色可操作面板。
- 结算页：阵营胜负、关键回合、操作回放。

## 风险与反作弊
- 串通与外挂：禁止客户端本地保存完整身份表。
- 窥屏风险：夜晚动作 UI 采用短时可见后遮罩。
- 重放攻击：`clientActionId` 幂等去重。
- 拖时行为：阶段超时自动兜底（默认弃权/不发动技能）。

## MVP 与迭代
- MVP：标准 10 人局、文字投票、自动计时、断线重连。
- V2：语音主持模式、观战席、自定义角色包。
- V3：战绩系统、分层匹配、反作弊风控评分。
