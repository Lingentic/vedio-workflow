# 仓库导航

入口约定见 [AGENTS.md](AGENTS.md)。本文件负责“做什么任务，先看哪里”；不会要求每次加载完整仓库。

## 上下文层次

| 需要知道什么 | 读取入口 |
| --- | --- |
| 项目能做什么、如何启动 | [README](README.md)、[Demo 使用说明](demo/README.md) |
| 当前产品行为与明确边界 | [PRODUCT](docs/harness/PRODUCT.md) |
| 请求、模型、媒体如何流动 | [ARCHITECTURE](docs/harness/ARCHITECTURE.md)、[API](demo/API.md) |
| 状态、快照、失效和清理 | [DATA_AND_LIFECYCLE](docs/harness/DATA_AND_LIFECYCLE.md) |
| 运行命令、副作用、测试选择、故障定位 | [DEVELOPMENT](docs/harness/DEVELOPMENT.md) |
| 以前实际做过哪些验证 | [验证说明](demo/验证说明.md)，它是带日期的证据，不是新增需求 |

## 任务 → 代码 → 验证

下表是定位起点；阅读命中的函数和直接依赖即可。跨阶段变更再扩大范围。

| 任务 | 代码入口／符号 | 主要验证 |
| --- | --- | --- |
| 原型五模块布局、三步制作与接入边界 | [prototype-views.ts](demo/public/prototype-views.ts)、[workbench.css](demo/public/workbench.css)、[原型来源](demo/public/prototype/README.md)；app.ts 的 `render` | 五模块、只读参考、固定文本保护、隔离自动配音与试听；选材不触发旧 plan／render，演示岛不改业务库 |
| 商品搜索、素材库展示 | [prototype-views.ts](demo/public/prototype-views.ts)：`libraryView`；[app.ts](demo/public/app.ts)：`renderLibrary`、`bind` | 商品目录搜索与当前目录文件搜索、状态／类型筛选、预览、中文输入、窄窗口 |
| 商品输入、导入、切分、重试、删除 | [server.ts](demo/server.ts) 商品／素材路由；[library.ts](demo/lib/library.ts)：`validateProduct`、`importFiles`、`split`、`retry`、`remove` | API 边界与隔离文件验证；必要时真实 FFmpeg；不碰用户外部原文件 |
| 新任务、切换、记录、草稿恢复 | [app.ts](demo/public/app.ts)：`renderProduction`、`renderRecords`、`queueTaskPatch`、`flushTaskDraft`；[workflow.ts](demo/lib/workflow.ts)：`create`、`patch`、`switch` | 实际页面与隔离服务；恢复逻辑不等于已存在自动进程测试 |
| 固定模板、变量、文案提示词 | [templates.json](demo/data/templates.json)、[copy-prompt.txt](demo/data/copy-prompt.txt)、[templates.ts](demo/lib/templates.ts)、[models.ts](demo/lib/models.ts)：`copy` | 固定节点不可变、响应 ID 校验；通常不需要真实模型请求 |
| 自动配音、时间戳、字幕切句 | [workflow.ts](demo/lib/workflow.ts)：`confirmCopyAndVoice`、`generateVoice`、`acceptVoice`；[models.ts](demo/lib/models.ts)：`voice`；[alignment.ts](demo/lib/alignment.ts)：`alignAudio` | `workflow.test.ts` 的自动配音、失败重试、时间对应及局部失效；真实配音另授权 |
| 自动队列、通用主播画面、手选时长 | [plan.ts](demo/lib/plan.ts)：`soundBlocks`、`visualEvents`、`buildPlan`、`fullCues` | `workflow.test.ts` 队列用例；必要时 `preview-rework.test.ts` |
| 原型选材弹窗与原片预览 | [prototype-views.ts](demo/public/prototype-views.ts)：`materialPickerView`、`generationView`；[app.ts](demo/public/app.ts)：`prototype-materials` 等动作 | 多选、预览后保留选择、取消／应用、Esc；不提交旧 plan／render。旧 `sortable.ts` 不用于此演示 |
| 进度更新、页面抖动、播放／输入中断 | [app.ts](demo/public/app.ts)：`patchView`、`newElements`、`refresh` | 连续进度时节点身份／滚动／播放器保持；新结果局部出现、事件不重复；使用隔离数据模拟服务 |
| 分屏、帧率、闪帧、字幕和 BGM | [renderer.ts](demo/lib/renderer.ts)：`renderTask`、`assDocument`；[media.ts](demo/lib/media.ts)；[plan.ts](demo/lib/plan.ts) | `video-rendering.test.ts`；设置返工再加 `preview-rework.test.ts` |
| 预览失效、重生成与完成 | [workflow.ts](demo/lib/workflow.ts)：`previewInputs`、`previewChanges`、`render`、`complete`、`cleanup`；[app.ts](demo/public/app.ts)：`showRegenerationDialog` | `preview-rework.test.ts`；清理改动加 `workflow.test.ts` 完成用例 |
| 数据位置、存储结构、迁移 | [paths.ts](demo/lib/paths.ts)、[store.ts](demo/lib/store.ts)、[types.ts](demo/lib/types.ts) | 先读数据专题；用临时目录验证，不在真实库试迁移 |
| 服务启动／停止、同源与媒体 Range | [server.ts](demo/server.ts)：启动段、路由边界、`sendFile`、信号处理 | 环境诊断 + 隔离端口／数据目录的服务验证 |
| 上游素材采集、工作台导入 | [ecom-video-collect/](ecom-video-collect/)：`server/collect_service.py` 搜索／下载／`workbench_import`；`web/` 采集页；`extension/` 商品详情提取 | 双服务联动冒烟 + Python/JS 语法；需外部 ai-reverse 凭证、Chrome 扩展与快分销登录态，非开箱即用 |

## 快速证据与命令

- [环境诊断](scripts/doctor.mjs)：仅在环境变化或启动／媒体工具问题时检查版本及能力，不是每次修改的固定步骤。
- [导航检查](scripts/check-harness.mjs)：文件可达、相对链接存在，不联网检查外部地址。
- [类型检查](scripts/check-types.mjs)：显式使用临时开发工具目录，不自动下载安装包。
- 测试名称、前提和副作用看 [开发与验证矩阵](docs/harness/DEVELOPMENT.md#按改动选择检查)。

## 非应用代码与历史资料

- `docs/harness/` 是当前随仓维护的 Agent 上下文，不是自动生成报告。
- `docs/` 中的早期需求／调研是历史范围，不能据此加入完整版功能。
- 某些本机 checkout 另有 `最简版/`、`完整版/`、`preview/` 或旁边的旧客户端；它们可能尚未提交或属于原型，不是本仓库运行、检查或入门的必需依赖。需要参考时先核实 Git 状态与资料日期。
- `.local/`、`verification/` 和 Videos 中的数据是机器状态，不是另一个实现来源。不要为了定位代码通读或输出其中的账号／用户文件。依赖这些旧实验的一次性验收脚本已移除，不再作为验证入口。
