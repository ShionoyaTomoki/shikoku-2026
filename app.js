/* 四国一周 2026 — スケジュール & ルートビューア */
'use strict';

var TYPE_ICON = {
  start: '🏠', goal: '🏁', ferry: '⛴', meal: '🍽', udon: '🍜', ramen: '🍜',
  night: '🍶', hotel: '🛏', rest: '☕', sight: '📷', shop: '🛍', warn: '⚠️',
  pass: '⛰', water: '💧', bike: '🚴'
};
var TYPE_PIN = {
  start: 'start', goal: 'goal', ferry: 'ferry', meal: 'meal', udon: 'meal', ramen: 'meal',
  night: 'night', hotel: 'hotel', rest: 'rest', sight: 'sight', shop: 'shop',
  warn: 'warn', pass: 'warn', water: 'rest', bike: 'rest'
};

var TILES = [
  { name: 'OSM', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19,
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  { name: 'CyclOSM', url: 'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', max: 18,
    attr: 'CyclOSM | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }
];

var PLAN = null;
var map = null;
var tileIdx = 0;
var tileLayer = null;
var layerGroup = null;
var currentDayId = null;
var variantChoice = {};      // dayId -> variantId
var geoCache = {};           // file -> geojson
var markerIndex = {};        // key -> leaflet marker
var drawToken = 0;           // guards against a slow fetch painting onto a later view

/* ---------------- boot ---------------- */

function boot() {
  initMap();
  fetch('data/plan.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('plan.json HTTP ' + r.status);
      return r.json();
    })
    .then(function (json) {
      PLAN = json;
      if (json.meta) {
        if (json.meta.subtitle) document.getElementById('hdr-sub').textContent = json.meta.subtitle;
        if (json.meta.title) document.title = json.meta.title;
      }
      buildTabs();
      var start = (location.hash || '').replace('#', '');
      var found = PLAN.days.filter(function (d) { return d.id === start; })[0];
      selectDay(found ? found.id : PLAN.days[0].id);
    })
    .catch(function (e) {
      document.getElementById('content').innerHTML =
        '<div class="banner warn"><b>データを読み込めませんでした。</b><br>' +
        escapeHtml(e.message) + '<br>ページを再読み込みしてください。</div>';
    });

  document.getElementById('btn-fit').addEventListener('click', function () { fitAll(); });
  document.getElementById('btn-layer').addEventListener('click', cycleTiles);
  document.getElementById('btn-info').addEventListener('click', showOverview);
  document.getElementById('sheet').addEventListener('click', function (ev) {
    if (ev.target.hasAttribute('data-close')) closeSheet();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeSheet();
  });
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true, tap: true })
        .setView([33.6, 133.3], 8);
  layerGroup = L.layerGroup().addTo(map);
  applyTiles();
}

function applyTiles() {
  var t = TILES[tileIdx];
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(t.url, { maxZoom: t.max, attribution: t.attr }).addTo(map);
}

function cycleTiles() {
  tileIdx = (tileIdx + 1) % TILES.length;
  applyTiles();
  var note = document.getElementById('route-note');
  note.textContent = TILES[tileIdx].name;
  setTimeout(function () { if (note.textContent === TILES[tileIdx].name) note.textContent = ''; }, 2000);
}

/* ---------------- tabs ---------------- */

function buildTabs() {
  var nav = document.getElementById('daytabs');
  nav.innerHTML = '';
  PLAN.days.forEach(function (d) {
    var b = document.createElement('button');
    b.className = 'daytab';
    b.dataset.id = d.id;
    b.innerHTML = '<span class="t-d">' + escapeHtml(d.date) + '</span>' +
                  '<span class="t-l">' + escapeHtml(d.tabLabel || d.dow || '') + '</span>';
    b.addEventListener('click', function () { selectDay(d.id); });
    nav.appendChild(b);
  });
}

