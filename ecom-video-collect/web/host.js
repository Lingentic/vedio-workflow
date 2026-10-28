/* 宿主薄壳：挂载「商品获取 / 素材中心」两个采集链路模块，提供 toast 与账户作用域。 */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const healthEl = document.getElementById('health');
  const ACCOUNT = new URLSearchParams(location.search).get('account') || 'local';

  let toastTimer = 0;
  const toast = message => {
    if (!message) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 3600);
  };

  const views = {
    products: {
      label: '商品获取',
      html: () => window.EcommerceVideoProducts.html(),
      mount: root => window.EcommerceVideoProducts.mount(root, { toast }),
    },
    assets: {
      label: '素材中心',
      html: () => window.EcommerceVideoAssets.html(),
      mount: root => window.EcommerceVideoAssets.mount(root, { toast, goto: view => show(view) }),
    },
  };
  let active = 'products';

  const syncTabs = () => {
    document.querySelectorAll('#collectTabs [data-view]').forEach(btn => {
      const on = btn.dataset.view === active;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  };

  const show = view => {
    if (!views[view]) return;
    active = view;
    app.innerHTML = views[view].html();
    views[view].mount(app);
    syncTabs();
  };

  document.getElementById('collectTabs').addEventListener('click', event => {
    const btn = event.target.closest('[data-view]');
    if (btn) show(btn.dataset.view);
  });

  window.EcommerceVideoProducts.setAccount(ACCOUNT);
  window.EcommerceVideoAssets.setAccount(ACCOUNT);
  show('products');

  fetch('./api/health').then(r => r.json()).then(h => {
    const ks = h?.platforms?.kuaishou?.cookie;
    const dy = h?.platforms?.douyin?.cookie && h?.platforms?.douyin?.secrets;
    healthEl.textContent = `快手凭证 ${ks ? '✓' : '✗'} · 抖音凭证 ${dy ? '✓' : '✗'}`;
    healthEl.classList.toggle('is-warn', !(ks && dy));
    healthEl.title = `ai-reverse: ${h?.aiReverse || '未配置'}`;
  }).catch(() => { healthEl.textContent = '采集服务未响应'; healthEl.classList.add('is-warn'); });
})();
