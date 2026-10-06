// ============================================================
// LOOT DEALS — PUBLIC CONFIG thegreatindiandeals/loot-deals
// ============================================================
window.GHRL = 'thegreatindiandeals/lootdeals';
window.GHRLREF = 'main';
window.AMAZON_AFFILIATE_TAG = 'thegreatin044-21';
window.LEGAL_CONTACT_WHATSAPP = '+919999999999';

window.COMMUNITY_LINKS = {
  telegram: 'https://t.me/TheGreatIndiandeal',
  whatsapp: 'https://www.whatsapp.com/channel/0029Vb8K1cO7IUYe1kmGfq1y'
};

window.DEAL_CDN_BASE =
  `https://cdn.jsdelivr.net/gh/${window.GHRL}@${window.GHRLREF}/deals/`;

window.DEAL_CONFIG = {
  pageSize: 24,
  preloadChunks: 1,
  maxSearchResults: 250,
  affiliateParam: 'tag',
  searchDebounceMs: 220,
  chunkConcurrency: 6
};
