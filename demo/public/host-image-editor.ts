import type { Asset, HostImage } from './app.js';

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export interface ImageDraft { url: string; title: string; width: number; height: number; x: number; y: number; scale: number; assetId?: string; file?: File; }

export function hostImageStyle(image: Pick<ImageDraft, 'url'|'width'|'height'|'x'|'y'|'scale'>): string {
  const ratio = image.width / image.height / (1080 / 960);
  return `background-image:url(${JSON.stringify(image.url)});background-size:${Math.max(1,ratio)*image.scale*100}% ${Math.max(1,1/ratio)*image.scale*100}%;background-position:${image.x*100}% ${image.y*100}%`;
}

export function hostImageEditorView(image: HostImage, host: Asset | undefined, images: Asset[]): string {
  return `<section class="modal host-image-dialog" aria-label="调整商品图片" aria-busy="false">
    <header><div><h2>调整商品图片</h2><p>应用于本片全部主播原声片段</p></div><button type="button" class="host-image-close" data-close-modal aria-label="关闭图片调整">×</button></header>
    <div class="host-image-editor-body"><div class="host-image-editor-preview"><div class="host-image-composite">
      <div class="host-image-crop" data-image-crop tabindex="0" role="img" aria-label="商品图片，拖动或使用方向键调整位置" style="${esc(hostImageStyle({...image,url:image.url!}))}"></div>
      ${host?.url ? `<video class="host-image-host" playsinline preload="metadata" src="${esc(host.url)}" poster="${esc(host.posterUrl || '')}" aria-label="固定主播画面"></video>` : '<span class="host-image-missing-host">暂无主播画面</span>'}
    </div><div class="host-image-editor-preview-actions">${host?.url ? '<button type="button" data-image-play>播放／暂停主播</button>' : ''}<span>拖动下方图片调整位置</span></div></div>
    <aside class="host-image-controls"><div class="host-image-current"><img src="${esc(image.url!)}" alt="当前商品图片"><span data-image-title>${esc(image.title)}</span></div>
      <button type="button" data-image-replace>更换图片</button>
      <div class="host-image-choices" data-image-choices hidden><button type="button" data-image-library>从当前商品素材库选择</button><button type="button" data-image-upload>上传本地图片</button><input type="file" accept="image/png,image/jpeg,image/webp" data-image-file hidden></div>
      <label class="host-image-zoom-label">缩放 <span data-image-scale>100%</span><input type="range" min="1" max="4" step="0.01" value="${image.scale}" data-image-zoom aria-label="图片缩放"></label>
      <button type="button" data-image-reset>还原位置</button><p class="host-image-editor-error" role="alert" data-image-error></p>
    </aside></div><footer><button type="button" data-close-modal>取消</button><button type="button" class="primary" data-image-apply>应用</button></footer>
    <dialog class="host-image-library"><header><h3>当前商品 · 图片素材</h3><button type="button" data-image-library-close aria-label="关闭图片素材库">×</button></header><div class="host-image-gallery">${images.map(asset=>`<button type="button" data-image-choice="${esc(asset.id)}" aria-label="使用${esc(asset.title)}"><img src="${esc(asset.url!)}" alt="${esc(asset.title)}" loading="lazy"><span>${esc(asset.title)}</span></button>`).join('') || '<p class="host-image-gallery-empty">当前商品暂无图片，可先在素材库添加图片，或使用本地上传。</p>'}</div></dialog>
  </section>`;
}

