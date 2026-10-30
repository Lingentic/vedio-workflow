# 当前实现架构

范围契约见 [PRODUCT](PRODUCT.md)，状态与文件归属见 [DATA_AND_LIFECYCLE](DATA_AND_LIFECYCLE.md)。本页描述现有代码，不把计划当成已实现能力。

## 进程与调用路径

```text
浏览器 public/app.ts
  → 同源 HTTP /api/*（server.ts）
    → Library：商品与素材入库
    → Workflow：当前任务、执行锁、阶段与失效
      → Models：阿里云文案 / SSE 配音 / 文字候选选片
      → alignment：配音文字、字时间 → 句子 / 字幕 / 节点时间
      → shot-selection：固定覆盖与商品空位 → 候选池 → 模型响应校验
      → render-plan：已保存逐空位方案 + 声音块 → 完整时间轴
      → renderer + Media：FFmpeg 合成与探测
    → Store：SQLite JSON 记录 + 数据根目录中的媒体
```

只有一个本地 Node 服务，没有独立“自动队列微服务”。浏览器刷新、切换模块不控制云任务或 FFmpeg 的进程生命周期。

2026-10-30 按独立原型再次对齐：`prototype-views.ts` 渲染目录式素材库、三步制作、整段素材汇总、实际执行状态页、真实记录台账和折叠详情，复用原型的 DOM 层次与 CSS 类；`workbench.css` 只适配数据入口、弹窗、排序反馈和窄窗口。发布脚本仍是独立演示岛；商品获取使用 `ecom-video-collect/web/` 的真实采集组件。来源与静态图片边界见 [原型来源](../../demo/public/prototype/README.md)。原型源目录保持不变。

当前真实制作路径为 `copy/confirm {generateVoice:true}` → `confirmCopyAndVoice` → 生成缺失区间 → 校验音频及时间 → 自动确认 → `visual` 工作区。前端在提交前即显示配音加载，期间轮询服务端状态；成功后自动切换，失败提供手动重试，视频生成页不再提供本地音频导入。自动确认不建立旧 `plan`；新页选材通过 selection 保存；render 按 compileSelectionPlan 构造全片时间轴并调用 FFmpeg。新路径复用 Plan 数据结构和音轨／字幕／编码能力，编排来源是 shotSelection，不重建旧随机队列。

主播下半屏单图通过 `host-image/default`、`PUT host-image` 单独保存至 Task，不属于旧商品队列。`host-image-editor.ts` 负责暂存编辑、裁满定位及实时渐变，应用时才上传／保存；FFmpeg 只在截帧或换图时生成任务 JPEG，拖动缩放不生成媒体。新 renderer 的主播分屏分支使用该配置：下半屏1080×960，960～1080接缝渐变，与页面取景一致。

