/* Shared local thumbnails from similar ecommerce products. Sources are recorded
 * in assets/ecommerce-product-thumbnails/manifest.json; seeded and persisted
 * products resolve by stable ID without changing their stored business data. */
(() => {
  'use strict';
  const entries = [
  {
    "id": "p-58096",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-58096.png",
    "alt": "真空收纳压缩袋（相似商品示意图）",
    "label": "真空收纳压缩袋 · 相似商品示意图",
    "sourceUrl": "https://vacuumstoragebags.co.uk/products/vacuum-storage-bags-jumbo"
  },
  {
    "id": "p-58005",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-58005.jpg",
    "alt": "秋冬保暖护肩（相似商品示意图）",
    "label": "秋冬保暖护肩 · 相似商品示意图",
    "sourceUrl": "https://item.jd.com/100317040311.html"
  },
  {
    "id": "p-34337",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-34337.jpg",
    "alt": "原切牛肋排（相似商品示意图）",
    "label": "原切牛肋排 · 相似商品示意图",
    "sourceUrl": "https://patspastured.com/products/beef-short-ribs"
  },
  {
    "id": "p-34349",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-34349.png",
    "alt": "玉米胚芽油（相似商品示意图）",
    "label": "玉米胚芽油 · 相似商品示意图",
    "sourceUrl": "https://shopgulab.com/gulab-prime-refined-corn-oil-5-ltr-jar/"
  },
  {
    "id": "p-34340",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-34340.jpg",
    "alt": "Type-C充电器（相似商品示意图）",
    "label": "Type-C充电器 · 相似商品示意图",
    "sourceUrl": "https://www.walmart.com/ip/Anker-PowerPort-III-Nano-20W/5879821065"
  },
  {
    "id": "p-35121",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-35121.png",
    "alt": "骑行半盔（相似商品示意图）",
    "label": "骑行半盔 · 相似商品示意图",
    "sourceUrl": "https://helmetshop.com/products/d-o-t-german-dull-black"
  },
  {
    "id": "p-36077",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-36077.png",
    "alt": "黑糯玉米（相似商品示意图）",
    "label": "黑糯玉米 · 相似商品示意图",
    "sourceUrl": "https://www.weee.com/en/product/Glutinous-Black-Pearl-Sweet-Waxy-Corn/102417?checkZip=true"
  },
  {
    "id": "p-36090",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-36090.jpg",
    "alt": "带壳核桃（相似商品示意图）",
    "label": "带壳核桃 · 相似商品示意图",
    "sourceUrl": "https://www.sayweee.com/en/product/Walnuts-with-Shell/44782"
  },
  {
    "id": "p-70012",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-70012.jpg",
    "alt": "加绒保暖鞋垫（相似商品示意图）",
    "label": "加绒保暖鞋垫 · 相似商品示意图",
    "sourceUrl": "https://item.jd.com/8312086.html"
  },
  {
    "id": "p-70034",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-70034.jpg",
    "alt": "不锈钢锅清洁用品（相似商品示意图）",
    "label": "不锈钢锅清洁用品 · 相似商品示意图",
    "sourceUrl": "https://shaguncleaning.shop/products/shagun-jumbo-20-stainless-steel-scrubber-pack-of-6-15g-heavy-duty-utensil-kitchen-cleaning-scrub-pads"
  },
  {
    "id": "p-70051",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-70051.jpg",
    "alt": "厨房去污清洁膏（相似商品示意图）",
    "label": "厨房去污清洁膏 · 相似商品示意图",
    "sourceUrl": "https://apublicshop.com/products/scour-cleaning-paste-refill-copy"
  },
  {
    "id": "p-70068",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-70068.jpg",
    "alt": "玻璃吸管杯（相似商品示意图）",
    "label": "玻璃吸管杯 · 相似商品示意图",
    "sourceUrl": "https://troncoshop.com/products/tronco-16oz-glass-cocktail-tumbler-coral-pink"
  },
  {
    "id": "p-70090",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-70090.jpg",
    "alt": "冬季保暖护膝（相似商品示意图）",
    "label": "冬季保暖护膝 · 相似商品示意图",
    "sourceUrl": "https://www.walmart.com/ip/17757621722"
  },
  {
    "id": "p-70115",
    "src": "/prototype/assets/ecommerce-product-thumbnails/p-70115.jpg",
    "alt": "USB-C多孔插排（相似商品示意图）",
    "label": "USB-C多孔插排 · 相似商品示意图",
    "sourceUrl": "https://techpowerup.com.au/products/8-outlet-surge-protector-with-dual-usb-c"
  }
];
  const byId = new Map(entries.map(entry => [entry.id, Object.freeze(entry)]));
  const aliases = { 'thermal-insoles': 'p-70012' };
  function get(product) {
    const id = typeof product === 'string' ? product : product?.productId || product?.id;
    return byId.get(aliases[id] || id) || null;
  }
  window.EcommerceVideoProductImages = Object.freeze({ get });
})();
