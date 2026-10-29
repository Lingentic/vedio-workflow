const $ = id => document.getElementById(id);
let current = null;
function render(data) {
  if (!data) return;
  if (data.error) { $("status").textContent = `读取失败：${data.error}`; $("result").hidden = true; return; }
  current = data.record;
  $("status").textContent = "已读取详情页。空缺字段表示页面没有明确提供。";
  const rows = [
    ["商品 ID", current.identifiers.relItemId], ["名称", current.productName],
    ["价格", current.price.display], ["规格", current.specification],
    ["佣金比例", current.commission.display], ["类目", current.category.path.join(" > ") || current.category.name],
    ["详情页", current.sourceUrl]
  ];
  $("fields").replaceChildren(...rows.map(([label, value]) => {
    const box = document.createDocumentFragment();
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value || "未获取";
    box.append(dt, dd); return box;
  }));
  $("warnings").textContent = data.warnings?.join("；") || "";
  $("result").hidden = false;
}
$("lookup").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("id").value.trim();
  if (!/^\d{8,30}$/.test(id)) { $("status").textContent = "请输入 8 到 30 位数字 relItemId"; return; }
  $("status").textContent = "正在打开详情页；页面加载完成后重新打开插件查看结果。";
  $("result").hidden = true;
  await chrome.storage.local.remove("lastResult");
  const response = await chrome.runtime.sendMessage({ type: "LOOKUP", id });
  if (response.error) $("status").textContent = response.error;
});
$("copy").addEventListener("click", async () => {
  if (current) { await navigator.clipboard.writeText(JSON.stringify(current, null, 2)); $("status").textContent = "JSON 已复制"; }
});
chrome.runtime.sendMessage({ type: "GET_RESULT" }).then(render);
