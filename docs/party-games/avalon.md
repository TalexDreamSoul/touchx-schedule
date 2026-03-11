# 阿瓦隆（10人标准）多人同步策划

## 目标与定位
- 10 人策略博弈，单局 30~45 分钟。
- 重点保证隐藏信息与任务投票的公平性。
- 必须多人在线同步，不提供离线单机。

## 人数与阵营
- 推荐：10 人标准局。
- 正义阵营：梅林、派西维尔、忠臣。
- 邪恶阵营：莫甘娜、刺客、爪牙。

## 核心规则
- 5 轮任务，先达成 3 次成功的一方进入终局判定。
- 每轮：队长组队 -> 全员投票 -> 任务成员暗投成功/失败。
- 10 人局第 4 轮通常要求 2 张失败票才算任务失败。
- 若正义阵营先达成 3 次成功，刺客有一次刺杀梅林机会。

## 房间状态机
- `waiting`
- `setup`
- `team_proposal`
- `team_vote`
- `quest_secret_vote`
- `quest_result`
- `assassin_phase`
- `finished`

## 实时同步设计
### 客户端动作
- `avalon.team.propose`
- `avalon.team.vote`
- `avalon.quest.vote`
- `avalon.assassin.pick-target`

### 服务端事件
- `avalon.private.role-assigned`（单播）
- `avalon.captain.changed`
- `avalon.team.vote.result`
- `avalon.quest.result`
- `avalon.assassin.result`
- `game.finished`

### 同步要点
- 任务票必须保密，仅公布成功/失败张数。
- 组队提案与全员投票严格按阶段切换。
- 连续否决次数由服务端累计并触发规则分支。

## 服务端职责与接口
- 服务端负责阵营可见性控制（谁可看到谁）。
- 服务端保存 `questNo`、`captainSeat`、`rejectCount`、`questLedger`。
- 关键接口：
  - `POST /api/v1/party-games/rooms/{roomId}/actions`
  - `GET /api/v1/party-games/rooms/{roomId}/timeline`

## 客户端交互流程
- 房间页：人数、席位、角色包确认。
- 对局页：
  - 顶部任务进度条（Q1~Q5）。
  - 中部队长提案与投票状态。
  - 底部当前玩家可执行动作。
- 终局页：阵营结果 + 刺杀结果 + 每轮队伍回放。

## 风险与反作弊
- 信息污染：禁止客户端提前看到未公开任务结果。
- 恶意超时：阶段到时自动默认弃权/反对（可配置）。
- 多端同号：同账号仅允许一个在线会话执行动作。

## MVP 与迭代
- MVP：10 人标准规则 + 任务回放 + 断线重连。
- V2：可配置角色包、局内语音快捷语。
- V3：战绩评级、队友协同分析（仅复盘态）。
