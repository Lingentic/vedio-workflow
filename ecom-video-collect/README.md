# 电商视频素材采集模块

电商 AI 视频工作流的**素材采集链路**独立实现：按快手商品 ID 采集分销商品信息与商品图集，再按商品名在快手 / 抖音搜索真实视频素材，人工勾选归入素材池入库，并可一键导入视频工作台素材库。

本模块是 `demo/` 工作台的**上游采集器**：`demo` 自身不做商品抓取，采集产物经其 `/api/products` 与 `/api/products/:id/import` 上游接口入库（契约见 [API.md](../demo/API.md)）。采集页面必须在真实 Chrome/Edge 中打开——商品详情依赖 MV3 扩展的 content script 桥接。

## 目录

| 路径 | 用途 |
| --- | --- |
| `web/` | 轻量页面壳与共享模块（商品列表、录入弹窗、素材池、素材中心） |
| `server/collect_service.py` | 本地 HTTP 服务：静态托管 + 视频搜索 + 媒体中转/下载 + 工作台导入 |
| `server/启动采集服务.bat` | Windows 双击启动器 |
| `extension/` | 快手商品信息采集器（接入版）Chrome 扩展源码 |
| `media/` | 下载素材落盘目录（gitignore 不入库） |

## 前置依赖

- Windows + Python 3.10+
- `pip install curl_cffi`
- **ai-reverse** 仓库检出（私有仓 `Lingentic/ai-reverse`），运行时为 `dist/ai-reverse-pure`；视频搜索需要其中的 Python 客户端与 Node 签名器
- ai-reverse 的 `config/` 下配置好平台凭证（不随仓库分发，禁止提交）：
  - `kuaishou.cookie.txt` — kuaishou.com 登录 Cookie
  - `douyin.cookie.txt` + `session.secrets.json` — douyin.com 登录 Cookie 与设备指纹
- **快手分销达人账号**在 Chrome 中已登录 `cps.kwaixiaodian.com`（商品详情采集走登录态页面 DOM）
- 导入工作台时需要 `demo/` 服务已启动（`cd demo && node server.ts`，默认 `http://127.0.0.1:4186`）

## 配置（二选一，不入库）

1. 环境变量：`AI_REVERSE_DIR=<ai-reverse-pure 路径>`、`WORKBENCH_URL=<工作台地址>`
2. 复制 `server/collect_service.example.json` 为 `server/collect_service.json` 并填入实际值；`workbenchUrl` 缺省为 `http://127.0.0.1:4186`

## 安装扩展

`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录 `extension/`。装好后在同一浏览器打开采集页面，"设置扩展 ID"按钮可探测连通性。

## 运行

```powershell
python server/collect_service.py --port 8765
```

或双击 `server/启动采集服务.bat`。打开 `http://127.0.0.1:8765/index.html`：

1. 商品获取 → 录入商品 → 填快手商品 ID → 「采集」回填名称/价格/佣金/规格/类目/主图 + 详情图集进入图片分区
2. 「开始爬取」按商品名检索快手/抖音视频候选（只爬视频分区）
3. 勾选候选 → 归入素材池 → 确认添加；素材明细（videoId/来源链接/封面/播放地址/本地文件）随商品持久化
4. 商品详情页「导入视频工作台」：把已入池且未推过的视频素材下载到 `media/` 并推入工作台素材库（已处理片段直接入库；已推素材不重复推送）
5. 「素材中心」视图查看已入库素材；`/api/health` 检查凭证与工作台配置

## 与服务接口

- `GET /api/health` — 凭证、ai-reverse 路径、媒体目录与工作台地址自检
- `GET /api/search?platform=&keyword=&pages=` — 双平台视频搜索
- `GET /api/proxy?platform=&url=` — 封面/视频流中转（预览用）
- `POST /api/download` — 单条媒体落盘
- `POST /api/workbench-import` `{product, materials}` — 素材落盘并推入工作台；逐条返回入库状态与跳过原因

## 检查

```powershell
node --check web/host.js
python -m py_compile server/collect_service.py
```