export function bindHostImageEditor(root: HTMLElement, image: HostImage, images: Asset[], save: (draft: ImageDraft) => Promise<void>, applied: () => void): () => void {
  let draft: ImageDraft = {url:image.url!,title:image.title,width:image.width,height:image.height,x:image.x,y:image.y,scale:image.scale};
  let busy = false, choosing = false, localUrl = '', selection = 0;
  const crop = root.querySelector<HTMLElement>('[data-image-crop]')!;
  const zoom = root.querySelector<HTMLInputElement>('[data-image-zoom]')!;
  const error = root.querySelector<HTMLElement>('[data-image-error]')!;
  const draw = () => {
    crop.style.cssText = hostImageStyle(draft);
    zoom.value = String(draft.scale);
    root.querySelector('[data-image-scale]')!.textContent = `${Math.round(draft.scale*100)}%`;
    root.querySelector('[data-image-title]')!.textContent = draft.title;
    root.querySelector<HTMLImageElement>('.host-image-current img')!.src = draft.url;
  };
  const choose = async (url: string, title: string, assetId?: string, file?: File) => {
    const attempt = ++selection, picture = new Image(); picture.src = url; choosing=true;
    try { await picture.decode(); }
    catch { if(attempt===selection) {choosing=false;error.textContent='无法读取这张图片，请选择 JPG、PNG 或 WEBP 图片';} return; }
    if(attempt!==selection || !root.isConnected) return;
    if(localUrl && localUrl!==url) URL.revokeObjectURL(localUrl);
    localUrl = file ? url : '';
    choosing=false;draft={url,title,width:picture.naturalWidth,height:picture.naturalHeight,x:.5,y:.5,scale:1,assetId,file};
    error.textContent=''; root.querySelector<HTMLElement>('[data-image-choices]')!.hidden=true; draw();
  };
  root.querySelector('[data-image-replace]')!.addEventListener('click',()=>{const choices=root.querySelector<HTMLElement>('[data-image-choices]')!;choices.hidden=!choices.hidden;});
  const library=root.querySelector<HTMLDialogElement>('.host-image-library')!;
  root.querySelector('[data-image-library]')!.addEventListener('click',()=>library.showModal());
  root.querySelector('[data-image-library-close]')!.addEventListener('click',()=>library.close());
  // Escape dismisses this picker only; keep the position editor and its unsaved draft.
  library.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  root.querySelectorAll<HTMLButtonElement>('[data-image-choice]').forEach(button=>button.addEventListener('click',()=>{const asset=images.find(item=>item.id===button.dataset.imageChoice)!;library.close();void choose(asset.url!,asset.title,asset.id);}));
  const fileInput=root.querySelector<HTMLInputElement>('[data-image-file]')!;
  root.querySelector('[data-image-upload]')!.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',()=>{
    const file=fileInput.files?.[0];if(!file)return;
    if(file.size>20*1024*1024 || !/\.(png|jpe?g|webp)$/i.test(file.name)){error.textContent='请选择不超过 20 MB 的 JPG、PNG 或 WEBP 图片';return;}
    const url=URL.createObjectURL(file);void choose(url,file.name,undefined,file).finally(()=>{if(localUrl!==url)URL.revokeObjectURL(url);});
    fileInput.value='';
  });
  zoom.addEventListener('input',()=>{draft.scale=Number(zoom.value);draw();});
  root.querySelector('[data-image-reset]')!.addEventListener('click',()=>{draft.x=.5;draft.y=.5;draft.scale=1;draw();});
  const overflow = () => {const rect=crop.getBoundingClientRect(),fit=Math.max(rect.width/draft.width,rect.height/draft.height)*draft.scale;return {x:rect.width-draft.width*fit,y:rect.height-draft.height*fit};};
  let drag: {id:number;px:number;py:number;x:number;y:number} | null=null;
  const move=(dx:number,dy:number,x=draft.x,y=draft.y)=>{const size=overflow();draft.x=size.x<-.1?Math.max(0,Math.min(1,x+dx/size.x)):.5;draft.y=size.y<-.1?Math.max(0,Math.min(1,y+dy/size.y)):.5;draw();};
  crop.addEventListener('pointerdown',event=>{if(busy || event.button!==0)return;drag={id:event.pointerId,px:event.clientX,py:event.clientY,x:draft.x,y:draft.y};crop.setPointerCapture(event.pointerId);crop.classList.add('is-dragging');});
  crop.addEventListener('pointermove',event=>{if(drag&&event.pointerId===drag.id)move(event.clientX-drag.px,event.clientY-drag.py,drag.x,drag.y);});
  const stop=()=>{drag=null;crop.classList.remove('is-dragging');};crop.addEventListener('pointerup',stop);crop.addEventListener('pointercancel',stop);
  crop.addEventListener('keydown',event=>{if(busy || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();move(event.key==='ArrowLeft'?-8:event.key==='ArrowRight'?8:0,event.key==='ArrowUp'?-8:event.key==='ArrowDown'?8:0);});
  root.querySelector('[data-image-play]')?.addEventListener('click',()=>{const video=root.querySelector('video')!;if(video.paused)void video.play().catch(reason=>{error.textContent=(reason as Error).message;});else video.pause();});
  root.querySelector('[data-image-apply]')!.addEventListener('click',()=>{void (async()=>{
    if(busy || choosing)return;busy=true;root.setAttribute('aria-busy','true');error.textContent='';
    root.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(control=>{control.disabled=true;});
    const apply=root.querySelector('[data-image-apply]')!;apply.textContent='正在保存…';let success=false;
    try{await save({...draft});success=true;}catch(reason){error.textContent=(reason as Error).message;}
    finally{busy=false;root.setAttribute('aria-busy','false');root.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(control=>{control.disabled=false;});apply.textContent='应用';}
    if(success)applied();
  })();});
  draw();
  return ()=>{selection++;library.close();if(localUrl)URL.revokeObjectURL(localUrl);root.querySelector('video')?.pause();};
}
