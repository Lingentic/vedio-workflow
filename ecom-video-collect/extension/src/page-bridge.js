// 页面桥接：在电商工作流页面上运行（隔离世界）。
// 页面 window.postMessage({source:"ec-prod-page", type:"KS_PRODUCT_LOOKUP", reqId, id})
//   -> 转发给后台打开选品中心详情页读取
//   -> 回传 window.postMessage({source:"ks-product-bridge", type:"KS_PRODUCT_RESULT", reqId, ok, ...})
// 另支持 KS_PRODUCT_PING -> KS_PRODUCT_PONG 用于页面探测插件是否就绪。
(() => {
  const PAGE_SOURCE = "ec-prod-page";
  const BRIDGE_SOURCE = "ks-product-bridge";

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE) return;

    if (message.type === "KS_PRODUCT_PING") {
      window.postMessage({
        source: BRIDGE_SOURCE,
        type: "KS_PRODUCT_PONG",
        reqId: message.reqId,
        version: chrome.runtime.getManifest().version
      }, location.origin);
      return;
    }

    if (message.type === "KS_PRODUCT_LOOKUP") {
      const reqId = message.reqId;
      chrome.runtime.sendMessage(
        { type: "LOOKUP_BRIDGE", id: String(message.id ?? "").trim() },
        response => {
          const err = chrome.runtime.lastError;
          if (err) {
            window.postMessage({
              source: BRIDGE_SOURCE, type: "KS_PRODUCT_RESULT", reqId,
              ok: false, error: err.message || "扩展通信失败"
            }, location.origin);
            return;
          }
          window.postMessage({
            source: BRIDGE_SOURCE, type: "KS_PRODUCT_RESULT", reqId,
            ok: Boolean(response?.ok),
            record: response?.record || null,
            status: response?.status || null,
            warnings: response?.warnings || [],
            error: response?.error || null
          }, location.origin);
        }
      );
    }
  });
})();
