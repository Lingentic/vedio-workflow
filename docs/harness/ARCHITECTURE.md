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

2026-10-29 按最新原型更新布局：`prototype-views.ts` 渲染目录式素材库、三步制作页、分组段落、真实记录台账和折叠详情，复用原型的 DOM 层次与 CSS 类；`workbench.css` 仅适配数据入口、弹窗挂载和窄窗口，不另建一套布局。`public/prototype/` 的商品获取／发布脚本是独立演示岛，仅使用浏览器演示数据，不读写业务库。来源与静态图片边界见 [原型来源](../../demo/public/prototype/README.md)。原型源目录保持不变。

当前真实制作路径为 `copy/confirm {generateVoice:true}` → `confirmCopyAndVoice` → 生成缺失区间 → 校验音频及时间 → 自动确认 → `visual` 工作区试听。自动确认不建立旧 `plan`；新页选材仅前端演示，生成视频禁用。图中的 plan／renderer 仍是保留的后端实现，尚未接入新 UI。

| 模块 | 责任与关键边界 |
| --- | --- |
| [server.ts](../../demo/server.ts) | 组装服务；校验 Host、Origin、JSON、路径等外部输入；路由 API；流式媒体 Range；擦除前端 TypeScript 类型；绑定 `127.0.0.1`。 |
| [app.ts](../../demo/public/app.ts) | 字符串模板与 `patchView` 局部 DOM 更新；按稳定 key 保留页面、资源、口播区间及播放器。`newElements` 仅给新控件绑定一次事件；串行保存与轮询均不重建整页。不是业务状态的权威存储；输入法、焦点、弹窗与拖动由现有交互保留。 |
| [prototype-views.ts](../../demo/public/prototype-views.ts)、[workbench.css](../../demo/public/workbench.css) | `libraryView`、`architectureView`、`copyView`、`generationView`、`recordsView`、`recordDetailsView`、`materialPickerView`；模板分组只影响展示，实际节点 ID、台词和区间仍取任务快照。逐节点素材选择只是演示，不写旧方案。 |
| [sortable.ts](../../demo/public/sortable.ts) | 旧连续清单排序组件保留，当前新制作页未使用；不能把其存在当作逐段选材已实现。 |
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
