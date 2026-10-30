export interface ParagraphSortOptions { canSort(): boolean; onBusy(busy: boolean): void; onMove(nodeId: string, from: number, to: number): void }

export function bindParagraphSort(list: HTMLElement, options: ParagraphSortOptions): void {
  let drag = false;
  let suppressedHandle: { until: number; nodeId: string; dataId: string } | null = null;
  list.addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    const handle = (key.target as Element | null)?.closest<HTMLButtonElement>('[data-paragraph-sort-handle]');
    if (!handle || !key.altKey || (key.key !== 'ArrowLeft' && key.key !== 'ArrowRight') || drag || !options.canSort()) return;
    const item = handle.closest<HTMLElement>('[data-paragraph-sort-item]');
    const nodeId = item?.dataset.nodeId;
    const from = Number(item?.dataset.index);
    if (!item || !nodeId || !Number.isInteger(from)) return;
    const items = [...list.querySelectorAll<HTMLElement>('[data-paragraph-sort-item]')]
      .filter(candidate => candidate.dataset.nodeId === nodeId)
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    const slot = items.indexOf(item), next = items[slot + (key.key === 'ArrowLeft' ? -1 : 1)];
    const to = Number(next?.dataset.index);
    if (!next || !Number.isInteger(to)) return;
    key.preventDefault();
    options.onMove(nodeId, from, to);
  });
  list.addEventListener('click', event => {
    if (!suppressedHandle) return;
    if (performance.now() > suppressedHandle.until) { suppressedHandle = null; return; }
    const handle = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-paragraph-sort-handle]');
    if (!handle || handle.dataset.nodeId !== suppressedHandle.nodeId || handle.dataset.id !== suppressedHandle.dataId) return;
    suppressedHandle = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  list.addEventListener('pointerdown', event => {
    const down = event as PointerEvent;
    const handle = (down.target as Element | null)?.closest<HTMLButtonElement>('[data-paragraph-sort-handle]');
    if (!handle || down.button !== 0 || !down.isPrimary || drag || !options.canSort()) return;
    const item = handle.closest<HTMLElement>('[data-paragraph-sort-item]');
    const nodeId = item?.dataset.nodeId;
    const dataId = handle.dataset.id;
    if (!item || !nodeId || !dataId) return;
    const siblings = [...list.querySelectorAll<HTMLElement>('[data-paragraph-sort-item]')]
      .filter(candidate => candidate.dataset.nodeId === nodeId)
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    if (siblings.length < 2) return;
    const fromSlot = siblings.indexOf(item), fromIndex = Number(item.dataset.index);
    if (fromSlot < 0 || !Number.isInteger(fromIndex)) return;
    const rects = siblings.map(row => row.getBoundingClientRect());
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    const savedStyles = siblings.map(row => [row.style.getPropertyValue('transform'), row.style.getPropertyPriority('transform'), row.style.getPropertyValue('transition'), row.style.getPropertyPriority('transition')] as const);
    const origin = rects[fromSlot], startX = down.clientX, startScroll = list.scrollLeft;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let x = startX, target = fromSlot, active = false, finished = false, ending = false, frame = 0;
    let overlay: HTMLDivElement | null = null, placeholder: HTMLDivElement | null = null;
    let dropAnimation: Animation | undefined;
    const cleanup = (commit: boolean) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame); dropAnimation?.cancel();
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel); handle.removeEventListener('lostpointercapture', lost);
      window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerout', leaveWindow);
      ending = true;
      if (handle.hasPointerCapture(down.pointerId)) handle.releasePointerCapture(down.pointerId);
      overlay?.remove(); placeholder?.remove(); list.classList.remove('is-paragraph-sorting');
      siblings.forEach((row, index) => {
        row.classList.remove('paragraph-sort-source');
        const [transform, transformPriority, transition, transitionPriority] = savedStyles[index];
        if (transform) row.style.setProperty('transform', transform, transformPriority); else row.style.removeProperty('transform');
        if (transition) row.style.setProperty('transition', transition, transitionPriority); else row.style.removeProperty('transition');
      });
      drag = false;
      if (active) suppressedHandle = { until: performance.now() + 700, nodeId, dataId };
      const destination = siblings[target];
      const to = Number(destination?.dataset.index), currentFrom = Number(item.dataset.index);
      options.onBusy(false);
      if (commit && active && options.canSort() && list.contains(item) && item.dataset.nodeId === nodeId && destination?.isConnected && destination.dataset.nodeId === nodeId && target !== fromSlot && Number.isInteger(currentFrom) && Number.isInteger(to)) {
        options.onMove(item.dataset.nodeId, currentFrom, to);
      }
    };
    const cancel = () => cleanup(false);
    const lost = () => { if (!ending) cancel(); };
    const escape = (key: KeyboardEvent) => { if (key.key === 'Escape') { key.preventDefault(); cancel(); } };
    const leaveWindow = (pointer: PointerEvent) => { if (!pointer.relatedTarget) cancel(); };
    const slotX = () => {
      const scroll = list.scrollLeft - startScroll;
      return (target > fromSlot ? rects[target].right - origin.width : rects[target].left) - scroll;
    };
    const paint = () => {
      if (finished || !active) return;
      if (!options.canSort() || !item.isConnected) { cancel(); return; }
      const scroll = list.scrollLeft - startScroll;
      const left = Math.max(rects[0].left - scroll, Math.min(rects.at(-1)!.right - origin.width - scroll, origin.left + x - startX));
      const center = left + origin.width / 2;
      let nearest = fromSlot, distance = Infinity;
      rects.forEach((rect, index) => {
        const next = Math.abs(center - (rect.left + rect.width / 2 - scroll));
        if (next < distance) { nearest = index; distance = next; }
      });
      if (nearest !== target) {
        target = nearest;
        siblings.forEach((row, index) => {
          if (row === item) return;
          const stride = origin.width + gap;
          const shift = index > fromSlot && index <= target ? -stride : index < fromSlot && index >= target ? stride : 0;
          row.style.transform = `translate3d(${shift}px,0,0)`;
        });
      }
      overlay!.style.transform = `translate3d(${left - origin.left}px,0,0)`;
      placeholder!.style.transform = `translate3d(${slotX() - origin.left}px,0,0)`;
      const bounds = list.getBoundingClientRect();
      if (x < bounds.left + 48) list.scrollBy({ left: -Math.min(14, bounds.left + 48 - x) });
      else if (x > bounds.right - 48) list.scrollBy({ left: Math.min(14, x - bounds.right + 48) });
      frame = requestAnimationFrame(paint);
    };
    const activate = () => {
      active = true; list.classList.add('is-paragraph-sorting'); item.classList.add('paragraph-sort-source');
      overlay = document.createElement('div'); overlay.className = 'paragraph-sort-overlay'; overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px` });
      const clone = item.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-paragraph-sort-item'); clone.querySelectorAll('button').forEach(button => { button.tabIndex = -1; button.removeAttribute('id'); });
      overlay.append(clone); document.body.append(overlay);
      placeholder = document.createElement('div'); placeholder.className = 'paragraph-sort-placeholder';
      Object.assign(placeholder.style, { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px` });
      document.body.append(placeholder);
      siblings.forEach(row => { if (row !== item) row.style.transition = reduced ? 'none' : 'transform 140ms ease'; });
      frame = requestAnimationFrame(paint);
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== down.pointerId || ending) return;
      x = pointer.clientX;
      if (!active && Math.hypot(pointer.clientX - startX, pointer.clientY - down.clientY) >= 6) activate();
      if (active) pointer.preventDefault();
    };
    const up = (pointer: PointerEvent) => {
      if (pointer.pointerId !== down.pointerId || ending) return;
      if (!active) { cleanup(false); return; }
      x = pointer.clientX; paint();
      if (finished) return;
      ending = true; cancelAnimationFrame(frame);
      if (reduced) { cleanup(true); return; }
      dropAnimation = overlay!.animate([
        { transform: overlay!.style.transform },
        { transform: `translate3d(${slotX() - origin.left}px,0,0)` },
      ], { duration: 120, easing: 'ease-out', fill: 'forwards' });
      void dropAnimation.finished.then(() => cleanup(true), () => cleanup(false));
    };
    options.onBusy(true); drag = true;
    try { handle.setPointerCapture(down.pointerId); }
    catch { cleanup(false); return; }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel); handle.addEventListener('lostpointercapture', lost);
    window.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    window.addEventListener('pointerout', leaveWindow);
  });
}
