# 你画我猜（接力版）多人同步策划

## 目标与定位
- 8~10 人协作娱乐，单局 20~35 分钟。
- 接力模式：画图与猜词交替，强调实时互动。
- 必须多人同步在线，不支持离线单机。

## 人数与玩法
- 推荐人数：8~10。
- 回合结构：`画 -> 猜 -> 画 -> 猜` 接力若干轮。
- 每轮有固定倒计时，超时自动提交当前结果。

## 核心规则
- 系统私发词条给绘图玩家。
- 绘图玩家在画布作画，其他玩家不可见词条。
- 指定猜词玩家提交猜测，下一轮以猜测词继续。
- 最终公开完整链路，对比原词和最终词。

## 房间状态机
- `waiting`
- `setup`
- `draw_turn`
- `guess_turn`
- `relay_next`
- `final_reveal`
- `finished`

## 实时同步设计
### 客户端动作
- `draw.stroke.append`
- `draw.stroke.undo`
- `draw.turn.submit`
- `guess.turn.submit`

### 服务端事件
- `draw.private.word-assigned`（单播）
- `draw.canvas.patch`
- `draw.turn.timeout`
- `guess.turn.result`
- `draw.chain.revealed`
- `game.finished`

### 同步要点
- 画布采用增量笔画（stroke patch）同步，不全量传图。
- 每 2~3 秒服务端持久化一份 checkpoint，便于重连恢复。
- 画布渲染以 `serverSeq` 回放，保证各端一致。

## 服务端职责与接口
- 管控绘图权限（当前绘图位唯一可写）。
- 保存笔画序列：
  - `draw_strokes(roomId, roundNo, seqNo, strokePayload)`
- 关键接口：
  - `POST /api/v1/party-games/rooms/{roomId}/actions`
  - `GET /api/v1/party-games/rooms/{roomId}/canvas?roundNo=1`

## 客户端交互流程
- 画图端：工具栏（笔、橡皮、撤回）+ 倒计时。
- 猜词端：实时画布 + 猜词输入框。
- 回放端：链路卡片（原词 -> 猜词 1 -> 猜词 2 -> 最终词）。

## 风险与反作弊
- 偷看词条：词条只给当前绘图位单播。
- 画布刷包：限制 stroke 频率与 payload 大小。
- 延迟作弊：统一以服务端时间截止，逾时消息拒绝入库。

## MVP 与迭代
- MVP：基础画布 + 猜词接力 + 结果回放。
- V2：主题词包、房主配置轮次与时长。
- V3：AI 识图评分与笑点自动摘要。
