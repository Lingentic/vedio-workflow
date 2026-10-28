/* Collection uses its extension origin; material management uses the real workbench. */
(() => {
  'use strict';
  const root = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const healthEl = document.getElementById('health');
  const params = new URLSearchParams(location.search);
  window.CollectApi.setWorkbench(params.get('workbench'));
  let toastTimer;
  const toast = message => {
    toastEl.textContent = message; toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 6500);
  };
  const updateLinks = () => document.querySelectorAll('[data-workbench-page]').forEach(link => {
    link.href = window.CollectApi.workbenchUrl + '/?page=' + encodeURIComponent(link.dataset.workbenchPage);
  });
  updateLinks();
  window.EcommerceVideoProducts.setAccount(params.get('account') || 'local');
  root.innerHTML = window.EcommerceVideoProducts.html();
  window.EcommerceVideoProducts.mount(root, { toast });
  document.getElementById('refreshHealth').addEventListener('click', () => { void checkHealth(); });
  async function checkHealth() {
    try {
      const response = await fetch('/api/health');
      const health = await response.json();
      if (!response.ok || !health.ok) throw new Error('采集服务未就绪');
      window.CollectApi.setWorkbench(health.workbench); updateLinks();
      const ks = health.platforms?.kuaishou?.cookie;
      const dy = health.platforms?.douyin?.cookie && health.platforms?.douyin?.secrets;
      healthEl.textContent = `快手凭证 ${ks ? '✓' : '待配置'} · 抖音凭证 ${dy ? '✓' : '待配置'}`;
      healthEl.classList.toggle('is-warn', !(ks && dy));
      healthEl.title = '采集服务已连接；平台搜索需要对应的登录凭证';
    } catch { healthEl.textContent = '采集服务未响应'; healthEl.classList.add('is-warn'); }
  }
  void checkHealth();
})();
