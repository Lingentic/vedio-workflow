# Demo 本地接口

界面参考独立原型，已确认行为见随仓维护的 [产品契约](../docs/harness/PRODUCT.md)，实现关系见 [架构](../docs/harness/ARCHITECTURE.md)。使用 Node.js 24 自带 SQLite 和系统 FFmpeg，无新增 npm 依赖。服务只绑定 127.0.0.1；API 与页面同源。

所有 JSON 接口成功返回直接的数据对象；失败返回 `{error,message}`，HTTP 状态为 400/404/409/500 等。付费模型不会自动重试。异步操作返回 202 和当前 task，前端每秒刷新当前任务；生成记录保持同一 task ID。

- `GET /api/state` → `{configured,dataRoot,defaultDataRoot,modelReady,toolsReady,templates,products,assets,tasks,bgms,seedAvailable,activeExecution}`。
- `POST /api/setup` `{dataRoot?}` → 初始保存目录，省略则取运行电脑实际 Videos 已知文件夹/电商视频工作台Demo。已经配置后只能在没有任务执行时修改；已有数据不自动搬迁。
- `POST /api/dialog` `{kind:"folder"|"videos"}` → `{paths:[]}`；取消返回空列表。
- `POST /api/seed` → 导入本机用户提供的两个商品和固定素材，原文件不动；已有导入不重复复制。
- `GET /api/products` / `GET /api/products/:id` → 商品资料与当前素材。
- `POST /api/products` `{productId,name,price,specification,sellingPoints,localVideos:[{path,processed:true}]}` → 接收商品及本地文件；追加走同一接口。卖点为文本。
- `PATCH /api/products/:id` `{price,specification,sellingPoints,name}` → 仅库中修改，不追溯已建立任务的快照。
- `POST /api/products/:id/import` `{paths:[绝对路径],processed:true|false}` → 按文件入库。原始视频进入本地切分；已处理片段直接校验入库。
- `POST /api/assets/:id/retry` → 仅补失败的文件/输出。
- `DELETE /api/assets/:id` → 删除托管商品片段，保留删除记录；正在合成的输入拒绝删除。
- `GET /media/asset/:id`、`GET /poster/:id` → 素材/缩略图，支持 Range。
- `POST /api/tasks` `{productId,templateId}` → 创建草稿和单一生成记录，默认 stage=copy。
- `GET /api/tasks/:id` → 完整任务，含 `nodes`、连续 AI `intervals`、`plan`、`settings`、`preview`、`execution`、确认状态、错误和快照。
- `PATCH /api/tasks/:id` `{variable?,example?,black?,settings?,stage?}` → 自动保存编辑稿。`black` 为 `{nodeId:text}`。`settings` 为 `{subtitles,bgmId,bgmVolume}`；音量为 0~0.5，默认不选 BGM。已确认声音对应的文案实际变化需先由 UI 确认重配。
- `POST /api/tasks/:id/switch` `{productId,templateId,mode:"overwrite"|"new"}` → 黑色为空时可直接覆盖；有黑色时 UI 先显示保留并新建/覆盖/取消。
- `POST /api/tasks/:id/copy` → 202，真实 Qwen 生成全部黑色，固定节点不改。
- `POST /api/tasks/:id/copy/confirm` `{generateVoice?:boolean}` → 确认当前文案，按实际变化失效受影响区间。新 UI 传 `true`，返回 202 并自动配音；全部就绪后自动确认、进入 visual，**不建立旧选材队列**。默认不传保留旧的仅确认行为。
- `POST /api/tasks/:id/voice` `{intervalId?,autoConfirm?:boolean}` → 202，只生成缺失/失效区间，或指定一个区间重配；期间锁编辑。新 UI 重试传 `autoConfirm:true`，成功后自动确认并进入 visual，不建立旧队列；默认仍为旧的待手动确认行为。
- `POST /api/tasks/:id/voice/confirm` → 全部必需音频与时间有效才确认。
- `POST /api/tasks/:id/plan` → 保留的后端接口，当前新 UI 不调用。生成一次全片连续随机商品队列；通用主播期间暂停商品游标。
- `PUT /api/tasks/:id/plan` `{assetIds:[按顺序可重复的商品素材ID]}` → 手动方案，仅整条素材操作；时长不足时保存并返回 `plan.valid=false`，禁止合成。
- `POST /api/tasks/:id/render` `{refill?:boolean}` → 保留的后端接口，当前新 UI 暂不开放合成。202，默认保留画面方案并本地 FFmpeg 合成；`refill:true` 为当前商品重新随机填充商品画面。
- `POST /api/tasks/:id/stop` → 仅停止本地合成，实际退出后解除输入保护；文案/TTS 不提供主动取消。
- `POST /api/tasks/:id/complete` → 当前预览有效才确认完成，参数只读，后台清理本任务中间文件。
- `POST /api/tasks/:id/export` `{directory}` → 将当前成片以新文件名复制到所选目录；不改变任务状态。
- `GET /media/task/:id/:kind` → `kind=preview` 或 `audio-区间ID`，由记录解析托管路径。

任务结构主要字段：`id,name,productId,templateId,productSnapshot,variable,example,black,nodes,stage,copyConfirmed,audioConfirmed,intervals,plan,settings,preview,previewStale,previewChanges,completed,execution,error,createdAt,updatedAt`。预览含 `inputs` 快照；过期时 `previewChanges` 返回可识别的变化原因，旧预览无快照时使用通用原因。

区间：`id,nodeIds,text,signature,status,duration,audioUrl,words,cues,sentences,nodeTimes,confirmed,error`。只有有效区间可试听/合成。

方案：`mode,entries:[{entryId,assetId,title,duration,url,posterUrl,available}],requiredDuration,availableDuration,valid,repeated,warnings,events,signature`。手动列表允许重复，条目身份不等于素材ID。

状态使用中文界面文案，内部执行 `kind=copy|voice|render`、`status=running|done|failed|stopped|interrupted`。确认完成后 `completed=true`；清理状态独立记录。删除/暂不可用不等同，完成成片不因源素材删除而失效。
