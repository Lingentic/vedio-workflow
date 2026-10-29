const EMPTY = null;

function clean(value) {
  return value === undefined || value === null || String(value).trim() === ""
    ? EMPTY
    : String(value).trim();
}

export function parsePrice(value) {
  const display = clean(value);
  if (!display) return { display: null, min: null, max: null, currency: "CNY" };
  const numbers = [...display.matchAll(/\d+(?:\.\d{1,2})?/g)].map(match => Number(match[0]));
  const valid = numbers.length >= 1 && numbers.length <= 2 && numbers.every(Number.isFinite);
  if (!valid) return { display, min: null, max: null, currency: "CNY" };
  const [min, max = min] = numbers;
  if (min > max) return { display, min: null, max: null, currency: "CNY" };
  return { display, min, max, currency: "CNY" };
}

export function parseCommission(value) {
  const display = clean(value);
  if (!display) return { display: null, percent: null };
  const match = display.match(/^\s*(\d+(?:\.\d{1,2})?)\s*%?\s*$/);
  const percent = match ? Number(match[1]) : null;
  return { display, percent: percent !== null && percent >= 0 && percent <= 100 ? percent : null };
}

export function createRecord(input = {}) {
  const price = parsePrice(input.priceText);
  const commission = parseCommission(input.commissionText);
  const categoryPath = Array.isArray(input.categoryPath)
    ? input.categoryPath.map(clean).filter(Boolean)
    : [];
  const categoryName = clean(input.categoryName);
  return {
    schemaVersion: 3,
    sourceUrl: clean(input.sourceUrl),
    capturedAt: clean(input.capturedAt),
    pageType: clean(input.pageType),
    identifiers: {
      relItemId: clean(input.relItemId),
      itemId: clean(input.itemId),
      kwaiItemId: clean(input.kwaiItemId)
    },
    productName: clean(input.productName),
    specification: clean(input.specification),
    price,
    commission,
    category: {
      id: clean(input.categoryId),
      name: categoryName,
      path: categoryPath,
      source: categoryName ? clean(input.categorySource) || "detail-page" : null,
      granularity: categoryName ? clean(input.categoryGranularity) || "unknown" : null
    },
    mainImageUrl: clean(input.mainImageUrl),
    imageUrls: (Array.isArray(input.imageUrls) ? input.imageUrls : [])
      .map(clean).filter(url => url && /^https:\/\//.test(url)).slice(0, 12)
  };
}

export function validateRecord(record) {
  const missing = [];
  if (!record.identifiers.relItemId && !record.identifiers.itemId && !record.identifiers.kwaiItemId) missing.push("商品 ID");
  if (!record.productName) missing.push("商品名称");
  if (record.price.min === null) missing.push("价格");
  if (record.commission.percent === null) missing.push("佣金比例");
  if (!record.category.name) missing.push("商品类目");
  return { complete: missing.length === 0, missing, optionalMissing: [] };
}
