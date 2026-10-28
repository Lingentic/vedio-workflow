# 当前实现架构

范围契约见 [PRODUCT](PRODUCT.md)，状态与文件归属见 [DATA_AND_LIFECYCLE](DATA_AND_LIFECYCLE.md)。本页描述现有代码，不把计划当成已实现能力。

## 进程与调用路径

```text
浏览器 public/app.ts
  → 同源 HTTP /api/*（server.ts）
    → Library：商品与素材入库
    → Workflow：当前任务、执行锁、阶段与失效
      → Models：阿里云文案 / SSE 配音
      → alignment：配音文字、字时间 → 句子 / 字幕 / 节点时间
      → plan：声音块 → 画面事件 → 连续商品素材取用
      → renderer + Media：FFmpeg 合成与探测
    → Store：SQLite JSON 记录 + 数据根目录中的媒体
```

只有一个本地 Node 服务，没有独立“自动队列微服务”。浏览器刷新、切换模块不控制云任务或 FFmpeg 的进程生命周期。

工作台与采集页的界面基于 `Lingentic/pm@21704c8` 对齐：工作台在 `demo/public/pm-ui.css` 维护适配样式，仍由 `app.ts` 读取真实服务端状态；采集页沿用上游商品获取布局，由 `web/collect-api.js` 接回现有扩展、搜索、下载及工作台导入接口。采集页「素材中心」导航在同一工作台内切换到真实素材库；本地增补入口也跳转该商品的素材目录，不再使用原型浏览器素材库作为真实入库结果。

仓库根的 [ecom-video-collect/](../../ecom-video-collect/) 保留独立 Python 采集进程，商品获取界面由 demo 原生挂载：Chrome 扩展读取快分销详情与图集，Python 服务检索并下载快手／抖音视频，经 `POST /api/products` 与 `POST /api/products/:id/import`（`processed:true`）把商品和已下载的视频/图片素材推入素材库。demo 侧栏「商品获取」在当前页面切换，统一入口为 `http://127.0.0.1:4186/?page=collection`。Node 服务托管采集 JS/CSS，以 `/api/collect/*` 和 `/collect-media/*` 转发 Python API 和媒体；Python 默认 8765，仅作为内部采集服务。扩展桥接位于工作台顶层文档，沿用现有 localhost 匹配规则。采集组件独立管理 DOM，工作台轮询不覆盖录入草稿。首次进入时通过受来源和随机标识校验的隐藏页面读取同主机 8765 的 localStorage 记录，仅在新域没有记录时迁移，不改写旧记录；采集服务离线时不阻塞工作台其他模块。

| 模块 | 责任与关键边界 |
| --- | --- |
| [server.ts](../../demo/server.ts) | 组装服务；校验 Host、Origin、JSON、路径等外部输入；路由 API；流式媒体 Range；擦除前端 TypeScript 类型；绑定 `127.0.0.1`。 |
| [app.ts](../../demo/public/app.ts) | 字符串模板与 `patchView` 局部 DOM 更新；按稳定 key 保留页面、资源、口播区间及播放器。`newElements` 仅给新控件绑定一次事件；串行保存与轮询均不重建整页。不是业务状态的权威存储；输入法、焦点、弹窗与拖动由现有交互保留。 |
| [sortable.ts](../../demo/public/sortable.ts) | Pointer Events 排序、跟手浮层、占位与边缘滚动；松手落位只改前端清单，保存方案才写服务端。 |
| [workflow.ts](../../demo/lib/workflow.ts) | 创建／切换任务、文案确认、区间复用、执行控制、方案与预览失效、完成与清理；当前服务一次只持有一个活动制作执行。 |
| [library.ts](../../demo/lib/library.ts) | 资料验证、复制托管、探测、切分、逐失败范围重试、删除保护；固定片段按 binding 关联节点。 |
| [models.ts](../../demo/lib/models.ts) | 文案请求、SSE 配音读取、错误脱敏与音频下载。字时间必须和确认文字对应；这里没有可靠的自动重提或云端任务恢复服务。 |
| [templates.ts](../../demo/lib/templates.ts) | 加载固定模板／提示词／声音参数；拼变量、组连续区间、签名及文案响应校验。配置源是 `data/`，不要再硬编码第二套。 |
| [alignment.ts](../../demo/lib/alignment.ts) | 数字等规范化、逐字对应，产出 `sentences`、`cues`、`nodeTimes`；无法完整对应时失败，不伪造平均字幕时间。 |
| [plan.ts](../../demo/lib/plan.ts) | `soundBlocks`、`visualEvents`、`buildPlan`、`fullCues`；区分声音边界、通用主播覆盖与商品游标。 |
| [renderer.ts](../../demo/lib/renderer.ts) | 上下分屏、渐变、裁满、30 FPS、逐段帧数校验、拼接、字幕、原声与 BGM；设置返工可复用有效基础画面。 |
| [media.ts](../../demo/lib/media.ts) | 有界收集 FFmpeg/FFprobe 输出、信号中止、真实视频流时长／起点／帧数、WAV 修复和哈希。 |
| [store.ts](../../demo/lib/store.ts)、[paths.ts](../../demo/lib/paths.ts)、[types.ts](../../demo/lib/types.ts) | 持久化、目录边界及内部类型；没有 ORM 或生产 npm 依赖。 |

## 三条易混淆的数据流

1. **资料 → 文案**：库中价格、规格供人参考；卖点、只读固定节点、最终变量、可选范例组成模型上下文。模型只返回待填节点。任务使用当时的资料／模板快照。
2. **配音 → 时间 → 画面**：确认文字组成连续区间，TTS 返回音频和字时间；对齐后按真实声音长度排全片。字幕句子边界不意味着必须切换商品镜头。
3. **画面 → 设置返工**：方案签名决定基础画面是否可复用；修改字幕／BGM 只重做输出层。`refill:true` 才主动重选商品序列，保留文案与有效配音。

## 必要的边界校验

- 外部 HTTP 输入由路由和 `validateProduct` 等接收边界验证；内部 TypeScript 类型不是模型响应或浏览器请求的运行时保证。
- 文案节点 ID、固定文本与配音文字对应分别由模板层和对齐层验证，不能为了“走通流程”用默认空内容掩盖失败。
- 托管相对路径必须经 `Store.path` / `managedPath`，目录切换只在服务空闲并等待清理后进行。
- 素材／预览 URL 是由记录解析出的媒体入口；缩略图是界面资源，不能作为合成输入。
- `GET /api/state` 的 `modelReady` 只表示找到凭证，`toolsReady` 当前为固定值；都不等于账户权益或工具能力验证。见 [开发说明](DEVELOPMENT.md#已知缺口与证据边界)。

## 维护影响范围

改 HTTP 形状时同步 [API.md](../../demo/API.md) 与前端接口；改持久化字段时同步服务端类型、前端使用字段及兼容已有记录的处理；改声音／模板参数时检查区间签名与失效；改渲染规则时检查基础画面缓存签名，防止继续复用旧规则生成的画面。
