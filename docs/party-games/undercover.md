# 谁是卧底（双卧底版）多人同步策划

## 目标与定位
- 8~10 人快速推理，单局 20~30 分钟。
- 双卧底提高博弈强度，减少“秒猜”无聊局。
- 必须多人实时同步，不提供离线单机流程。

## 人数与词条
- 推荐人数：8~10 人。
- 阵营：平民 + 双卧底。
- 词条：平民词与卧底词语义相近，难度可配置。

## 核心规则
- 开局私发词条。
- 每轮每人一句描述（限时）。
- 全员投票淘汰 1 人。
- 第 3 轮起可开启“盲投回合”（不复述直接投票）。
- 胜负：卧底全部淘汰则平民胜；卧底人数达到平民人数则卧底胜。

## 房间状态机
- `waiting`
- `setup`（发词）
- `clue_round`（描述）
- `vote_round`（投票）
- `elimination_reveal`（公布淘汰）
- `finished`

## 实时同步设计
### 客户端动作
- `undercover.clue.submit`
- `undercover.vote.submit`
- `undercover.host.toggle-blind-vote`

### 服务端事件
- `undercover.private.word-assigned`（单播）
- `undercover.turn.changed`
- `undercover.vote.progress`
- `undercover.player.eliminated`
- `game.finished`

### 同步要点
- 发言顺序由服务端生成，客户端不可本地改位。
- 投票截止前只显示“已投人数”，不显示票向。
- 被淘汰玩家转旁观态，只读房间事件。

## 服务端职责与接口
- 词条抽取与阵营分配由服务端完成。
- 服务端维护 `roundNo`、`blindVoteEnabled`、`aliveSet`。
- 关键接口：
  - `POST /api/v1/party-games/rooms/{roomId}/actions`
  - `GET /api/v1/party-games/rooms/{roomId}/scoreboard`

## 客户端交互流程
- 房间页显示词库难度、盲投开关、准备状态。
- 对局页分三块：
  - 当前轮发言队列。
  - 发言内容流（按轮次折叠）。
  - 投票面板。
- 结算页展示每轮投票热力图与关键词复盘。

## 风险与反作弊
- 文本泄露：词条仅单播并避免缓存到公共状态。
- 串麦提示：同 IP 高频聊天可做风控标记（不拦截，仅告警）。
- 恶意刷票：每轮每人仅一次有效投票，重复提交覆盖同一票。

## MVP 与迭代
- MVP：双卧底 + 限时发言 + 盲投开关。
- V2：词库分层、主持模板、自动复盘文案。
- V3：AI 主持词条推荐与难度动态调节。