function selectDay(id) {
  currentDayId = id;
  history.replaceState(null, '', '#' + id);
  var tabs = document.querySelectorAll('.daytab');
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i].dataset.id === id;
    tabs[i].classList.toggle('active', on);
    if (on && tabs[i].scrollIntoView) {
      tabs[i].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
  var day = getDay(id);
  renderDay(day);
  drawDay(day);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getDay(id) {
  return PLAN.days.filter(function (d) { return d.id === id; })[0];
}

function activeVariant(day) {
  if (!day.variants || !day.variants.length) return null;
  var id = variantChoice[day.id] || day.variants[0].id;
  return day.variants.filter(function (v) { return v.id === id; })[0] || day.variants[0];
}

/* merged view of a day + its selected variant */
function effective(day) {
  var v = activeVariant(day);
  return {
    timeline: (v && v.timeline) ? v.timeline : (day.timeline || []),
    routes: (v && v.routes) ? v.routes : (day.routes || []),
    distanceKm: (v && v.distanceKm != null) ? v.distanceKm : day.distanceKm,
    ascentM: (v && v.ascentM != null) ? v.ascentM : day.ascentM,
    notes: (v && v.notes) ? v.notes : (day.notes || [])
  };
}

/* ---------------- render ---------------- */

function renderDay(day) {
  var eff = effective(day);
  var h = [];

  h.push('<div class="day-head"><h2>' + escapeHtml(day.title) + '</h2>');
  if (day.summary) h.push('<div class="sub">' + escapeHtml(day.summary) + '</div>');
  h.push('</div>');

  h.push('<div class="chips">');
  h.push('<span class="chip">' + escapeHtml(day.date) + '（' + escapeHtml(day.dow || '') + '）</span>');
  if (eff.distanceKm != null) {
    h.push('<span class="chip' + (eff.distanceKm >= 180 ? ' hard' : (eff.distanceKm <= 60 ? ' easy' : '')) +
           '">📏 <b>' + eff.distanceKm + '</b> km</span>');
  }
  if (eff.ascentM != null) h.push('<span class="chip">⛰ <b>' + eff.ascentM + '</b> m</span>');
  if (day.rideTime) h.push('<span class="chip">⏱ ' + escapeHtml(day.rideTime) + '</span>');
  h.push('</div>');

  (eff.notes || []).forEach(function (n) {
    h.push('<div class="banner ' + (n.level || 'info') + '">' + mdLite(n.text) + '</div>');
  });

  if (day.variants && day.variants.length) {
    var cur = activeVariant(day);
    h.push('<div class="variants">');
    day.variants.forEach(function (v) {
      h.push('<button class="variant-btn' + (v.id === cur.id ? ' active' : '') + '" data-variant="' +
             escapeHtml(v.id) + '"><span class="v-n">' + escapeHtml(v.name) + '</span>' +
             '<span class="v-d">' + escapeHtml(v.short || '') + '</span></button>');
    });
    h.push('</div>');
    if (cur.desc) h.push('<div class="banner tip">' + mdLite(cur.desc) + '</div>');
  }

  /* timeline */
  h.push('<div class="tl">');
  eff.timeline.forEach(function (it, i) {
    var kind = it.type || 'rest';
    var clickable = (it.lat != null && it.lng != null) || it.detail || it.address || it.hours || it.tel;
    h.push('<div class="tl-item k-' + escapeHtml(kind) + '">');
    h.push('<div class="tl-time">' + escapeHtml(it.time || '') + '</div>');
    h.push('<div class="tl-dot"></div>');
    h.push('<div class="tl-card' + (clickable ? '' : ' plain') + '"' +
           (clickable ? ' data-spot="' + day.id + ':' + i + '"' : '') + '>');
    h.push('<div class="tl-t">' + (TYPE_ICON[kind] || '•') + ' ' + escapeHtml(it.name) + '</div>');
    if (it.desc) h.push('<div class="tl-d">' + mdLite(it.desc) + '</div>');
    var tags = [];
    if (it.cum) tags.push('<span class="tag cum">積算 ' + escapeHtml(it.cum) + '</span>');
    (it.tags || []).forEach(function (t) {
      tags.push('<span class="tag ' + escapeHtml(t.style || '') + '">' + escapeHtml(t.text) + '</span>');
    });
    if (tags.length) h.push('<div class="tl-tags">' + tags.join('') + '</div>');
    h.push('</div></div>');
  });
  h.push('</div>');

  /* extra sections: night spots, lodging candidates, etc. */
  (day.sections || []).forEach(function (sec) {
    h.push('<div class="sec-title">' + escapeHtml(sec.title) + '</div>');
    if (sec.note) h.push('<div class="banner ' + (sec.level || 'info') + '">' + mdLite(sec.note) + '</div>');
    (sec.items || []).forEach(function (it, i) {
      h.push('<div class="pcard" data-sec="' + day.id + ':' + sec.id + ':' + i + '">');
      h.push('<div class="pcard-h"><div class="pcard-ic">' + (TYPE_ICON[it.type] || '📍') + '</div>');
      h.push('<div class="pcard-n">' + escapeHtml(it.name) + '</div></div>');
      if (it.desc) h.push('<div class="pcard-d">' + mdLite(it.desc) + '</div>');
      var meta = [];
      if (it.hours) meta.push('🕐 ' + it.hours);
      if (it.price) meta.push('💰 ' + it.price);
      if (it.tel) meta.push('📞 ' + it.tel);
      if (meta.length) h.push('<div class="pcard-m">' + escapeHtml(meta.join('　')) + '</div>');
      h.push('</div>');
    });
  });

  var el = document.getElementById('content');
  el.innerHTML = h.join('');

  el.querySelectorAll('[data-variant]').forEach(function (b) {
    b.addEventListener('click', function () {
      variantChoice[day.id] = b.dataset.variant;
      renderDay(day);
      drawDay(day);
    });
  });
  el.querySelectorAll('[data-spot]').forEach(function (c) {
    c.addEventListener('click', function () {
      var idx = parseInt(c.dataset.spot.split(':')[1], 10);
      openSpot(effective(day).timeline[idx]);
    });
  });
  el.querySelectorAll('[data-sec]').forEach(function (c) {
    c.addEventListener('click', function () {
      var p = c.dataset.sec.split(':');
      var sec = (day.sections || []).filter(function (s) { return s.id === p[1]; })[0];
      if (sec) openSpot(sec.items[parseInt(p[2], 10)]);
    });
  });
}

/* ---------------- map drawing ---------------- */

function drawDay(day) {
  var token = ++drawToken;
  layerGroup.clearLayers();
  markerIndex = {};
  var eff = effective(day);
  var bounds = L.latLngBounds([]);
  var note = document.getElementById('route-note');
  note.textContent = '';

  /* markers */
  eff.timeline.forEach(function (it, i) {
    if (it.lat == null || it.lng == null) return;
    var kind = it.type || 'rest';
    var m = L.marker([it.lat, it.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div class="pin pin-' + (TYPE_PIN[kind] || 'rest') + '"><span>' +
              (TYPE_ICON[kind] || '•') + '</span></div>',
        iconSize: [27, 27], iconAnchor: [13, 25], popupAnchor: [0, -24]
      })
    });
    m.bindPopup(popupHtml(it));
    m.addTo(layerGroup);
    markerIndex[i] = m;
    bounds.extend([it.lat, it.lng]);
  });

  /* section items (night spots, lodging candidates) also on map */
  (day.sections || []).forEach(function (sec) {
    (sec.items || []).forEach(function (it) {
      if (it.lat == null || it.lng == null) return;
      var kind = it.type || 'rest';
      L.marker([it.lat, it.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="pin pin-' + (TYPE_PIN[kind] || 'rest') + '" style="opacity:.85"><span>' +
                (TYPE_ICON[kind] || '•') + '</span></div>',
          iconSize: [27, 27], iconAnchor: [13, 25], popupAnchor: [0, -24]
        })
      }).bindPopup(popupHtml(it)).addTo(layerGroup);
      bounds.extend([it.lat, it.lng]);
    });
  });

  if (bounds.isValid()) map.fitBounds(bounds, { padding: [34, 34], maxZoom: 12 });

  /* routes (async) */
  var routes = eff.routes || [];
  if (!routes.length) return;
  var rb = L.latLngBounds([]);
  var pending = routes.length;
  var failed = 0;

  routes.forEach(function (r) {
    loadGeo(r.file).then(function (gj) {
      if (token !== drawToken) return;   // user moved on while this was in flight
      var layer = L.geoJSON(gj, {
        style: { color: r.color || '#0b6e4f', weight: r.weight || 5, opacity: .82, lineJoin: 'round' }
      });
      layer.bindPopup('<b>' + escapeHtml(r.label || '走行ルート') + '</b>' +
        (r.info ? '<div class="pop-meta">' + escapeHtml(r.info) + '</div>' : ''));
      layer.addTo(layerGroup);
      layer.bringToBack();
      rb.extend(layer.getBounds());
    }).catch(function () {
      failed++;
    }).then(function () {
      pending--;
      if (pending === 0 && token === drawToken) {
        if (rb.isValid()) {
          rb.extend(bounds.isValid() ? bounds : rb);
          map.fitBounds(rb, { padding: [26, 26] });
        }
        note.textContent = failed ? ('⚠️ ルート線 ' + failed + '件を読込めず') : '';
      }
    });
  });
}

