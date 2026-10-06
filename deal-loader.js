// ============================================================
// LOOT DEALS — GHUSR + jsDelivr CDN DATA LOADER
// ============================================================
// Product JSON never needs to pass through your VPS once this is
// deployed. The browser reads public JSON directly from jsDelivr.

let DEAL_CHUNK_SIZE = 100;
const dealChunkCache = new Map();
let manifestPromise = null;

function getCdnBase() {
  const base = String(window.DEAL_CDN_BASE || '').trim();
  if (!base || base.includes('YOUR_GHUSR_USERNAME')) {
    throw new Error('HUGE LOAD on Website please, Try! Out After Sometime.');
  }
  return base.replace(/\/+$/, '') + '/';
}

function getChunkUrl(chunkNo) {
  return `${getCdnBase()}${String(chunkNo).padStart(3, '0')}.json`;
}

function chunkNumberForSL(sl) {
  return Math.floor((Number(sl) - 1) / DEAL_CHUNK_SIZE) + 1;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: options.cache || 'force-cache',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`CDN request failed: ${response.status} ${response.statusText || ''}`.trim());
  }

  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) {
    // jsDelivr can still return valid JSON with a generic content type.
    // Parsing below is therefore intentionally not blocked by this check.
  }

  return response.json();
}

async function fetchManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJson(`${getCdnBase()}manifest.json`).then((manifest) => {
      const size = Number(manifest?.chunk_size);
      if (Number.isInteger(size) && size > 0) DEAL_CHUNK_SIZE = size;
      window.__DEAL_MANIFEST_TOTAL = Number(manifest?.total_records || 0);
      window.__DEAL_MANIFEST = manifest;
      return manifest;
    });
  }
  return manifestPromise;
}

async function fetchChunk(chunkNo) {
  const number = Number(chunkNo);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('Invalid chunk number');
  }

  if (dealChunkCache.has(number)) {
    return dealChunkCache.get(number);
  }

  const promise = fetchJson(getChunkUrl(number));
  dealChunkCache.set(number, promise);

  try {
    const records = await promise;
    dealChunkCache.set(number, Promise.resolve(Array.isArray(records) ? records : []));
    return records;
  } catch (error) {
    dealChunkCache.delete(number);
    throw error;
  }
}

async function getDeal(sl) {
  const value = Number(sl);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Invalid SL number');
  }

  await fetchManifest();
  const records = await fetchChunk(chunkNumberForSL(value));
  return records.find((row) => Number(row.sl) === value) || null;
}

async function getDealsRange(startSL, endSL) {
  let start = Number(startSL);
  let end = Number(endSL);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error('Invalid deal range');
  }

  const manifest = await fetchManifest();
  end = Math.min(end, Number(manifest.total_records || end));

  const first = chunkNumberForSL(start);
  const last = chunkNumberForSL(end);
  const chunkNumbers = [];

  for (let n = first; n <= last; n += 1) chunkNumbers.push(n);

  const configuredConcurrency = Number(window.DEAL_CONFIG?.chunkConcurrency || 6);
  const concurrency = Math.max(1, Math.min(12, configuredConcurrency));
  const result = [];

  for (let i = 0; i < chunkNumbers.length; i += concurrency) {
    const batch = chunkNumbers.slice(i, i + concurrency);
    const chunks = await Promise.all(batch.map(fetchChunk));

    for (const records of chunks) {
      for (const row of records) {
        const sl = Number(row.sl);
        if (sl >= start && sl <= end) result.push(row);
      }
    }
  }

  result.sort((a, b) => Number(a.sl) - Number(b.sl));
  return result;
}

window.LootDealsLoader = {
  fetchManifest,
  fetchChunk,
  getDeal,
  getDealsRange,
  clearCache() {
    dealChunkCache.clear();
  }
};
