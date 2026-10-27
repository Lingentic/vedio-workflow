interface SortOptions {
  canSort(): boolean;
  onMove(from: number, to: number): void;
  onBusy(busy: boolean): void;
}

// Pointer capture and a fixed overlay keep the grabbed row separate from the
// animated list. The actual order changes only after a successful drop.
export function bindSortableList(list: HTMLElement, options: SortOptions): void {
  let busy = false;
  const rows = [...list.querySelectorAll<HTMLElement>('[data-manual-row]')];
  rows.forEach((row, from) => {
    const handle = row.querySelector<HTMLButtonElement>('[data-sort-handle]')!;
    handle.addEventListener('keydown', event => {
      const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (!event.altKey || !step || busy || !options.canSort()) return;
      const to = from + step;
      if (to < 0 || to >= rows.length) return;
      event.preventDefault(); options.onMove(from, to);
      document.querySelector<HTMLButtonElement>(`[data-manual-row="${to}"] [data-sort-handle]`)?.focus({ preventScroll: true });
    });
    handle.addEventListener('pointerdown', down => {
      if (down.button !== 0 || !down.isPrimary || busy || !options.canSort()) return;
      down.preventDefault();
      busy = true;
      options.onBusy(true);
      handle.setPointerCapture(down.pointerId);
      const rects = rows.map(item => item.getBoundingClientRect());
      const origin = rects[from], startScroll = window.scrollY;
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      let pointerY = down.clientY, target = from, active = false, settling = false, finished = false;
      let frame = 0, overlay: HTMLDivElement | null = null, placeholder: HTMLDivElement | null = null;
      let dropAnimation: Animation | undefined;
      let overlayY = origin.top;
      const cleanup = (cancelled: boolean) => {
        if (finished) return;
        finished = true; cancelAnimationFrame(frame); dropAnimation?.cancel();
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel); handle.removeEventListener('lostpointercapture', lostCapture);
        window.removeEventListener('keydown', keydown); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel);
        if (handle.hasPointerCapture(down.pointerId)) handle.releasePointerCapture(down.pointerId);
        overlay?.remove(); placeholder?.remove();
        document.body.classList.remove('manual-sort-active'); list.classList.remove('is-sorting');
        rows.forEach(item => { item.classList.remove('sort-source'); item.style.removeProperty('transform'); item.style.removeProperty('transition'); });
        busy = false; options.onBusy(false);
        if (!cancelled && active && target !== from && options.canSort()) options.onMove(from, target);
      };
      const cancel = () => cleanup(true);
      // Browsers release capture automatically on pointerup. The drop animation
      // must finish before committing; only an earlier capture loss cancels it.
      const lostCapture = () => { if (!settling) cancel(); };
      const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
      const slotTop = () => (target > from ? rects[target].bottom - origin.height : rects[target].top) - (window.scrollY - startScroll);
      const activate = () => {
        active = true; list.classList.add('is-sorting'); row.classList.add('sort-source'); document.body.classList.add('manual-sort-active');
        overlay = document.createElement('div'); overlay.className = 'manual-list manual-sort-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        Object.assign(overlay.style, { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px` });
        const clone = row.cloneNode(true) as HTMLElement;
        clone.classList.remove('sort-source'); clone.removeAttribute('data-manual-row');
        clone.querySelectorAll<HTMLElement>('button').forEach(button => { button.tabIndex = -1; button.removeAttribute('id'); });
        overlay.append(clone); document.body.append(overlay);
        placeholder = document.createElement('div'); placeholder.className = 'manual-sort-placeholder';
        Object.assign(placeholder.style, { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px` });
        document.body.append(placeholder);
        rows.forEach(item => { if (item !== row) item.style.transition = reducedMotion ? 'none' : 'transform 160ms cubic-bezier(.2,.8,.2,1)'; });
      };
      const paint = () => {
        if (finished || settling) return;
        if (!options.canSort()) { cancel(); return; }
        const scroll = window.scrollY - startScroll;
        overlayY = Math.max(rects[0].top - scroll, Math.min(rects.at(-1)!.bottom - origin.height - scroll, origin.top + pointerY - down.clientY));
        const center = overlayY + origin.height / 2;
        let nearest = from, distance = Infinity;
        rects.forEach((rect, index) => { const next = Math.abs(center - (rect.top + rect.height / 2 - scroll)); if (next < distance) { nearest = index; distance = next; } });
        if (nearest !== target) {
          target = nearest;
          rows.forEach((item, index) => {
            if (item === row) return;
            const shift = index > from && index <= target ? -(origin.height + gap) : index < from && index >= target ? origin.height + gap : 0;
            item.style.transform = `translate3d(0,${shift}px,0)`;
          });
        }
        overlay!.style.transform = `translate3d(0,${overlayY - origin.top}px,0)`;
        placeholder!.style.transform = `translate3d(0,${slotTop() - origin.top}px,0)`;
        const topEdge = Math.max(60, Math.min(120, (document.querySelector('.stage-tabs')?.getBoundingClientRect().bottom || 50) + 16));
        if (pointerY < topEdge && rects[0].top - scroll < topEdge) window.scrollBy(0, -Math.min(14, (topEdge - pointerY) / 5));
        else if (pointerY > innerHeight - 60 && rects.at(-1)!.bottom - scroll > innerHeight - 60) window.scrollBy(0, Math.min(14, (pointerY - innerHeight + 60) / 5));
        frame = requestAnimationFrame(paint);
      };
      const move = (event: PointerEvent) => {
        if (event.pointerId !== down.pointerId || settling) return;
        pointerY = event.clientY;
        if (!active && Math.abs(pointerY - down.clientY) >= 5) { activate(); frame = requestAnimationFrame(paint); }
      };
      const up = (event: PointerEvent) => {
        if (event.pointerId !== down.pointerId || settling) return;
        if (!active) { cleanup(true); return; }
        paint();
        if (finished) return;
        settling = true; cancelAnimationFrame(frame);
        if (reducedMotion) { cleanup(false); return; }
        dropAnimation = overlay!.animate([
          { transform: `translate3d(0,${overlayY - origin.top}px,0)` },
          { transform: `translate3d(0,${slotTop() - origin.top}px,0)` },
        ], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        void dropAnimation.finished.then(() => cleanup(false), () => cleanup(true));
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel); handle.addEventListener('lostpointercapture', lostCapture);
      window.addEventListener('keydown', keydown); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    });
  });
}
