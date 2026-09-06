/* 四国一周 2026 — オフライン用 Service Worker
   室戸岬・佐田岬・しまなみの島嶼部は電波が途切れる区間があるため、
   行程とルートは端末に保存して圏外でも開けるようにしている。 */
'use strict';

var VERSION   = 'v3';
var SHELL     = 'shikoku-shell-' + VERSION;
var TILES     = 'shikoku-tiles-' + VERSION;
var TILE_MAX  = 600;          // 走行圏の地図タイルを覚えておく上限

var PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'data/plan.json',
  'data/route_summary.json',
  'data/routes/day1a-home-usuki.geojson',
  'data/routes/day1b-yawatahama-sukumo.geojson',
  'data/routes/day2-sukumo-kochi.geojson',
  'data/routes/day2-alt-nikobuchi.geojson',
  'data/routes/day3-kochi-tokushima.geojson',
  'data/routes/day4-tokushima-imabari.geojson',
  'data/routes/day5-shimanami-imabari-onomichi.geojson',
  'data/routes/day6-imabari-matsuyama.geojson',
  'data/routes/day7-matsuyama-misaki.geojson',
  'data/routes/day7b-saganoseki-home.geojson',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(SHELL).then(function (c) {
      /* 1件でも失敗すると addAll 全体が落ちるので個別に入れる */
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL && k !== TILES) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimTiles() {
  caches.open(TILES).then(function (c) {
    c.keys().then(function (keys) {
      if (keys.length <= TILE_MAX) return;
      /* 古いものから捨てる（keys() は挿入順） */
      for (var i = 0; i < keys.length - TILE_MAX; i++) c.delete(keys[i]);
    });
  });
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var isTile = /tile\.openstreetmap\.org|tile-cyclosm/.test(url.hostname);

  /* 地図タイル: キャッシュ優先。無ければ取りに行き、取れたら残す */
  if (isTile) {
    ev.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            var copy = res.clone();
            caches.open(TILES).then(function (c) { c.put(req, copy); trimTiles(); });
          }
          return res;
        }).catch(function () { return hit || Response.error(); });
      })
    );
    return;
  }

  /* 行程データ: 更新を取り逃さないようネット優先、圏外ならキャッシュ */
  if (/\/data\/plan\.json$/.test(url.pathname)) {
    ev.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  /* それ以外（アプリ本体・GeoJSON）: キャッシュ優先 */
  ev.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && url.origin === self.location.origin) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        /* ナビゲーション要求が圏外なら保存済みのトップを返す */
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