function loadGeo(file) {
  if (geoCache[file]) return Promise.resolve(geoCache[file]);
  return fetch('data/' + file, { cache: 'force-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error(file + ' HTTP ' + r.status);
      return r.json();
    })
    .then(function (gj) { geoCache[file] = gj; return gj; });
}

function fitAll() {
  var token = ++drawToken;
  var all = L.latLngBounds([]);
  var files = [];
  PLAN.days.forEach(function (d) {
    (d.routes || []).forEach(function (r) { files.push(r); });
    (d.variants || []).forEach(function (v) {
      (v.routes || []).forEach(function (r) { files.push(r); });
    });
  });
  layerGroup.clearLayers();
  var pending = files.length;
  if (!pending) { map.setView([33.7, 133.3], 8); return; }
  files.forEach(function (r) {
    loadGeo(r.file).then(function (gj) {
      if (token !== drawToken) return;
      var layer = L.geoJSON(gj, { style: { color: r.color || '#0b6e4f', weight: 3.5, opacity: .75 } });
      layer.bindPopup('<b>' + escapeHtml(r.label || '') + '</b>');
      layer.addTo(layerGroup);
      all.extend(layer.getBounds());
    }).catch(function () {}).then(function () {
      pending--;
      if (pending === 0 && token === drawToken && all.isValid()) map.fitBounds(all, { padding: [22, 22] });
    });
  });
  document.getElementById('route-note').textContent = '全行程を表示中（日付タブで戻る）';
}

