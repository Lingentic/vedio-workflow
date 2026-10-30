// 在扩展的隔离环境中运行；只读取页面可见文字和图片，不发起网络请求。
globalThis.KSDetailExtractor = (() => {
  function clean(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim();
  }

  function findName(lines, idLineIndex) {
    if (idLineIndex < 0) return null;
    const rawNearby = lines.slice(Math.max(0, idLineIndex - 5), idLineIndex)
      .map(line => clean(line
        .replace(/^.*?选品中心\s*[>›＞]\s*/, "")
        .replace(/^选品中心\s*/, "")));
    const nearby = rawNearby
      .filter(line => line.length >= 8 && line.length <= 180 &&
        !/^(快手快分销|选品中心|ID\s*[:：])$/.test(line) &&
        !/(售价|佣金率|剩余库存|好评率|商品类目|商品类别|所属类目|所属分类|商品分类)/.test(line));
    if (nearby.length === 0) return null;
    const last = rawNearby.at(-1);
    const previous = rawNearby.at(-2);
    if (last && previous && last.length < 8 && previous.length >= 8 && !previous.endsWith(last)) {
      nearby.push(clean(previous + last));
    }
    return nearby.sort((a, b) => b.length - a.length)[0] || null;
  }

  function findCategory(lines, idLineIndex) {
    const candidates = [];
    const start = idLineIndex >= 0 ? Math.max(0, idLineIndex - 6) : 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(?:商品类目|商品类别|所属类目|所属分类|商品分类|类目)\s*(?:[:：|｜]\s*|\s+)(.+)$/);
      const value = match?.[1] || (/^(?:商品类目|商品类别|所属类目|所属分类|商品分类|类目)\s*[:：]?$/.test(line) ? lines[i + 1] : null);
      if (!value || value.length > 100 || /^(?:暂无|未知|全部|更多|未填写|未设置)$/.test(value)) continue;
      if (/(?:清空|筛选|搜索|佣金率|售价)/.test(value)) continue;
      const path = value.split(/\s*(?:\/|>|＞|›)\s*/).map(clean).filter(Boolean);
      if (path.length < 1 || path.length > 5 || path.some(part => part.length > 30)) continue;
      candidates.push({ name: path.at(-1), path, evidence: line.slice(0, 120) });
    }
    const distinct = [...new Set(candidates.map(candidate => candidate.path.join(" / ")))];
    return { category: distinct.length === 1 ? candidates[0] : null, candidates: candidates.slice(0, 5) };
  }

  function parseText(text, url) {
    const lines = String(text ?? "").split(/\r?\n/).map(clean).filter(Boolean);
    const idLineIndex = lines.findIndex(line => /^ID\s*[:：]\s*\d{8,}/i.test(line));
    const pageId = idLineIndex >= 0
      ? lines[idLineIndex].match(/^ID\s*[:：]\s*(\d{8,})/i)?.[1] ?? null
      : null;
    const urlId = new URL(url).searchParams.get("relItemId");
    const warnings = [];
    if (urlId && pageId && urlId !== pageId) {
      return { status: "id_mismatch", warnings: ["地址中的 relItemId 与页面显示的 ID 不一致"], fields: null };
    }
    if (!pageId) {
      return { status: "id_unverified", warnings: ["页面未显示可核对的商品 ID，已停止采集"], fields: null };
    }
    const productName = findName(lines, idLineIndex);
    if (!productName) warnings.push("未定位到商品名称");

    // 仅检查商品 ID 后、操作按钮前的概览区域，避免读到推荐商品或下方评论中的数字。
    const overview = idLineIndex >= 0
      ? lines.slice(idLineIndex + 1, Math.min(lines.length, idLineIndex + 35)).join(" ").split(/加入货架|采样后返/)[0]
      : "";
    const priceMatch = overview.match(/售价\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
    const commissionMatch = overview.match(/佣金率\s*(\d+(?:\.\d{1,2})?)\s*%/);
    const categoryResult = findCategory(lines, idLineIndex);
    const specificationCandidates = lines.slice(idLineIndex + 1).filter(line =>
      /^(?:商品规格|规格参数|规格型号|规格)\s*[:：]/.test(line)).map(line =>
      line.replace(/^(?:商品规格|规格参数|规格型号|规格)\s*[:：]\s*/, "").trim()).filter(Boolean);
    const specification = [...new Set(specificationCandidates)].length === 1 ? specificationCandidates[0] : null;
    if (!priceMatch) warnings.push("未定位到售价");
    if (!commissionMatch) warnings.push("未定位到佣金率");
    if (!categoryResult.category) warnings.push(categoryResult.candidates.length > 1
      ? "详情页出现多个不同类目，需人工核对"
      : "详情页未找到明确标注的商品类目");
    if (!specification) warnings.push("详情页未找到明确标注的规格");
    return {
      status: productName && priceMatch && commissionMatch ? "ok" : "insufficient_data",
      warnings,
      categoryCandidates: categoryResult.candidates.map(candidate => candidate.evidence),
      fields: {
        relItemId: urlId || pageId,
        productName,
        priceText: priceMatch ? `¥${priceMatch[1]}` : null,
        commissionText: commissionMatch ? `${commissionMatch[1]}%` : null,
        specification,
        categoryId: null,
        categoryName: categoryResult.category?.name || null,
        categoryPath: categoryResult.category?.path || [],
        categorySource: categoryResult.category ? "detail-page-visible-label" : null,
        categoryGranularity: categoryResult.category ?
          (categoryResult.category.path.length > 1 ? "path" : "unknown") : null
      }
    };
  }

  function findMainImage(document) {
    const candidates = Array.from(document.querySelectorAll("img"))
      .map(img => {
        const rect = img.getBoundingClientRect();
        return { url: img.currentSrc || img.src, area: rect.width * rect.height, rect };
      })
      .filter(item => /^https:\/\//.test(item.url) && item.rect.width >= 250 &&
        item.rect.height >= 250 && item.rect.top >= 0 && item.rect.top < window.innerHeight);
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0]?.url || null;
  }

  /* 商品图集：首屏内 ≥60px 的商品图（主图大图 + 缩略图轮播）。
   * 用尺寸下限与首屏位置排除页头图标与首屏下方的推荐商品缩略图；
   * URL 黑名单再过滤头像 / logo / 图标。 */
  function findGalleryImages(document, mainUrl) {
    const bad = /(avatar|logo|icon|sprite|arrow|blank|loading|default-head|qrcode|qr-code|search)/i;
    const urls = mainUrl ? [mainUrl] : [];
    const seen = new Set(urls);
    for (const img of document.querySelectorAll("img")) {
      const url = img.currentSrc || img.src;
      if (!/^https:\/\//.test(url) || seen.has(url) || bad.test(url)) continue;
      const rect = img.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 60 || rect.top < 0 || rect.top >= window.innerHeight) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= 12) break;
    }
    return urls;
  }

  function elementHint(root, pattern) {
    for (const element of root.querySelectorAll("*")) {
      const directText = Array.from(element.childNodes)
        .filter(node => node.nodeType === 3)
        .map(node => clean(node.textContent))
        .join(" ");
      if (!pattern.test(directText)) continue;
      const path = [];
      let current = element;
      for (let depth = 0; current && depth < 3; depth++, current = current.parentElement) {
        const classes = Array.from(current.classList || []).slice(0, 3).join(".");
        path.push(`${current.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`);
      }
      return path.join(" < ");
    }
    return null;
  }

  function extract(document, location) {
    const main = document.querySelector("main");
    const parsed = parseText(main?.innerText || document.body?.innerText || "", location.href);
    if (!parsed.fields) return parsed;
    const mainImageUrl = findMainImage(document);
    return {
      ...parsed,
      diagnostics: {
        idElement: elementHint(main || document.body, /^ID\s*[:：]/i),
        priceElement: elementHint(main || document.body, /售价/),
        commissionElement: elementHint(main || document.body, /佣金率/),
        categoryCandidateLines: parsed.categoryCandidates
      },
      fields: {
        ...parsed.fields,
        sourceUrl: location.href,
        capturedAt: new Date().toISOString(),
        pageType: "selection-detail",
        mainImageUrl,
        imageUrls: findGalleryImages(document, mainImageUrl)
      }
    };
  }

  return { parseText, extract };
})();
