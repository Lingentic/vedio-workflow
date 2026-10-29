# 快手商品信息采集器（接入版）

在「独立版」基础上增加页面桥接：电商 AI 视频工作流页面可直接发起商品查询，无需手动打开插件弹窗。

## 使用

1. 浏览器打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
2. 选择“加载已解压的扩展程序”，选中本文件夹。
3. 先在浏览器中登录快手快分销达人账号（cps.kwaixiaodian.com）。
4. 弹窗用法与独立版一致：输入 `relItemId` 数字，点“打开详情页并读取”。

## 页面桥接（新增）

- 插件通过 content script（`src/page-bridge.js`）注入以下来源的页面：`http://127.0.0.1/*`、`http://localhost/*`、`http://192.168.1.12/*`。
- 页面 `window.postMessage({source:"ec-prod-page", type:"KS_PRODUCT_LOOKUP", reqId, id})` 发起查询；
  后台以**非激活标签页**静默打开选品中心详情页，读取完成后自动关闭，结果经
  `window.postMessage({source:"ks-product-bridge", type:"KS_PRODUCT_RESULT", ...})` 回传。
- `KS_PRODUCT_PING` → `KS_PRODUCT_PONG` 用于页面探测插件是否就绪。
- 与弹窗流程的其余逻辑完全一致（同一 detail-extractor、同一读取规则与限制）。

## 读取规则与限制

- 仅从已登录浏览器中可见的页面读取；不调用未公开接口，不需要账号密码或 token。
- 页面显示的 ID 必须与输入和地址一致；不一致或未显示时停止采集。
- 规格只读详情页明确标注的文字，不是完整 SKU；类目同理。
- 页面结构、登录状态、权限或商品下架均可能影响结果；不要对大量 ID 高频请求。