/* ---------------- popup & sheet ---------------- */

function popupHtml(it) {
  var h = '<b>' + (TYPE_ICON[it.type] || '📍') + ' ' + escapeHtml(it.name) + '</b>';
  if (it.time) h += '<div class="pop-meta">🕐 ' + escapeHtml(it.time) + '</div>';
  if (it.desc) h += '<div class="pop-meta">' + escapeHtml(trim(it.desc, 90)) + '</div>';
  if (it.hours) h += '<div class="pop-meta">営業 ' + escapeHtml(it.hours) + '</div>';
  h += '<a class="pop-link" target="_blank" rel="noopener" href="' + gmapUrl(it) + '">Googleマップで開く →</a>';
  return h;
}

function gmapUrl(it) {
  if (it.lat != null && it.lng != null) {
    return 'https://www.google.com/maps/search/?api=1&query=' + it.lat + ',' + it.lng;
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(it.name);
}

function openSpot(it) {
  if (!it) return;
  var h = [];
  h.push('<h3>' + (TYPE_ICON[it.type] || '📍') + ' ' + escapeHtml(it.name) + '</h3>');
  if (it.time) h.push('<p style="color:var(--green);font-weight:700">🕐 ' + escapeHtml(it.time) + '</p>');
  if (it.detail) h.push('<p style="margin-top:8px">' + mdLite(it.detail) + '</p>');
  else if (it.desc) h.push('<p style="margin-top:8px">' + mdLite(it.desc) + '</p>');

  var rows = [
    ['営業時間', it.hours], ['定休日', it.closed], ['予算', it.price],
    ['電話', it.tel], ['住所', it.address], ['名物', it.specialty],
    ['自転車', it.bike], ['積算距離', it.cum], ['メモ', it.memo]
  ].filter(function (r) { return r[1]; });
  if (rows.length) {
    h.push('<h4>詳細</h4><dl>');
    rows.forEach(function (r) {
      h.push('<div class="kv"><dt>' + escapeHtml(r[0]) + '</dt><dd>' + mdLite(String(r[1])) + '</dd></div>');
    });
    h.push('</dl>');
  }
  h.push('<div class="sheet-links">');
  h.push('<a class="slink" target="_blank" rel="noopener" href="' + gmapUrl(it) + '">Googleマップ</a>');
  if (it.url) h.push('<a class="slink alt" target="_blank" rel="noopener" href="' + escapeHtml(it.url) + '">公式サイト</a>');
  if (it.tel) h.push('<a class="slink alt" href="tel:' + escapeHtml(String(it.tel).replace(/[^0-9+]/g, '')) + '">電話する</a>');
  h.push('</div>');

  document.getElementById('sheet-content').innerHTML = h.join('');
  document.getElementById('sheet').hidden = false;

  if (it.lat != null && it.lng != null) {
    map.setView([it.lat, it.lng], Math.max(map.getZoom(), 13));
  }
}

function showOverview() {
  var m = PLAN.meta || {};
  var h = [];
  h.push('<h3>' + escapeHtml(m.title || '四国一周 2026') + '</h3>');
  if (m.intro) h.push('<p style="margin-top:6px">' + mdLite(m.intro) + '</p>');

  h.push('<h4>行程サマリー</h4><table class="mini"><tr><th>日付</th><th>区間</th><th class="num">km</th><th class="num">↑m</th></tr>');
  var tk = 0, ta = 0;
  PLAN.days.forEach(function (d) {
    var e = effective(d);
    if (typeof e.distanceKm === 'number') tk += e.distanceKm;
    if (typeof e.ascentM === 'number') ta += e.ascentM;
    h.push('<tr><td>' + escapeHtml(d.date) + '</td><td>' + escapeHtml(d.short || d.title) + '</td>' +
           '<td class="num">' + (e.distanceKm != null ? e.distanceKm : '-') + '</td>' +
           '<td class="num">' + (e.ascentM != null ? e.ascentM : '-') + '</td></tr>');
  });
  h.push('<tr><td colspan="2"><b>合計</b></td><td class="num"><b>' + Math.round(tk) +
         '</b></td><td class="num"><b>' + Math.round(ta) + '</b></td></tr></table>');

  (m.blocks || []).forEach(function (b) {
    h.push('<h4>' + escapeHtml(b.title) + '</h4>');
    if (b.text) h.push('<p>' + mdLite(b.text) + '</p>');
    if (b.rows) {
      h.push('<dl>');
      b.rows.forEach(function (r) {
        h.push('<div class="kv"><dt>' + escapeHtml(r[0]) + '</dt><dd>' + mdLite(r[1]) + '</dd></div>');
      });
      h.push('</dl>');
    }
  });

  document.getElementById('sheet-content').innerHTML = h.join('');
  document.getElementById('sheet').hidden = false;
}

function closeSheet() { document.getElementById('sheet').hidden = true; }

/* ---------------- utils ---------------- */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* very small subset: **bold** and newlines. everything else escaped. */
function mdLite(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

function trim(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
