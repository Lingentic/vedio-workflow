/* 电商工作流共用的真实素材图（PRD v2.4 反馈：商品与素材卡片要有真实图片）。
 * 图片与商品不要求一一对应，按 key 稳定散列取图，同一商品在任何模块里拿到的都是同一张。
 * 全部用仓库内已有素材，不引入新文件、不请求外网。 */
(() => {
  'use strict';

  const IMAGES = [
    '/prototype/assets/video-remake/product-cold-brew.png',
    '/prototype/assets/video-remake/spring-water-product.jpg',
    '/prototype/assets/video-remake/spring-water-reference-poster.jpg',
    '/prototype/assets/video-remake/spring-water-result-poster.jpg',
    '/prototype/assets/inspiration/kirox-01.webp',
    '/prototype/assets/inspiration/kirox-02.webp',
    '/prototype/assets/inspiration/kirox-03.webp',
    '/prototype/assets/inspiration/kirox-04.webp',
    '/prototype/assets/inspiration/kirox-05.webp',
    '/prototype/assets/inspiration/kirox-06.webp',
    '/prototype/assets/inspiration/kirox-07.webp',
    '/prototype/assets/inspiration/kirox-08.webp',
    '/prototype/assets/inspiration/kirox-09.webp',
    '/prototype/assets/inspiration/kirox-10.webp',
    '/prototype/assets/inspiration/kirox-11.webp',
    '/prototype/assets/inspiration/kirox-12.webp',
  ];

  const hash = value => {
    const text = String(value ?? '');
    let sum = 0;
    for (let i = 0; i < text.length; i += 1) sum = (sum * 31 + text.charCodeAt(i)) >>> 0;
    return sum;
  };

  /* of(key)：稳定取一张；of(key, n)：从 key 起顺取 n 张（同一商品的多个素材各不相同） */
  const of = (key, count) => {
    const start = hash(key) % IMAGES.length;
    if (!count || count <= 1) return IMAGES[start];
    return Array.from({ length: count }, (_, i) => IMAGES[(start + i) % IMAGES.length]);
  };

  window.EcommerceVideoImages = { of, list: () => [...IMAGES] };
})();
