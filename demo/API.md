# Demo 本地接口

界面参考独立原型，已确认行为见随仓维护的 [产品契约](../docs/harness/PRODUCT.md)，实现关系见 [架构](../docs/harness/ARCHITECTURE.md)。使用 Node.js 24 自带 SQLite 和系统 FFmpeg，无新增 npm 依赖。服务只绑定 127.0.0.1；API 与页面同源。

所有 JSON 接口成功返回直接的数据对象；失败返回 `{error,message}`，HTTP 状态为 400/404/409/500 等。付费模型不会自动重试。异步操作返回 202 和当前 task，前端每秒刷新当前任务；生成记录保持同一 task ID。

- `GET /api/runtime` → `{app:"vedio-workflow",interfaceVersion:"online-collection-preview-v5"}`；本机启动脚本的能力识别接口。
- `GET /api/state` → `{configured,dataRoot,defaultDataRoot,modelReady,toolsReady,templates,products,assets,tasks,fixedNarrationVisuals,bgms,seedAvailable,activeExecution,libraryBusy,libraryMessage,materialProcessing}`；`materialProcessing` 含切分 settings、命名配置就绪布尔值及模型名，不返回密钥。
- `POST /api/setup` `{dataRoot?}` → 初始保存目录，省略则取运行电脑实际 Videos 已知文件夹/电商视频工作台Demo。已经配置后只能在没有任务执行时修改；已有数据不自动搬迁。
- `POST /api/dialog` `{kind:"folder"|"videos"}` → `{paths:[]}`；取消返回空列表。
- `POST /api/seed` → 导入本机用户提供的两个商品和固定素材，原文件不动；已有导入不重复复制。
- `GET /api/products` / `GET /api/products/:id` → 商品资料与当前素材。
- `POST /api/products` `{productId,name,price,specification,sellingPoints,localVideos:[{path,processed:true}]}` → 接收商品及本地文件；追加走同一接口。卖点为文本。仓库内参考上游实现见 [ecom-video-collect/](../ecom-video-collect/)。
- `PATCH /api/products/:id` `{price,specification,sellingPoints,name}` → 仅库中修改，不追溯已建立任务的快照。
- `POST /api/products/:id/import` `{paths:[绝对路径],processed:true|false}` → 按文件入库。原始视频仅进入“原始视频”，等待显式切分命名；已处理片段直接校验入库。图片跳过视频探测，作为图片入库，不进入原视频切分队列。
- `POST /api/products/:id/upload?name=文件名&processed=true|false` → 浏览器选择视频或 JPG／PNG／WEBP 图片后的原始文件流，返回 201 `{assets}`。只写本机托管目录，成功复制后清理上传缓存；文件名及商品归属在边界校验。
- `PUT /api/library/processing-settings` `{threshold,minDurationSec}` → 保存当前库切分设置；默认 `15.2 / 1.9`，只影响新切分计划。
- `POST /api/products/:id/process` `{assetIds:[原视频ID],confirmUncertain?:true}` → 202 `{accepted:true}`，后台串行切分并命名；只允许当前商品的未完成原视频。命名结果不确定时须显式确认，不自动重发。
- `POST /api/assets/:id/retry` → 恢复独立片段文件，保留素材 ID、名称、描述及来源；原视频处理重试走上述 process 接口。
- `DELETE /api/assets/:id` → 删除托管商品片段，保留删除记录；正在合成的输入拒绝删除。
- `GET /media/asset/:id`、`GET /poster/:id` → 素材/缩略图，支持 Range。视频预览使用 `GET /media/asset/:id?browser=1`：兼容的 H.264/yuv420p/AAC MP4 复用原件，其他编码转换到数据根目录 `缓存/素材预览`，按来源路径、大小和修改时间缓存，并合并同时发生的相同请求；原文件与合成路径不变。
- `POST /api/tasks` `{productId,templateId}` → 创建持久化制作草稿，默认 stage=copy、videoSubmittedAt=null，尚不在生成记录展示。
- `GET /api/tasks/:id` → 完整任务，含 `nodes`、连续 AI `intervals`、`plan`、`settings`、`preview`、`execution`、确认状态、错误和快照。
- `POST /api/tasks/:id/selection` → 202，配音及节点时间有效后随机抽取当前商品候选（3倍待填时长软目标、至少8条但不足全取、最多40条），用 `deepseek-v4.1-flash` 一次安排所有商品填充空位。只提交文案／描述／ID／时长。execution.kind=selection；失败不自动重试、不覆盖旧方案、不写 videoSubmittedAt。
- `PUT /api/tasks/:id/selection` `{choices:[{slotId,assetIds}]}` → 按当前 slots 顺序完整提交手选方案，可用当前商品全部可用视频，不限模型候选池；各空位时长不足则拒绝。结果保存在 Task.shotSelection。文案、配音时间、固定绑定或所选素材失效时返回 stale=true，禁止沿用和手改，需重新匹配。
- `POST /api/tasks/:id/host-image/default` → 已有有效任务图片时直接复用；否则使用当前商品图片，缺图时从商品视频截一帧，保存独立任务图片。
- `PUT /api/tasks/:id/host-image` `{assetId?,x,y,scale}` → 图片必须属于当前商品；省略 assetId 仅调整已有任务图片。位置 x／y 为 0～1 的裁切比例，scale 为 1～4，默认居中原始覆盖；不修改配音／文案或视频提交时间。完成任务只读，执行中禁止改动。
- `GET /media/task/:id/host-image` → 任务独立 JPEG；换图后使用新 URL，原资源删除不影响已保存副本。
- `PATCH /api/tasks/:id` `{variable?,example?,black?,settings?,stage?}` → 自动保存编辑稿。`black` 为 `{nodeId:text}`。`settings` 为 `{subtitles,bgmId,bgmVolume}`；音量为 0~0.5，默认不选 BGM。已确认声音对应的文案实际变化需先由 UI 确认重配。
- `POST /api/tasks/:id/switch` `{productId,templateId,mode:"overwrite"|"new"}` → 未提交视频且黑色为空时直接覆盖；已有黑色时 UI 显示取消／确认覆盖。仅已有 `videoSubmittedAt` 的可编辑任务允许保留并新建（旧任务从生成记录继续）；未提交任务请求 `new` 返回 409，不创建记录或改变原稿。
- `POST /api/tasks/:id/copy` → 202，真实 Qwen 生成全部黑色，固定节点不改。
- `POST /api/tasks/:id/copy/confirm` `{generateVoice?:boolean}` → 确认当前文案，按实际变化失效受影响区间。新 UI 传 `true`，返回 202 并自动配音；全部就绪后自动确认、进入 visual，**不建立旧选材队列**。默认不传保留旧的仅确认行为。
- `POST /api/tasks/:id/voice` `{intervalId?,autoConfirm?:boolean}` → 202，只生成缺失/失效区间，或指定一个区间重配；期间锁编辑。新 UI 重试传 `autoConfirm:true`，成功后自动确认并进入 visual，不建立旧队列；默认仍为旧的待手动确认行为。
- `POST /api/tasks/:id/voice/confirm` → 全部必需音频与时间有效才确认。
- `POST /api/tasks/:id/plan` → 保留的后端接口，当前新 UI 不调用。生成一次全片连续随机商品队列；通用主播期间暂停商品游标。
- `PUT /api/tasks/:id/plan` `{assetIds:[按顺序可重复的商品素材ID]}` → 手动方案，仅整条素材操作；时长不足时保存并返回 `plan.valid=false`，禁止合成。
- `POST /api/tasks/:id/render` `{}` → 202，校验已确认配音、有效shotSelection及主播下半屏图片，compileSelectionPlan编排后在后台本地FFmpeg合成；首次受理才写videoSubmittedAt，重试更新同一记录。字幕／BGM／音量从已保存settings读取，不重新配音或选片。新任务拒绝refill=true；无shotSelection的旧任务仍兼容原有plan/refill语义。失败保留已有预览，停止退出后可手动重试。
- `POST /api/tasks/:id/stop` → 仅停止本地合成，实际退出后解除输入保护；文案/TTS 不提供主动取消。
- `POST /api/tasks/:id/complete` → 当前预览有效才确认完成，参数只读，后台清理本任务中间文件。
- `POST /api/tasks/:id/export` `{directory}` → 将当前成片以新文件名复制到已存在的本地绝对目录，返回 `{path}`；不覆盖原件或改变任务状态。UI 使用站内窗口展示位置、等待和结果；`GET /api/state.defaultExportDirectory` 为当前电脑 Videos 目录。
- `GET /media/task/:id/:kind` → `kind=preview` 或 `audio-区间ID`，由记录解析托管路径。

