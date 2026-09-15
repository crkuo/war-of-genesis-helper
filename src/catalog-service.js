// CatalogService: pure query/filter/sort/formatting logic over the static equipment,
// jewel, and Steam-market-price tables embedded in the page.
//
// Boundary: functions here take plain data in and return plain data out — no
// document.* calls. The one exception is resolveTotalStorage, which reads/writes a
// couple of localStorage keys (detected warehouse tab count); that's app *state*,
// not DOM, and keeping it inline here avoids threading it through three call sites
// for no real decoupling benefit. Filtering DOM inputs (search box, dropdowns) into
// a plain `filters` object is the caller's job — see getFilteredEquipments/
// getFilteredJewels in the main script, which do that and then call in here.
window.CatalogService = (function () {
  'use strict';

  function getTierStyle(tier) {
    const t = parseInt(tier) || 1;
    const styles = {
      1: { border: '1.5px solid #484f58', bg: '#21262d', shadow: 'none', color: '#8b949e' }, // tier 1 không màu / xám tối
      2: { border: '2px solid #2ea043', bg: 'linear-gradient(145deg, rgba(40,97,34,0.55), rgba(15,45,15,0.8))', shadow: '0 0 7px rgba(46,160,67,0.4)', color: '#7ee787' }, // tier 2 xanh lá cây
      3: { border: '2px solid #388bfd', bg: 'linear-gradient(145deg, rgba(25,73,116,0.6), rgba(10,30,55,0.85))', shadow: '0 0 8px rgba(56,139,253,0.45)', color: '#58a6ff' }, // tier 3 xanh lam
      4: { border: '2px solid #f85149', bg: 'linear-gradient(145deg, rgba(134,41,39,0.6), rgba(55,15,15,0.85))', shadow: '0 0 8px rgba(248,81,73,0.5)', color: '#ff7b72' }, // tier 4 đỏ
      5: { border: '2px solid #bc8cff', bg: 'linear-gradient(145deg, rgba(128,39,134,0.6), rgba(50,15,55,0.85))', shadow: '0 0 8px rgba(188,140,255,0.5)', color: '#d2a8ff' }, // tier 5 tím
      6: { border: '2px solid #f2cc60', bg: 'linear-gradient(145deg, rgba(178,140,20,0.6), rgba(70,50,10,0.85))', shadow: '0 0 10px rgba(242,204,96,0.5)', color: '#f2cc60' }, // tier 6 vàng cam
      7: { border: '2px solid #39ffff', bg: 'linear-gradient(145deg, rgba(61,166,176,0.6), rgba(20,65,70,0.85))', shadow: '0 0 10px rgba(57,255,255,0.5)', color: '#56d4dd' }, // tier 7 xanh ngọc
      8: { border: '2px solid #ff55de', bg: 'linear-gradient(145deg, rgba(184,62,140,0.6), rgba(70,20,55,0.85))', shadow: '0 0 10px rgba(255,85,222,0.5)', color: '#ff7bce' }, // tier 8 hồng tím
      9: { border: '2px solid #f74931', bg: 'linear-gradient(145deg, rgba(184,62,82,0.6), rgba(70,20,30,0.85))', shadow: '0 0 10px rgba(247,73,49,0.5)', color: '#ff5449' }, // tier 9 huyết sắc
      10: { border: '2px solid #ffa657', bg: 'linear-gradient(145deg, rgba(217,71,207,0.6), rgba(80,20,75,0.85))', shadow: '0 0 12px rgba(255,166,87,0.5)', color: '#ffa657' }
    };
    return styles[t] || (t > 10 ? styles[10] : styles[1]);
  }

  function formatSteamPrice(priceUsd, isEn) {
    if (priceUsd === undefined || priceUsd === null || isNaN(priceUsd) || priceUsd <= 0) return '—';
    if (isEn) {
      return '$' + Number(priceUsd).toFixed(2);
    } else {
      const vnd = Math.round(Number(priceUsd) * STEAM_USD_TO_VND_RATE);
      return Number(vnd).toLocaleString('vi-VN') + ' ₫';
    }
  }

  function getEquipSteamPrice(e) {
    if (!e || typeof steamMarketPrices === 'undefined' || !steamMarketPrices) return null;
    const nameEn = e.name_en || '';
    const tier = parseInt(e.tier) || 1;
    const keyWithTier = nameEn + ' (Tier ' + tier + ')';

    // 1. Strict match with Tier: "Valentine (Tier 5)"
    if (steamMarketPrices[keyWithTier]) {
      const m = steamMarketPrices[keyWithTier];
      return {
        name: m.name,
        price_usd: m.price_usd,
        price_text: m.price_text,
        listings: m.listings,
        type: m.type,
        // Use Steam Market Search URL to prevent "Failed to load item description" errors
        url: 'https://steamcommunity.com/market/search?appid=4891320&q=' + encodeURIComponent(keyWithTier)
      };
    }

    // 2. Only match without Tier if the equipment is truly Tier 1 (base item)
    if (tier === 1 && steamMarketPrices[nameEn]) {
      const m = steamMarketPrices[nameEn];
      return {
        name: m.name,
        price_usd: m.price_usd,
        price_text: m.price_text,
        listings: m.listings,
        type: m.type,
        url: 'https://steamcommunity.com/market/search?appid=4891320&q=' + encodeURIComponent(nameEn)
      };
    }

    // If tier > 1 and there is no listing for this specific tier, do not fallback to tier 1
    return null;
  }

  // filters: { q, slot, tier, level ('min-max' string), sortBy }
  function filterEquipments(equipments, filters) {
    filters = filters || {};
    const q = (filters.q || '').toLowerCase().trim();
    const slotFilter = filters.slot || '';
    const tierFilter = filters.tier || '';
    const levelFilter = filters.level || '';
    const sortBy = filters.sortBy || 'level_asc';

    let result = equipments.filter(function(e) {
      if (q && !e.name_vi.toLowerCase().includes(q) && !e.name_en.toLowerCase().includes(q) && !(e.slot_name || '').toLowerCase().includes(q)) return false;
      if (slotFilter && String(e.slot) !== slotFilter) return false;
      if (tierFilter && String(e.tier) !== tierFilter) return false;
      if (levelFilter) {
        const parts = levelFilter.split('-');
        const minLv = parseInt(parts[0]);
        const maxLv = parseInt(parts[1]);
        const lv = e.level_req || 0;
        if (lv < minLv || lv > maxLv) return false;
      }
      return true;
    });

    result.sort(function(a, b) {
      if (sortBy === 'level_asc') return (a.level_req || 0) - (b.level_req || 0);
      if (sortBy === 'level_desc') return (b.level_req || 0) - (a.level_req || 0);
      if (sortBy === 'tier_desc') return (b.tier || 0) - (a.tier || 0);
      if (sortBy === 'tier_asc') return (a.tier || 0) - (b.tier || 0);
      if (sortBy === 'name_asc') return (a.name_vi || '').localeCompare(b.name_vi || '');
      if (sortBy === 'gold_desc') return (b.price_gold || 0) - (a.price_gold || 0);
      if (sortBy === 'steam_desc') {
        const pA = getEquipSteamPrice(a)?.price_usd || 0;
        const pB = getEquipSteamPrice(b)?.price_usd || 0;
        return pB - pA;
      }
      if (sortBy === 'steam_asc') {
        const pA = getEquipSteamPrice(a) ? getEquipSteamPrice(a).price_usd : 999999;
        const pB = getEquipSteamPrice(b) ? getEquipSteamPrice(b).price_usd : 999999;
        return pA - pB;
      }
      return 0;
    });

    return result;
  }

  // filters: { query, category, grade, market ('all'|'market_only'), sortBy }
  function filterJewels(jewelDatabase, filters) {
    filters = filters || {};
    const query = (filters.query || '').trim().toLowerCase();
    const filterCat = filters.category || '';
    const filterGrade = filters.grade || '';
    const filterMarket = filters.market || 'all';
    const sortBy = filters.sortBy || 'steam_desc';

    let list = jewelDatabase.filter(function(j) {
      if (query) {
        const vName = (j.name_vi || '').toLowerCase();
        const eName = (j.name_en || '').toLowerCase();
        const oTexts = (j.options || []).map(o => (o.name_vi + ' ' + o.name_en).toLowerCase()).join(' ');
        if (!vName.includes(query) && !eName.includes(query) && !oTexts.includes(query)) return false;
      }
      if (filterCat && j.category_vi !== filterCat && j.category_en !== filterCat) return false;
      if (filterGrade && String(j.grade) !== filterGrade) return false;
      if (filterMarket === 'market_only' && (!j.steam_price_usd || j.steam_price_usd <= 0)) return false;
      return true;
    });

    list.sort(function(a, b) {
      if (sortBy === 'steam_desc') {
        const pA = a.steam_price_usd || 0;
        const pB = b.steam_price_usd || 0;
        if (pB !== pA) return pB - pA;
        return (b.grade || 0) - (a.grade || 0);
      }
      if (sortBy === 'steam_asc') {
        const pA = a.steam_price_usd ? a.steam_price_usd : 999999;
        const pB = b.steam_price_usd ? b.steam_price_usd : 999999;
        if (pA !== pB) return pA - pB;
        return (b.grade || 0) - (a.grade || 0);
      }
      if (sortBy === 'grade_desc') {
        if (b.grade !== a.grade) return b.grade - a.grade;
        return (b.steam_price_usd || 0) - (a.steam_price_usd || 0);
      }
      if (sortBy === 'grade_asc') {
        if (a.grade !== b.grade) return a.grade - b.grade;
        return (b.steam_price_usd || 0) - (a.steam_price_usd || 0);
      }
      if (sortBy === 'name_asc') {
        return (a.name_vi || '').localeCompare(b.name_vi || '');
      }
      return 0;
    });

    return list;
  }

  // Resolves total warehouse slot capacity from manual override / previously-detected
  // tab count / the highest occupied tab actually seen in allItems, persisting the
  // detected max back to localStorage so it only ever grows within a session.
  function resolveTotalStorage(allItems, slotPerTab, manualTabs) {
    slotPerTab = slotPerTab || 42;
    let detectedTabs = 1;

    const savedMode = manualTabs || localStorage.getItem('genesis_warehouse_tabs_mode') || 'auto';
    if (savedMode !== 'auto') {
      const parsed = parseInt(savedMode, 10);
      if (!isNaN(parsed) && parsed > 0) detectedTabs = parsed;
    }

    const savedDetected = parseInt(localStorage.getItem('genesis_detected_warehouse_tabs') || '1', 10);
    if (!isNaN(savedDetected) && savedDetected > detectedTabs) {
      detectedTabs = savedDetected;
    }

    const storageItems = (allItems || []).filter(i => i.location === 2);
    for (let it of storageItems) {
      const s = it.slotIdx !== undefined ? it.slotIdx : (it.slot !== undefined ? it.slot : (it._slotIdx !== undefined ? it._slotIdx : -1));
      if (s >= 0) {
        const tab = Math.floor(s / slotPerTab) + 1;
        if (tab > detectedTabs) detectedTabs = tab;
      }
    }

    try {
      const prevMax = parseInt(localStorage.getItem('genesis_detected_warehouse_tabs') || '1', 10);
      if (detectedTabs > prevMax) {
        localStorage.setItem('genesis_detected_warehouse_tabs', detectedTabs);
      }
    } catch(e) {}

    return detectedTabs * slotPerTab;
  }

  return {
    getTierStyle,
    formatSteamPrice,
    getEquipSteamPrice,
    filterEquipments,
    filterJewels,
    resolveTotalStorage
  };
})();
