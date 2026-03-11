# 聚会游戏多人同步策划（总览）

## 目标
- 覆盖今日页的 6 款聚会游戏：狼人杀、谁是卧底、阿瓦隆、传声筒、你画我猜、海龟汤。
- 所有游戏必须是**多人实时同步**，不提供离线单机模式。
- 使用统一房间基础设施，减少后续扩展成本。

## 统一架构
- 传输层：`WebSocket`（主通道）+ HTTP API（建房、鉴权、回放查询）。
- 同步模型：服务端权威（Server Authoritative），客户端只提交意图，不直接改状态。
- 状态同步：事件流 + 快照。
  - 事件：低带宽实时广播。
  - 快照：断线重连、跨端恢复、观战加入时补齐。

## 统一对象模型
- `GameRoom`
  - `roomId`, `gameKey`, `hostUserId`, `status`, `maxPlayers`, `createdAt`
- `RoomSeat`
  - `roomId`, `seatNo`, `userId`, `isReady`, `isOnline`, `lastHeartbeatAt`
- `GameSession`
  - `sessionId`, `roomId`, `version`, `phase`, `phaseDeadlineAt`, `result`
- `GameEvent`
  - `eventId`, `roomId`, `sessionId`, `serverSeq`, `type`, `actorId`, `payload`, `createdAt`

## 统一事件包
```json
{
  "roomId": "r_123",
  "sessionId": "s_123",
  "gameKey": "werewolf",
  "serverSeq": 204,
  "type": "game.phase.changed",
  "actorId": "2305100613",
  "payload": {},
  "sentAt": 1770000000
}
```

## 统一 API 草案（/api/v1）
- `POST /api/v1/party-games/rooms`：创建房间。
- `POST /api/v1/party-games/rooms/{roomId}/join`：加入房间。
- `POST /api/v1/party-games/rooms/{roomId}/leave`：离开房间。
- `POST /api/v1/party-games/rooms/{roomId}/ready`：准备/取消准备。
- `POST /api/v1/party-games/rooms/{roomId}/start`：房主开局。
- `GET /api/v1/party-games/rooms/{roomId}`：拉取房间与当前快照。
- `GET /api/v1/party-games/rooms/{roomId}/events?afterSeq=123`：补事件。
- `GET /api/v1/party-games/ws?token=...&roomId=...`：实时连接。
- `POST /api/v1/party-games/rooms/{roomId}/actions`：统一动作上报。

## 断线重连与容灾
- 客户端每 15s heartbeat，服务端 45s 未收到即标记离线。
- 重连时上传 `lastAckSeq`：
  - 若事件可补齐：下发增量事件。
  - 若跨度过大：下发完整快照 + 最新 `serverSeq`。
- 房主离线策略：自动转移房主（按最早加入且在线）。

## 反作弊基线
- 服务端权威裁决：角色、词条、答案、任务结果不由客户端决定。
- 私密信息单播：身份、词语、阵营结果仅发给目标用户。
- 操作签名：每次 action 带 `clientActionId`（幂等防重放）。
- 审计日志：关键行为（开局、投票、淘汰、结算）可追溯。

## 监控指标
- 房间创建成功率、开局率、完赛率。
- 平均重连恢复时长、重连成功率。
- 玩家操作延迟（P50/P95）。
- 异常中断率（超时解散、服务端错误）。

## 文档索引
- [狼人杀](./werewolf.md)
- [谁是卧底](./undercover.md)
- [阿瓦隆](./avalon.md)
- [传声筒](./telephone.md)
- [你画我猜](./draw-and-guess.md)
- [海龟汤](./turtle-soup.md)
