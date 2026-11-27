// Offline cache: app shell + every map resource you have already viewed.
const SHELL = 'shell-v4';
const TILES = 'tiles-v1';
const MAX_TILES = 12000; // oldest entries are dropped beyond this
const CDN = [
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://cdn.jsdelivr.net/npm/maplibre-contour@0.1.0/dist/index.min.js',
  'https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL).then(c => c.addAll(['./', 'index.html', ...CDN])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isTile = u =>
  (u.hostname === 'tiles.openfreemap.org' && /\.(pbf|mvt|png|jpg|webp)$/.test(u.pathname)) ||
  u.hostname === 'data.geopf.fr' ||
  u.hostname === 'wmts.geo.admin.ch' ||
  u.hostname === 'www.ign.es' ||
  (u.hostname === 's3.amazonaws.com' && u.pathname.startsWith('/elevation-tiles-prod/'));

const isMeta = u => u.hostname === 'tiles.openfreemap.org'; // style, TileJSON, sprites, fonts

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'nominatim.openstreetmap.org') return; // search is online-only

  if (isTile(url)) return e.respondWith(cacheFirst(req, TILES, true));
  if (isMeta(url)) return e.respondWith(networkFirst(req, TILES));
  if (url.hostname === 'cdn.jsdelivr.net') return e.respondWith(cacheFirst(req, SHELL, false));
  if (url.origin === location.origin) return e.respondWith(networkFirst(req, SHELL));
});

const cacheable = r => r && (r.ok || r.type === 'opaque');

async function cacheFirst(req, name, trim) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) {
    await cache.put(req, res.clone());
    if (trim) trimCache(cache);
  }
  return res;
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
    throw err;
  }
}

let puts = 0;
async function trimCache(cache) {
  if (++puts % 100) return;
  const keys = await cache.keys();
  const extra = keys.length - MAX_TILES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