选片沿用阿里云密钥及兼容地址，模型 `deepseek-v4.1-flash`，关闭思考、JSON Object 输出，3分钟超时。能力和名称核对 [阿里云模型页](https://help.aliyun.com/zh/model-studio/deepseek-v4-1-flash) 与 [调用说明](https://help.aliyun.com/zh/model-studio/deepseek-api)；账户模型列表可见不等于付费调用成功。只发送文字，模型失败／解析失败／非法ID或时长不足都不覆盖旧方案、不自动重试。

| 模块 | 责任与关键边界 |
| --- | --- |
| [server.ts](../../demo/server.ts) | 组装服务；校验 Host、Origin、JSON、路径等外部输入；路由 API；流式媒体 Range；擦除前端 TypeScript 类型；绑定 `127.0.0.1`。 |
| [app.ts](../../demo/public/app.ts) | 字符串模板与 `patchView` 局部 DOM 更新；按稳定 key 保留页面、资源、口播区间及播放器。`newElements` 仅给新控件绑定一次事件；串行保存与轮询均不重建整页。不是业务状态的权威存储；输入法、焦点、弹窗与拖动由现有交互保留。 |
| [prototype-views.ts](../../demo/public/prototype-views.ts)、[workbench.css](../../demo/public/workbench.css) | `libraryView`、`architectureView`、`copyView`、`generationView`、`recordsView`、`recordDetailsView`、`materialPickerView`；模板分组只影响展示，实际节点 ID、台词和区间仍取任务快照。逐节点素材选择只是演示，不写旧方案。 |
| [sortable.ts](../../demo/public/sortable.ts) | 旧连续清单排序组件保留，当前新制作页未使用；不能把其存在当作逐段选材已实现。 |
| [prototype-sort.ts](../../demo/public/prototype-sort.ts) | 新原型整段素材汇总的指针与键盘排序，只更新同一节点的前端草稿；蓝色固定项没有排序手柄。拖动期间阻止 DOM 更新，取消不提交，放下后恢复更新并保存页面草稿。 |
| [workflow.ts](../../demo/lib/workflow.ts) | 创建／切换任务、文案确认、区间复用、执行控制、方案与预览失效、完成与清理；当前服务一次只持有一个活动制作执行。 |
| [library.ts](../../demo/lib/library.ts) | 资料验证、复制托管、原视频待处理队列、切分命名批次、逐失败范围恢复、删除保护；固定片段按 binding 关联节点。 |
| [shot-plan.ts](../../demo/lib/shot-plan.ts)、[material-naming.ts](../../demo/lib/material-naming.ts) | 固定切点、15.2／1.9 默认值；编号代理、单次视觉命名、短名及描述校验、请求回执和本地结果恢复。完整边界见 [素材处理](MATERIAL_PROCESSING.md)。 |
| [models.ts](../../demo/lib/models.ts) | 文案请求、SSE 配音读取、错误脱敏与音频下载。字时间必须和确认文字对应；这里没有可靠的自动重提或云端任务恢复服务。 |
| [templates.ts](../../demo/lib/templates.ts) | 加载固定模板／提示词／声音参数；拼变量、组连续区间、签名及文案响应校验。配置源是 `data/`，不要再硬编码第二套。 |
| [alignment.ts](../../demo/lib/alignment.ts) | 数字等规范化、逐字对应，产出 `sentences`、`cues`、`nodeTimes`；无法完整对应时失败，不伪造平均字幕时间。 |
| [plan.ts](../../demo/lib/plan.ts) | `soundBlocks`、`visualEvents`、`buildPlan`、`fullCues`；区分声音边界、通用主播覆盖与商品游标。 |
| [shot-selection.ts](../../demo/lib/shot-selection.ts)、[render-plan.ts](../../demo/lib/render-plan.ts) | 按配音节点时间扣除固定画面、准备候选、校验模型／手改结果，再将已保存方案编译成时间轴；不替换锁定片段，不在合成时重新随机选片。 |
| [renderer.ts](../../demo/lib/renderer.ts) | 上下分屏、渐变、裁满、30 FPS、逐段帧数校验、拼接、字幕、原声与 BGM；设置返工可复用有效基础画面。不再叠加此前的随机装饰／去重图层；发布页去重选项不代表真实合成支持该能力。 |
| [media.ts](../../demo/lib/media.ts) | 有界收集 FFmpeg/FFprobe 输出、信号中止、真实视频流时长／起点／帧数、WAV 修复和哈希。 |
| [store.ts](../../demo/lib/store.ts)、[paths.ts](../../demo/lib/paths.ts)、[types.ts](../../demo/lib/types.ts) | 持久化、目录边界及内部类型；没有 ORM 或生产 npm 依赖。 |

## 三条易混淆的数据流

1. **资料 → 文案**：库中价格、规格供人参考；卖点、只读固定节点、最终变量、可选范例组成模型上下文。模型只返回待填节点。任务使用当时的资料／模板快照。
2. **配音 → 时间 → 画面**：确认文字组成连续区间，TTS 返回音频和字时间；对齐后按真实声音长度排全片。字幕句子边界不意味着必须切换商品镜头。
3. **画面 → 设置返工**：方案签名决定基础画面是否可复用；修改字幕／BGM 只重做输出层。新选片返工必须通过独立 selection；新 render 拒绝 refill=true。旧任务兼容入口仍可使用原 refill 语义。

## 必要的边界校验

模型服务可用 `DASHSCOPE_BASE_URL` 或 `BAILIAN_BASE_URL`（环境变量优先，其次凭证文件）指定根地址；未配置时仍用阿里云官方域名。配置中的 `/compatible-mode/v1` 后缀会移除，再分别拼接文案兼容接口与原生 SSE 配音接口。默认声音仍为既定小帅复刻音色；不要用开发者测试音色替换共享配置，否则区间签名变化会导致已有配音不能复用。

服务启动和切换数据目录会调用 `installBuiltinBgms` 导入随代码携带的配乐副本，不下载外部文件或改任务设置。`exportModal` 只收集保存位置及显示等待／结果，`Workflow.export` 以独立文件名复制正式预览，不改变任务状态或触发模型。配乐来源见 [许可说明](../../demo/data/bgm/README.md)。

- 外部 HTTP 输入由路由和 `validateProduct` 等接收边界验证；内部 TypeScript 类型不是模型响应或浏览器请求的运行时保证。
- 文案节点 ID、固定文本与配音文字对应分别由模板层和对齐层验证，不能为了“走通流程”用默认空内容掩盖失败。
- 托管相对路径必须经 `Store.path` / `managedPath`，目录切换只在服务空闲并等待清理后进行。
- 素材／预览 URL 是由记录解析出的媒体入口；缩略图是界面资源，不能作为合成输入。
- `GET /api/state` 的 `modelReady` 只表示找到凭证，`toolsReady` 当前为固定值；都不等于账户权益或工具能力验证。见 [开发说明](DEVELOPMENT.md#已知缺口与证据边界)。

## 维护影响范围

改 HTTP 形状时同步 [API.md](../../demo/API.md) 与前端接口；改持久化字段时同步服务端类型、前端使用字段及兼容已有记录的处理；改声音／模板参数时检查区间签名与失效；改渲染规则时检查基础画面缓存签名，防止继续复用旧规则生成的画面。

## 商品采集边界

商品获取挂载在五模块工作台的 products 页；Node 托管 /collect/ 下的 JS/CSS，通过 /api/collect/* 和 /collect-media/* 转发本机 Python 采集服务（默认 8765）。扩展读取快分销商品详情，Python 搜索平台素材，下载后经商品／素材 API 入库；跳转素材中心时刷新服务端数据。旧 page=collection 链接兼容到商品获取。

组件独立管理 DOM，工作台轮询不覆盖采集录入；首次启动仅在新来源无记录时迁移旧 8765 来源的采集草稿，受来源及随机标识校验且有界超时。发布仍为演示；逐段选材与真实本地合成已接入。

平台登录 Cookie 仅供平台搜索客户端使用，媒体代理及下载不携带。Python 精确检查本机 Host／Origin；Node 同源转发和无 Origin 的本机 CLI 可用。下载在独立临时目录完成，校验后原子发布独立文件名；并发同名或 HLS 转封装不覆盖已完成文件，失败只清理自身临时文件。浏览器预览副本不替换入库原视频。


正式入口默认对未入库候选在线播放，无需参数开关：`collect-api.onlineUrl` → 同源 `/api/collect/stream` → 采集服务 FFmpeg stdout → 播放器。视频不写入采集 media/；图片预览直接走代理，也不触发下载。仅勾选并确认入库后下载原媒体。已存在 local 的记录沿用本地兼容预览。在线流使用实时转码与有限管道缓冲，不持久化完整视频，最多同时两路；关闭预览清空播放器 src 并结束对应进程。在线候选通过 start 秒数定位后重新推流，进度条支持向前、向后拖动，定位后有短暂缓冲；已入库视频仍支持 Range。

在线预览拖动时，固定视频舞台高度并保留宽高比，状态提示行始终占位。切换流地址前将最后解码帧绘制到单个内存 canvas，等待新流首帧真正呈现后移除覆盖，避免回到封面、黑闪或弹窗伸缩；连续拖动复用上次保留画面，关闭弹窗即释放，不写媒体文件。
