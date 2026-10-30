# 开发、验证与故障定位

以下命令默认从仓库根目录运行；明确标为 `demo` 目录的命令除外。不要用一串绿色结果代替具体行为说明。

## 不写业务数据的检查

这些是按需工具，不是每次修改都执行的固定流程。

- 文档或导航修改：`node scripts/check-harness.mjs` 按实际链接检查入口和目标，不另维护一份写死的文档布局清单，不访问外部网址或服务。
- 环境变化或启动／媒体工具问题：`node scripts/doctor.mjs` 检查当前 Node、FFmpeg、FFprobe、libx264、ASS，以及 Windows 上的 PowerShell；不启动应用、不读用户库或账号、不调用模型、不安装软件。支持 `--json`。环境未变不重复跑。
- doctor 使用 PATH 或 `FFMPEG_PATH`／`FFPROBE_PATH`，不读取 `.local/settings.json`。若应用配置了别处的媒体工具，诊断时应显式指定同一路径。

### 可选 TypeScript 检查

运行时无需 npm 生产依赖。严格类型检查需要 TypeScript 与 Node 类型，放在任务级临时工具目录，不修改仓库依赖清单。安装需要联网；脚本本身不会自动安装。

```powershell
$tools = Join-Path ([IO.Path]::GetTempPath()) 'vedio-workflow-agent-tools'
npm install --prefix $tools --no-save --package-lock=false typescript@5 @types/node@24
node scripts/check-types.mjs
```

复用其他工具目录可传 `--tool-root <目录>` 或设置 `HARNESS_TOOL_ROOT`。检查采用 `demo/tsconfig.json`，只做 noEmit；不要为了类型解析把旧客户端的 node_modules 路径写入项目配置。

类型配置使用 `Preserve`／`Bundler` 同时检查 Node 原生 TypeScript 与浏览器 ESM，并显式包含 DOM 迭代类型；这是类型解析配置，不增加实际打包器。不能依赖仓库上层某份 `package.json` 推断 ESM。源码继续保留后端 `.ts` 和浏览器已服务模块 `.js` 的显式导入扩展名。

## 启动与隔离

普通启动会创建／打开默认或已配置的数据根目录，保存配置并执行任务恢复。用户任务运行时不要为验证而重启该服务。

```powershell
cd demo
node server.ts
```

需要测试状态、导入、删除、完成或恢复时，另起隔离服务：

```powershell
$sandboxRoot = Join-Path ([IO.Path]::GetTempPath()) ('vedio-workflow-' + [guid]::NewGuid().ToString('N'))
$env:DEMO_DATA_ROOT = Join-Path $sandboxRoot 'data'
$env:DEMO_PROFILE_DIR = Join-Path $sandboxRoot 'profile'
$env:PORT = '4187'
node demo/server.ts
```

使用一个空闲端口，页面与 API 使用相同端口。隔离数据目录不会自动隔离账号：当前模型模块仍可能读环境变量或旁边旧客户端的凭证，不能因此随意点击付费生成。停止自己启动的进程即可，不结束其他客户端或 Node 进程。

## 按改动选择检查

下表测试均不调用付费模型。纯函数／状态测试会建立临时 fixture，渲染测试会调用真实 FFmpeg；它们不是浏览器端到端测试。

| 影响范围 | 在 `demo` 目录运行 | 检查什么 |
| --- | --- | --- |
| 自动配音、字幕对齐、区间失效、旧队列、完成清理 | `node --test tests/workflow.test.ts` | 自动配音失败保留成功区间、手动重试、自动确认且不接旧队列；金额／文字时间校验、局部复用、旧队列及完成清理 |
| 视频提交／草稿边界、旧任务兼容、预览返工 | `node --test tests/preview-rework.test.ts` | 文案／配音不创建记录、render 首次受理标记、停止重试复用、旧记录只读兼容；过期原因、确认不能被设置回滚掩盖、默认保留画面、明确重选且不调模型 |
| 固定口播绑定、AI选片与时间轴 | `node --test tests/fixed-narration-visuals.test.ts tests/shot-selection.test.ts` | 哈希／节点匹配、固定覆盖与空位、候选边界、非法响应／手改校验、按保存方案编排；离线响应，不调用模型 |
| 新选片路径的真实本地合成 | `node --test tests/selection-rendering.test.ts` | 主播图片裁切／渐变、固定视频与商品填充、字幕／原声／配音／BGM、帧量化及不足拒绝；需要 FFmpeg／FFprobe，不调用模型 |
| 媒体时间／帧数、拼接、缓存 | `node --test tests/video-rendering.test.ts` | 非零视频起点、音轨长于画面、真实视频流时长、准确输出帧数、缓存复用；需 FFmpeg／FFprobe |
| 界面交互／样式 | TypeScript 有改动时检查类型，再实际操作受影响页面 | 搜索、输入法与焦点、弹窗、拖动、禁用条件、窄窗口；仅构建或 DOM 断言不能证明手感 |
| 商品原视频切分、命名、恢复 | `node --test tests/material-processing.test.ts tests/material-recovery.test.ts` | 真实 FFmpeg＋离线模型响应；未处理入库、批次失败、固定编号、未命名不可选、ID／来源保持、保存故障与中断恢复；不付费 |
| 仅导航／文档 | 根目录 `node scripts/check-harness.mjs`、`git diff --check` | 入口可达、相对链接、格式；无需重新配音或完整合成 |

