# Agent 工作入口

本仓库的可运行应用在 `demo/`：独立本地网页 + Node.js 24 / TypeScript 服务，SQLite 持久化，FFmpeg 合成。不是原有 Electron 客户端，也不包含上游商品获取或发布系统。

## 先定位，再按需读取

- 首次进入或跨模块修改：读 [AGENT_WIKI.md](AGENT_WIKI.md)，按任务表选文件，不要求通读全部文档。
- 改产品行为：查 [当前产品契约](docs/harness/PRODUCT.md)。
- 改 API、模块边界或媒体流程：查 [架构](docs/harness/ARCHITECTURE.md) 和 [API](demo/API.md)。
- 改状态、返工、删除或持久化：查 [数据与生命周期](docs/harness/DATA_AND_LIFECYCLE.md)。
- 启动、检查、故障定位或提交：查 [开发与验证](docs/harness/DEVELOPMENT.md)。
- 用户的新决定优先；代码与契约不一致时明确指出，不能用旧实现反过来改写已确认需求。历史调研、原型和本机实验不是当前契约。

## 必须守住的边界

1. 第一版仅含素材库、视频制作、生成记录；不自动引入完整版能力。
2. 服务端保存真实业务状态；前端 `localStorage` 只保存页面／任务定位。相同任务返工更新原记录，`execution.done` 不等于用户已确认完成。
3. 保留用户外部原素材。删除和完成清理只按既定托管目录及归属处理，不清理其他任务；`deleted`、`unavailable` 和处理后源文件 `cleaned` 不能混为一谈。
4. 文案、配音失败或超时不自动重发。不要把付费试验或真实数据脚本当成常规测试。
5. 字幕或 BGM 修改默认保留素材顺序；重配任一区间后重算依赖时间；画面使用视频，缩略图不用于填充成片。
6. 密钥、本机配置、用户媒体、数据库、运行日志及产物不入 Git。不要打印本机密钥文件或 `.env` 内容。
7. 保持 TypeScript 和现有无生产依赖的实现。新增生产依赖、项目级依赖清单或 CI 配置前确认；不要为满足文档模板改技术栈。
8. 修改前看 `git status`；仅操作本任务文件，不恢复、删除或顺带提交其他人的未完成改动。

## 常用命令（仓库根目录）

```powershell
node scripts/check-harness.mjs
node scripts/doctor.mjs
```

启动应用会打开／写入数据目录并恢复任务；先按 [开发说明](docs/harness/DEVELOPMENT.md) 决定使用真实数据还是隔离目录。

```powershell
cd demo
node server.ts
```

验证按影响范围选择，不把全量测试设成每次必跑。UI 改动应实际操作受影响页面；未做的验证明确说明。完成时报告行为变化、具体检查内容与剩余限制，不只给“测试通过”。

## 保持 harness 有效

改入口、API、状态、存储、命令或产品边界时，同步对应专题；只在一个专题维护完整规则，其他文档引用它。修正链接后运行 `node scripts/check-harness.mjs`。临时试验和一次性运行报告不继续堆入这些入口文档。
