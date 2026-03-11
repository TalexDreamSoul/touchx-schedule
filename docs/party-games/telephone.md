# 传声筒（剧情增强）多人同步策划

## 目标与定位
- 8~12 人轻娱乐，单局 15~25 分钟。
- 用“文本/语音接力”制造剧情偏差与笑点。
- 必须多人在线同步，不做离线单机。

## 人数与素材
- 推荐人数：8~12。
- 素材类型：短句题卡、剧情模板、可选语音输入。
- 产出：完整传递链路回放。

## 核心规则
- 每人拿到初始短句并在限时内复述/改写。
- 按座位顺序传给下一位。
- 经过多轮传递后统一揭晓“原句 vs 终句”。
- 剧情增强模式：每轮增加限定词（例如“必须带地点”）。

## 房间状态机
- `waiting`
- `setup`
- `round_input`
- `round_transfer`
- `round_reveal`
- `finished`

## 实时同步设计
### 客户端动作
- `telephone.input.submit`
- `telephone.transfer.confirm`
- `telephone.host.next-round`

### 服务端事件
- `telephone.private.prompt-assigned`（单播）
- `telephone.round.started`
- `telephone.round.progress`
- `telephone.chain.revealed`
- `game.finished`

### 同步要点
- 每轮输入仅本人可见，揭晓阶段才公开全链路。
- 语音素材先上传 R2，消息里只传对象引用 ID。
- 回合推进由服务端统一切换，防止客户端抢状态。

## 服务端职责与接口
- 负责传递顺序、题卡下发、轮次切换和揭晓拼接。
- 数据结构补充：
  - `telephone_round_entries(roomId, roundNo, seatNo, contentRef, contentType)`
- 关键接口：
  - `POST /api/v1/party-games/rooms/{roomId}/actions`
  - `POST /api/v1/media/upload-token`（语音临时上传）

## 客户端交互流程
- 房间页选择题卡包与轮次。
- 输入页展示倒计时和当前限定词。
- 回放页按时间轴展示每次变形内容。

## 风险与反作弊
- 剧透风险：未到揭晓阶段禁止查看前序内容。
- 语音审核：上传后先做格式与时长校验。
- 空提交：超时自动写入“空白片段”并继续流程。

## MVP 与迭代
- MVP：文本接力 + 限时 + 回放。
- V2：语音接力 + 剧情模板。
- V3：AI 自动生成“偏差点评”与高光片段。