`GET /api/state` 的 tasks 保留全部制作任务（含草稿），用于恢复制作；生成记录 UI 仅展示 videoSubmittedAt 非空的任务，不等于整个 tasks 数组。旧任务按已有视频／合成证据只读兼容，不因读取修改数据库。

`bgms` 包含三首内置 CC0 配乐与已有可用配乐，仍由 `/media/asset/:id` 提供播放和 Range 读取。内置文件／稳定绑定及许可见 [配乐目录](data/bgm/README.md)。默认 `settings.bgmId=null`，内置入库不触发选片、配音或合成。

`fixedNarrationVisuals` 为固定口播画面绑定数组：`{nodeId,matchedText,placement:"start"|"end",assetId,duration,status:"ready"|"missing"|"unassigned"}`。无可用绑定返回 null ID；不把旧同节点但不同哈希的素材当作已核对画面。配音超出片段的部分保留未填充。

任务结构主要字段：`id,name,productId,templateId,productSnapshot,variable,example,black,nodes,stage,copyConfirmed,audioConfirmed,intervals,plan,settings,preview,previewStale,previewChanges,completed,videoSubmittedAt,execution,error,createdAt,updatedAt`。预览含 `inputs` 快照；过期时 `previewChanges` 返回可识别的变化原因，旧预览无快照时使用通用原因。

