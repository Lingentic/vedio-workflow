import { createRecord } from "./schema.mjs";

const DETAIL = "https://cps.kwaixiaodian.com/pc/promoter/selection-center/detail";
const VALID_ID = /^\d{8,30}$/;

async function collect(tabId, expectedId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith(DETAIL + "?")) throw new Error("当前页面不是选品中心商品详情页");
  const actualId = new URL(tab.url).searchParams.get("relItemId");
  if (actualId !== expectedId) throw new Error("详情页地址的商品 ID 与输入值不一致");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["src/detail-extractor.js"] });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.KSDetailExtractor.extract(document, location)
  });
  const result = results[0]?.result;
  if (!result?.fields) throw new Error(result?.warnings?.join("；") || "页面尚未显示商品信息");
  if (!result.fields.productName) throw new Error("页面尚未定位到商品名称");
  if (result.fields.relItemId !== expectedId) throw new Error("页面商品 ID 与输入值不一致");
  return { status: result.status, warnings: result.warnings, record: createRecord(result.fields) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "LOOKUP") {
    const id = String(message.id ?? "").trim();
    if (!VALID_ID.test(id)) { sendResponse({ error: "请输入 8 到 30 位数字 relItemId" }); return; }
    const url = `${DETAIL}?relItemId=${encodeURIComponent(id)}`;
    chrome.tabs.create({ url, active: true }).then(tab => {
      chrome.storage.session.set({ [`pending_${tab.id}`]: id }).then(() => sendResponse({ tabId: tab.id }));
    }).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "GET_RESULT") {
    chrome.storage.local.get("lastResult").then(({ lastResult }) => sendResponse(lastResult || null));
    return true;
  }
  /* 页面桥接查询：content script 转发工作流页面发来的商品 ID。
   * 与弹窗流程的区别：详情页后台静默打开、读完后自动关闭、结果直接回传给页面。 */
  if (message?.type === "LOOKUP_BRIDGE") {
    const id = String(message.id ?? "").trim();
    if (!VALID_ID.test(id)) { sendResponse({ ok: false, error: "请输入 8 到 30 位数字 relItemId" }); return; }
    (async () => {
      let tab = null;
      try {
        tab = await chrome.tabs.create({
          url: `${DETAIL}?relItemId=${encodeURIComponent(id)}`,
          active: false
        });
        await chrome.storage.session.set({ [`pending_${tab.id}`]: id });
        const deadline = Date.now() + 50000;
        while (Date.now() < deadline) {
          const { lastResult } = await chrome.storage.local.get("lastResult");
          if (lastResult && lastResult.tabId === tab.id && lastResult.id === id) {
            try { await chrome.tabs.remove(tab.id); } catch { /* 页面可能已被用户关掉 */ }
            if (lastResult.error) return sendResponse({ ok: false, error: lastResult.error });
            return sendResponse({
              ok: true,
              status: lastResult.status,
              warnings: lastResult.warnings || [],
              record: lastResult.record || null
            });
          }
          await new Promise(resolve => setTimeout(resolve, 700));
        }
        try { await chrome.tabs.remove(tab.id); } catch { }
        sendResponse({ ok: false, error: "读取详情页超时；请确认浏览器已登录快分销达人账号后重试" });
      } catch (error) {
        if (tab) { try { await chrome.tabs.remove(tab.id); } catch { } }
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "complete") return;
  chrome.storage.session.get(`pending_${tabId}`).then(async stored => {
  const id = stored[`pending_${tabId}`];
  if (!id) return;
  let attempts = 0;
  const attempt = async () => {
    try {
      const data = await collect(tabId, id);
      await chrome.storage.local.set({ lastResult: { id, tabId, ...data } });
      await chrome.storage.session.remove(`pending_${tabId}`);
    } catch (error) {
      attempts++;
      if (attempts < 6 && /尚未|未显示|未定位到商品名称/.test(error.message)) {
        setTimeout(attempt, 1000);
      } else {
        await chrome.storage.local.set({ lastResult: { id, tabId, error: error.message } });
        await chrome.storage.session.remove(`pending_${tabId}`);
      }
    }
  };
  setTimeout(attempt, 800);
  });
});
