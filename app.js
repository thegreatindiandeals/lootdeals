// ============================================================
// LOOT DEALS — DEAL GRID
// Random browse order per page load / refresh.
// Search and category filters operate on the full CDN dataset.
// ============================================================
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    manifest: null,
    loaded: [],
    loading: false,
    allLoaded: false,
    allRecords: null,
    searchTimer: null,
    pageSize: Number(window.DEAL_CONFIG?.pageSize || 24),
    filterRequestId: 0,
    randomChunks: [],
    randomChunkIndex: 0,
    currentChunkRows: [],
    currentChunkOffset: 0
  };

  const grid = $('grid');
  const sentinel = $('sentinel');
  const count = $('count');
  const search = $('search');
  const category = $('category');
  const loadAllBtn = $('loadAll');
  const tpl = $('card-template');

  if (!grid || !sentinel || !count || !search || !category || !loadAllBtn || !tpl) {
    console.error('Loot Deals: required page elements are missing.');
    return;
  }

  const money = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    return Number.isFinite(n) ? '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
  };

  const pct = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0% OFF';
    return `${Math.round(n <= 1 ? n * 100 : n)}% OFF`;
  };

  const cleanText = (value) => String(value ?? '')
    .replace(/Â°/g, '°').replace(/Â®/g, '®').replace(/Â©/g, '©').replace(/Â/g, '').trim();

  const formatDate = (value) => {
    if (!value) return '';
    const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return cleanText(value);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const imageFor = (row) => row?.image_url
    ? String(row.image_url)
    : row?.asin
      ? `https://images.amazon.com/images/P/${encodeURIComponent(String(row.asin).trim())}.01_SL110_.jpg`
      : '';

  function extractAsin(raw, rowAsin = '') {
    const direct = String(rowAsin || '').trim().toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(direct)) return direct;
    const value = String(raw || '').trim();
    const m = value.match(/(?:amazon\.[a-z.]+)\/(?:dp|d|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
    if (m) return m[1].toUpperCase();
    const p = value.match(/(?:^|\/)\/(?:dp|d|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
    return p ? p[1].toUpperCase() : '';
  }

  function normalizeAmazonProductUrl(raw, rowAsin = '') {
    const value = String(raw || '').trim();
    const asin = extractAsin(value, rowAsin);
    if (asin) return `https://www.amazon.in/dp/${asin}`;
    if (!value) return '';
    if (/^(?:www\.)?amazon\./i.test(value)) return `https://${value}`;
    try {
      const u = new URL(value, window.location.href);
      if (/amazon\./i.test(u.hostname)) return u.toString();
    } catch (_) {}
    return value;
  }

  function addAmazonAffiliateTag(url) {
    const tag = String(window.AMAZON_AFFILIATE_TAG || '').trim();
    if (!tag) return url;
    try {
      const u = new URL(url);
      if (!/amazon\./i.test(u.hostname)) return url;
      const key = String(window.DEAL_CONFIG?.affiliateParam || 'tag');
      u.searchParams.delete(key);
      u.searchParams.set(key, tag);
      return u.toString();
    } catch (_) { return url; }
  }

  function affiliateUrlFor(row) {
    const normalized = normalizeAmazonProductUrl(String(row?.['Landing Page'] || '').trim(), row?.asin);
    return normalized ? addAmazonAffiliateTag(normalized) : '#';
  }

  function productCard(row) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const url = affiliateUrlFor(row);
    const img = imageFor(row);
    const title = cleanText(row?.['Product Name'] || 'Amazon Deal');
    node.querySelector('.discount').textContent = pct(row?.Discount);
    const imageLink = node.querySelector('.image-box');
    imageLink.href = url;
    const image = node.querySelector('img');
    image.alt = title;
    if (img) image.src = img; else image.removeAttribute('src');
    image.onerror = () => { image.removeAttribute('src'); image.classList.add('failed'); };
    const titleLink = node.querySelector('.title');
    titleLink.href = url;
    titleLink.textContent = title;
    node.querySelector('.mrp').textContent = money(row?.['List Price']);
    node.querySelector('.deal').textContent = money(row?.['Deal Price']);
    const start = formatDate(row?.['Start Date']);
    const end = formatDate(row?.['End Date']);
    node.querySelector('.validity').textContent = start && end ? `Valid ${start} – ${end}` : (start ? `Valid from ${start}` : '');
    const buy = node.querySelector('.buy');
    buy.href = url;
    if (url === '#') buy.setAttribute('aria-disabled', 'true');
    return node;
  }

  function appendRows(rows) {
    const frag = document.createDocumentFragment();
    rows.forEach((r) => frag.appendChild(productCard(r)));
    grid.appendChild(frag);
  }

  function refreshCount(visible = state.loaded.length) {
    if (!state.manifest) return;
    const total = Number(state.manifest.total_records || 0);
    count.textContent = `${Number(visible).toLocaleString('en-IN')} deals shown · ${total.toLocaleString('en-IN')} total`;
  }

  function populateCategories() {
    const categories = Array.isArray(state.manifest?.categories) ? state.manifest.categories : [];
    const frag = document.createDocumentFragment();
    categories.forEach((name) => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      frag.appendChild(o);
    });
    category.appendChild(frag);
  }

  function shuffleArray(input) {
    const arr = Array.isArray(input) ? input.slice() : [];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function randomizeBrowsePlan() {
    const n = Number(state.manifest?.chunk_count || 0);
    state.randomChunks = shuffleArray(Array.from({ length: n }, (_, i) => i + 1));
    state.randomChunkIndex = 0;
    state.currentChunkRows = [];
    state.currentChunkOffset = 0;
  }

  async function getNextRandomRows(limit) {
    const out = [];
    while (out.length < limit && state.randomChunkIndex < state.randomChunks.length) {
      if (!state.currentChunkRows.length || state.currentChunkOffset >= state.currentChunkRows.length) {
        const chunkNo = state.randomChunks[state.randomChunkIndex++];
        state.currentChunkRows = shuffleArray(await fetchChunk(chunkNo));
        state.currentChunkOffset = 0;
      }
      const remaining = state.currentChunkRows.length - state.currentChunkOffset;
      const take = Math.min(limit - out.length, remaining);
      out.push(...state.currentChunkRows.slice(state.currentChunkOffset, state.currentChunkOffset + take));
      state.currentChunkOffset += take;
    }
    return out;
  }

  async function loadNextPage() {
    if (state.loading || state.allLoaded || state.allRecords) return;
    state.loading = true;
    sentinel.textContent = 'Finding fresh deals…';
    try {
      const rows = await getNextRandomRows(state.pageSize);
      if (!rows.length) {
        state.allLoaded = true;
        sentinel.textContent = 'All random deals shown';
        return;
      }
      appendRows(rows);
      state.loaded.push(...rows);
      state.allLoaded = state.randomChunkIndex >= state.randomChunks.length && state.currentChunkOffset >= state.currentChunkRows.length;
      refreshCount();
      sentinel.textContent = state.allLoaded ? 'All deals shown' : 'Scroll for more fresh deals';
    } catch (e) {
      sentinel.textContent = `Unable to load deals: ${cleanText(e?.message || 'Unknown error')}`;
    } finally {
      state.loading = false;
    }
  }

  async function loadAllRecords() {
    if (state.allRecords) return state.allRecords;
    loadAllBtn.disabled = true;
    loadAllBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Loading…';
    try {
      const rows = shuffleArray(await getDealsRange(1, state.manifest.total_records));
      state.allRecords = rows;
      state.loaded = rows.slice();
      state.allLoaded = true;
      loadAllBtn.innerHTML = '<i class="bi bi-check2"></i> Loaded';
      return rows;
    } catch (e) {
      loadAllBtn.disabled = false;
      loadAllBtn.innerHTML = '<i class="bi bi-grid-3x3-gap"></i> Load all';
      throw e;
    }
  }

  function renderFiltered(rows) {
    grid.replaceChildren();
    const limit = Number(window.DEAL_CONFIG?.maxSearchResults || 250);
    const shown = rows.slice(0, limit);
    appendRows(shown);
    count.textContent = `${shown.length.toLocaleString('en-IN')} matching deals`;
    sentinel.textContent = rows.length > limit ? `Showing first ${limit.toLocaleString('en-IN')} matches` : 'No more matches';
  }

  function resetBrowse() {
    state.allRecords = null;
    state.loaded = [];
    state.allLoaded = false;
    state.filterRequestId += 1;
    randomizeBrowsePlan();
    grid.replaceChildren();
    refreshCount(0);
    sentinel.textContent = 'Finding fresh deals…';
  }

  async function applyFilters() {
    const q = search.value.trim().toLowerCase();
    const cat = category.value;
    const id = ++state.filterRequestId;
    if (!q && !cat) {
      resetBrowse();
      await loadNextPage();
      return;
    }
    sentinel.textContent = 'Searching all deals…';
    try {
      const rows = await loadAllRecords();
      if (id !== state.filterRequestId) return;
      renderFiltered(rows.filter((r) => {
        const hay = [r?.['Product Name'], r?.['Category Name'], r?.asin, r?.['GL/PL'], r?.['Key Callout']].join(' ').toLowerCase();
        return (!q || hay.includes(q)) && (!cat || r?.['Category Name'] === cat);
      }));
    } catch (e) {
      sentinel.textContent = `Search failed: ${cleanText(e?.message || 'Unknown error')}`;
    }
  }

  function initTheme() {
    const root = document.documentElement;
    const btn = $('themeToggle');
    let theme = localStorage.getItem('lootTheme');
    if (!theme) theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.dataset.theme = theme;
    function sync() {
      const dark = root.dataset.theme === 'dark';
      btn?.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      if (btn) btn.innerHTML = dark ? '<i class="bi bi-sun-fill"></i>' : '<i class="bi bi-moon-stars-fill"></i>';
    }
    sync();
    btn?.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('lootTheme', root.dataset.theme);
      sync();
    });
  }

  function initScrollTop() {
    const btn = $('scrollTop');
    const sync = () => btn?.classList.toggle('is-visible', window.scrollY > 450);
    window.addEventListener('scroll', sync, { passive: true });
    sync();
    btn?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  function initHeaderLinks() {
    const telegramUrl = String(window.COMMUNITY_LINKS?.telegram || 'https://t.me/lootdealtricks').trim();
    const whatsappUrl = String(window.COMMUNITY_LINKS?.whatsapp || 'https://whatsapp.com/channel/0029Va9hwdpBVJkvxrhOkU0M').trim();
    const telegramIds = ['telegramNav', 'telegramHero', 'popupTelegram', 'ctaTelegram'];
    const whatsappIds = ['whatsappNav', 'whatsappHero', 'popupWhatsapp', 'ctaWhatsapp', 'footerWhatsapp'];
    telegramIds.forEach((id) => { const el = $(id); if (el) el.href = telegramUrl || '#alerts'; });
    whatsappIds.forEach((id) => {
      const el = $(id); if (!el) return;
      if (/^https?:\/\//i.test(whatsappUrl)) { el.href = whatsappUrl; el.classList.remove('is-disabled'); }
      else { el.href = '#alerts'; el.classList.add('is-disabled'); el.title = 'Add your real WhatsApp invite link'; }
    });
  }

  async function initDeals() {
    state.manifest = await fetchManifest();
    window.__DEAL_MANIFEST_TOTAL = Number(state.manifest.total_records || 0);
    window.__DEAL_MANIFEST = state.manifest;
    $('totalDeals').textContent = Number(state.manifest.total_records || 0).toLocaleString('en-IN') + '+';
    populateCategories();
    randomizeBrowsePlan();
    await loadNextPage();
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loadNextPage();
      }, { rootMargin: '900px 0px' });
      observer.observe(sentinel);
    }
  }

  initTheme();
  initScrollTop();
  initHeaderLinks();

  search.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(applyFilters, Number(window.DEAL_CONFIG?.searchDebounceMs || 220));
  });
  category.addEventListener('change', applyFilters);
  loadAllBtn.addEventListener('click', async () => {
    try {
      const rows = await loadAllRecords();
      if (!search.value.trim() && !category.value) {
        grid.replaceChildren();
        appendRows(rows);
        count.textContent = `${rows.length.toLocaleString('en-IN')} deals shown`;
        sentinel.textContent = 'All deals loaded in random order';
      } else {
        await applyFilters();
      }
    } catch (e) {
      sentinel.textContent = `Unable to load data: ${cleanText(e?.message || 'Unknown error')}`;
    }
  });

  initDeals().catch((e) => {
    grid.innerHTML = `<div class="error"><strong>Deals could not be loaded.</strong><br>${cleanText(e?.message || 'Unknown error')}</div>`;
    sentinel.textContent = '';
  });
})();