区间：`id,nodeIds,text,signature,status,duration,audioUrl,words,cues,sentences,nodeTimes,confirmed,error`。只有有效区间可试听/合成。

方案：`mode,entries:[{entryId,assetId,title,duration,url,posterUrl,available}],requiredDuration,availableDuration,valid,repeated,warnings,events,signature`。手动列表允许重复，条目身份不等于素材ID。

状态使用中文界面文案，内部执行 `kind=copy|voice|render`、`status=running|done|failed|stopped|interrupted`。确认完成后 `completed=true`；清理状态独立记录。删除/暂不可用不等同，完成成片不因源素材删除而失效。

## 商品获取同源入口

`/?page=collection` 在工作台内显示商品获取，不新开标签页。`/collect/*.js` 与 `/collect/vendor/*.{js,css}` 只读托管采集组件。`GET /api/collect/health`、`GET /api/collect/search`、`GET /api/collect/proxy`、`POST /api/collect/download`、`POST /api/collect/preview`、`POST /api/collect/workbench-import` 保留采集接口格式，由 Node 转发到 `COLLECT_SERVICE_URL`（默认 `http://127.0.0.1:8765`，仅允许本机 HTTP）。`GET/HEAD /collect-media/:filename` 转发采集媒体，组件把返回的 `/media/` 地址映射到此入口显示；入库仍保留原采集文件路径。上游不可达返回 502 与可读错误，不影响其他模块。

采集侧 `POST /api/collect/preview {path:"/media/<video>",force?:boolean}` 返回浏览器可播放的 `/media/` 视频路径：H.264/AAC MP4 先直接复用原件，浏览器若报解码错误则用 `force:true` 自动转码重试；其他编码另生成缓存预览副本。原视频与工作台入库路径不变。`/collect-media/*` 支持 `Range`／`HEAD`，播放器可以按需读取。

候选在线播放使用 `GET /api/collect/stream?platform=kuaishou|douyin&url=<编码后的媒体地址>&start=0`：采集服务携带平台请求头从 CDN 读取，FFmpeg 实时输出 H.264/AAC fragmented MP4，由 stdout 直接转发，不创建媒体文件。响应 `Cache-Control:no-store`，通过 `start=<秒数>` 定位后重新推流，前端进度条按候选时长显示，支持前后拖动；单服务最多 2 个并发预览，单次最长 10 分钟。关闭播放器会清空 src 并中止接收，连接断开后终止转码进程。网络读取超时 15 秒，候选最多尝试 3 个地址；确认入库仍使用原下载接口保存原视频。已有本地素材预览继续复用本地文件。

正式入口 `/?page=collection` 默认启用在线候选预览，无需 `preview=online` 参数。候选预览不调用下载接口，确认入库才保存原媒体；已有本地素材无需重新联网。
