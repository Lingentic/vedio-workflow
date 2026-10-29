/* Local prototype state isolation only; real enterprise authorization belongs on the server. */
(() => {
  'use strict';

  function create({ storeKey, createState, getState, setState, restore, serialize, suspend }) {
    let accountId = '';
    let revision = 0;
    const memory = new Map();
    const storageKey = id => `${storeKey}:account:${encodeURIComponent(id)}`;

    const persist = () => {
      if (!accountId) return;
      let snapshot;
      try { snapshot = JSON.stringify(serialize(getState())); } catch { return; }
      memory.set(accountId, snapshot);
      try { localStorage.setItem(storageKey(accountId), snapshot); } catch { /* Keep in-memory data when storage is unavailable. */ }
    };

    const setAccount = value => {
      const nextId = typeof value === 'string' ? value : '';
      if (nextId === accountId) return false;
      persist();
      suspend?.();
      revision += 1;
      accountId = nextId;
      let saved = null;
      if (accountId) {
        try {
          const raw = memory.has(accountId) ? memory.get(accountId) : localStorage.getItem(storageKey(accountId));
          if (raw) saved = JSON.parse(raw);
        } catch { /* A malformed account snapshot must not affect another account. */ }
      }
      // Unscoped legacy keys are deliberately untouched: their enterprise owner is unknown.
      setState(restore(createState(), saved));
      return true;
    };

    const guard = callback => {
      const token = revision;
      return (...args) => {
        // A revision, not just the ID, also invalidates stale work after A → B → A.
        if (accountId && token === revision) return callback(...args);
      };
    };

    return { setAccount, persist, guard };
  }

  window.EcommerceVideoAccountScope = { create };
})();