复用仍适用的已通过结果；新增改动、失败或具体跨模块风险才扩大检查。新增测试优先复现可观察错误，不断言源码写法或凑数量。报告应包含：命令、覆盖行为、真实模型是否调用、真实用户数据是否触碰、未验证边界。

## 一次性验收与真实操作

三个旧 `verify-*` 验收脚本已移除：它们依赖本机历史素材或直接修改真实任务，包含与当前回归重叠的步骤，不适合作为持续维护的测试入口。历史验证结果仍留在 [验证说明](../../demo/验证说明.md)。

真实模型调用、`POST /api/seed`、导入／重试／删除、确认完成仍是有业务副作用的操作，不能因删除验收脚本就将其当作普通测试。需要复现时使用隔离数据，并明确此次模型调用和真实数据范围。

## 故障 → 证据 → 文件

| 现象 | 先看什么 | 实现入口 |
| --- | --- | --- |
| 启动失败、媒体命令找不到 | `doctor` 结果、该服务 stdout/stderr、配置的工具路径 | `paths.ts`、`media.ts`、server 启动段 |
| 配音文字／时间不对应 | API 失败信息、确认文案、该区间 words/cues/nodeTimes；不公开密钥或音频全文 | `models.ts`、`alignment.ts` |
| 字幕／BGM 改了但预览没变 | 设置 PATCH 是否保存、previewChanges、预览 URL 的生成版本、基础画面签名 | `app.ts` 的草稿合并、`workflow.ts`、`renderer.ts` |
| 闪帧或接缝提前 | 原视频自身短镜头、视频流起点／时长／帧数、计划 piece 帧数；区分源素材和排程问题 | `media.ts`、`plan.ts`、`renderer.ts` |
| 重启后一直生成中 | 持久化 execution.status、是否启动了正确数据目录 | Workflow 构造恢复段；不要自动重发请求 |
| 成片已完成但中间文件仍在 | cleanup.status/error、正式预览是否存在、路径归属 | `workflow.ts` 的 `complete/cleanup` |

## 已知缺口与证据边界

- 当前 UI 按原型布局，真实链路已接文案、配音、AI选片及本地合成，不接旧连续随机队列。商品获取需单独启动本机采集服务并配置平台搜索依赖；发布中心使用独立演示数据，不能把模拟状态当作发布结果。原型样式与演示脚本存于 `public/prototype/`，不要修改本机原型源目录。
- 素材库媒体分类目前依据已有资源的文件名后缀，支持独立图片展示与预览；采集桥与本地路径导入支持图片，图片不进入商品视频候选；素材库浏览器上传控件仍只选择视频，主播图片编辑器另支持上传图片并归入当前商品。成片仅主播下半屏使用共用商品图，其他填充区间仍用视频，不用缩略图补画面。
- 源素材统一裁首尾再切分尚未实现；镜头检测基线已确认 15.2／1.9 秒，命名质量未做付费验收。不要针对某一条视频写硬编码清洗。配置与恢复见 [素材处理](MATERIAL_PROCESSING.md)。
- 已确认“首次选择数据根目录”；当前 server 启动即打开默认／已配置库，`/api/state` 返回 `configured:true`，所以前端初次设置界面不会按该产品规则触发。这是待补实现，不在 harness 工作中顺带修改。
- 当前 `toolsReady:true` 未进行运行时能力探测；`modelReady` 只代表找到凭证，不代表余额、模型或复刻音色可用。`doctor` 不验证账户权益。
- 确认完成后清理本任务audio、work、host-image及旧render目录；保留正式成片所在run、文案／参数／轻量时间记录。清理失败不回退完成状态；确认前旧预览保留。
- 启动恢复、服务信号处理和资产保护有代码实现，但这些测试不是进程崩溃恢复或 HTTP 边界的完整回归覆盖；UI 证据是带日期的手工／浏览器验收，不是随仓自动 UI E2E。
- 固定主播／口播仍需用户本地媒体及绑定清单；`seedAvailable` 目前只检查默认桌面目录。三首默认 BGM 随仓携带，不依赖旧实验目录。干净 clone 不包含用户视频、凭证或复刻音色权益，不能宣称开箱即有真实完整成片。
- 没有生产安装包、云部署、数据迁移或共享能力由本次 harness 自动提供。其他缺口应在发现时记录具体触发条件，而不是预先增加通用框架。

## 提交与上下文维护

只提交本次源码／文档／检查入口。先查看 diff 和暂存列表，不使用 `git add .` 顺带纳入未完成资料；不要提交 `.local`、验证产物、密钥、用户媒体、SQLite 或临时类型工具。`demo/data/bgm/` 是明确随项目提供的默认音轨例外，必须带上配乐清单和许可说明。对外称“已推送”前核对远端分支 SHA。

变更规则写 [PRODUCT](PRODUCT.md)，变更数据及失效写 [DATA_AND_LIFECYCLE](DATA_AND_LIFECYCLE.md)，模块入口变化写 [ARCHITECTURE](ARCHITECTURE.md) 与 [导航](../../AGENT_WIKI.md)；实验结果写带日期的 [验证说明](../../demo/验证说明.md)。不要把一次性过程记录复制进 AGENTS。

### 页面持续显示连接中

如果 `/api/state` 正常而 `/collect/collect-api.js` 返回 404，说明仍有旧服务进程运行并读取了新版前端。启动脚本会校验 `/api/runtime` 的接口版本；脚本自己启动的空闲旧服务可安全替换，有任务时等待结束，不接管其他进程。商品获取脚本加载失败会在该模块显示错误，其余工作台模块仍可加载。
