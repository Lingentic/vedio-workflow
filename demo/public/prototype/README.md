# 原型界面来源

本目录保存从 `Lingentic/pm` 独立电商原型提取的样式和发布中心演示模块。2026-10-30 按本机独立原型目录再次同步；其 README 标记来源版本为 `baa3f851771735e4149a9dbb9d5a02b30199b700`。本轮更新 `styles.css`、`ecommerce-video-workflow.css`、`ecommerce-video-products.css` 和 `ecommerce-video-publishing.js`；其余静态文件沿用前版。

- `styles.css`、令牌、品牌、独立窗口及 `ecommerce-video-*.css` 保持原型的页面结构与视觉。上级 `workbench.css` 仅负责实际数据入口、弹窗挂载及浏览器窄窗口适配。
- 发布中心保留独立的浏览器演示数据及新版发布设置，不执行真实发布，也不把真实成片自动标为已提交。商品获取当前使用 `/collect/` 下的实际采集组件，此目录同名脚本不作为真实采集实现。
- 随附图片及两个图片索引脚本仅用于商品获取／发布的原型演示，不能作为实际商品素材或视频生成输入；商品缩略图的来源记录见 `assets/ecommerce-product-thumbnails/manifest.json`。
- 真实素材、文案、配音、选片、合成和记录接入在上级 `app.ts` 与 `prototype-views.ts`：沿用原型结构，固定口播从服务端读取绑定，商品选片通过独立 selection 接口保存。`prototype-sort.ts` 调整同一补位区间的暂存顺序，保存校验成功后才能用于合成。状态页读取真实服务执行，不模拟进度、不接旧随机队列；发布入口仍禁用。
- 原型本机源目录保持不变。复制的脚本仅将示意图片路径调整到本目录，避免依赖原项目位置。

上游仓库：https://github.com/Lingentic/pm
