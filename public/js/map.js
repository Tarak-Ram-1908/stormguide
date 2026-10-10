/*
 * Map view (Leaflet). Overlays (zones, alert areas, shelters, closures,
 * reports) are drawn from local state, so they appear even when map tiles
 * are not available offline.
 */
/* global L, SG, Geo */
(function (root) {
  'use strict';
  var M = root.SGMap = {};
  var map = null, layers = {}, youMarker = null, youCircle = null, picking = false, onPick = null;

  var COLORS = { flooded: '#1d6fd8', unsafe: '#d9480f', safe: '#2b8a3e', alert: '#c92a2a', closure: '#e03131' };
  var SEV_COLORS = { Minor: '#f59f00', Moderate: '#f76707', Severe: '#e03131', Extreme: '#862e9c' };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function divIcon(html, cls, size) {
    return L.divIcon({ html: html, className: 'sg-icon ' + (cls || ''), iconSize: [size || 30, size || 30], iconAnchor: [(size || 30) / 2, (size || 30) / 2] });
  }

  M.init = function (container) {
    if (map) return map;
    if (typeof L === 'undefined') { container.textContent = 'Map library failed to load.'; return null; }
    var st = SG.state;
    var center = SG.point() || (st ? st.region.center : [13.05, 80.24]);
    map = L.map(container, {
      zoomControl: true, attributionControl: true, preferCanvas: false,
      zoomSnap: 1, zoomDelta: 1, wheelPxPerZoomLevel: 120, bounceAtZoomLimits: false, tapTolerance: 20
    }).setView(center, st ? st.region.zoom : 12);
    // Keep Leaflet's size in sync with the container (tab switches, rotation, mobile URL bar).
    if (typeof ResizeObserver !== 'undefined') {
      var pending = null;
      new ResizeObserver(function () { clearTimeout(pending); pending = setTimeout(function () { map.invalidateSize({ pan: false }); }, 100); }).observe(container);
    }
    L.tileLayer(SG.tileUrl, {
      maxZoom: 18, minZoom: 9, crossOrigin: true, keepBuffer: 4, updateWhenZooming: false,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    ['alerts', 'zones', 'closures', 'reports', 'shelters'].forEach(function (k) { layers[k] = L.layerGroup().addTo(map); });
    map.on('click', function (e) {
      if (!picking) return;
      picking = false;
      container.classList.remove('picking');
      if (onPick) onPick([e.latlng.lat, e.latlng.lng]);
    });
    M.render();
    return map;
  };

  M.invalidate = function () {
    if (!map) return;
    // Two passes: once after the tab becomes visible, once after layout settles.
    requestAnimationFrame(function () { map.invalidateSize({ pan: false }); });
    setTimeout(function () { map.invalidateSize({ pan: false }); }, 300);
  };

  M.pick = function (cb) {
    picking = true; onPick = cb;
    if (map) map.getContainer().classList.add('picking');
  };

  M.focus = function (point, zoom) { if (map && point) map.setView(point, zoom || Math.max(map.getZoom(), 15)); };

  function popupNode(title, lines, actions) {
    var box = el('div', 'pop');
    box.appendChild(el('strong', null, title));
    (lines || []).forEach(function (l) { if (l) { var p = el('div', l.cls || '', l.text); box.appendChild(p); } });
    if (actions && actions.length) {
      var row = el('div', 'pop-actions');
      actions.forEach(function (a) {
        var b = a.href ? el('a', 'btn small', a.label) : el('button', 'btn small', a.label);
        if (a.href) { b.href = a.href; b.target = '_blank'; b.rel = 'noopener'; }
        if (a.onClick) b.addEventListener('click', a.onClick);
        row.appendChild(b);
      });
      box.appendChild(row);
    }
    return box;
  }

  M.render = function () {
    if (!map || !SG.state) return;
    var st = SG.state, t = SG.t;
    Object.keys(layers).forEach(function (k) { layers[k].clearLayers(); });

    st.alerts.forEach(function (a) {
      if (SG.alertState(a) !== 'active' || !a.area) return;
      L.polygon(a.area.polygon, { color: SEV_COLORS[a.severity] || COLORS.alert, weight: 2, dashArray: '6 6', fillOpacity: 0.04, interactive: true })
        .bindPopup(popupNode(t('ev.' + a.event) + ' · ' + t('sev.' + a.severity), [{ text: a.area.name }, { text: t('map.alertarea'), cls: 'muted' }]))
        .addTo(layers.alerts);
    });

    st.zones.forEach(function (z) {
      L.polygon(z.polygon, { color: COLORS[z.kind], weight: 2, fillColor: COLORS[z.kind], fillOpacity: z.kind === 'safe' ? 0.12 : 0.35 })
        .bindPopup(popupNode(t('zone.' + z.kind), [{ text: z.name }, { text: SG.fmtTime(z.updatedAt), cls: 'muted' }]))
        .addTo(layers.zones);
    });

    st.closures.forEach(function (c) {
      L.polyline(c.path, { color: COLORS.closure, weight: 7, opacity: 0.9, dashArray: '2 10', lineCap: 'round' })
        .bindPopup(popupNode('⛔ ' + t('map.closure'), [{ text: c.name }]))
        .addTo(layers.closures);
    });

    var REPORT_ICON = { flooding: '🌊', road_blocked: '🚧', power_line: '⚡', trapped: '🆘', injury: '🩹', building_damage: '🏚️', other: '⚠️' };
    st.reports.forEach(function (r) {
      if (r.status === 'false' || r.status === 'resolved') return;
      var verified = r.status === 'verified';
      L.marker([r.lat, r.lng], { icon: divIcon('<span>' + REPORT_ICON[r.type] + '</span>', verified ? 'rep verified' : 'rep unverified', 28) })
        .bindPopup(popupNode(t('rpt.' + r.type), [
          { text: verified ? '✔ ' + t('rep.verified') : '? ' + t('rep.unverified'), cls: verified ? 'ok' : 'warn' },
          { text: r.note || '' },
          { text: t('rep.confirmed', { n: r.confirmations || 1 }) + ' · ' + SG.fmtAge(SG.now() - Date.parse(r.createdAt)), cls: 'muted' }
        ]))
        .addTo(layers.reports);
    });

    var p = SG.point();
    SG.shelters().forEach(function (x) {
      var s = x.s;
      var cls = 'shelter ' + s.status + (x.inDanger ? ' danger' : '');
      var lines = [
        { text: t('shelter.' + s.status) + (s.status === 'open' ? ' · ' + t('shelter.left', { n: x.left }) : ''), cls: s.status === 'open' ? 'ok' : 'warn' },
        s.stepFree ? { text: '♿ ' + t('shelter.stepfree') } : null,
        x.d != null ? { text: SG.fmtDist(x.d) } : null
      ];
      if (p && s.status === 'open') {
        lines.push(x.route.length ? { text: '⚠ ' + t('shelter.route_warn', { name: x.route[0] }), cls: 'warn' } : { text: t('shelter.route_ok'), cls: 'muted' });
      }
      var actions = [{ label: '🧭 ' + t('shelter.go'), onClick: function () { map.closePopup(); SG.emit('guide', x); } }];
      if (navigator.onLine) actions.push({ label: t('shelter.directions'), href: 'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + s.lat + ',' + s.lng });
      L.marker(x.pt, { icon: divIcon('<span>⛺</span>', cls, 32), zIndexOffset: 500 })
        .bindPopup(popupNode(s.name, lines, actions))
        .addTo(layers.shelters);
    });

    M.renderYou();
  };

  M.renderYou = function () {
    if (!map) return;
    var loc = SG.prefs.location;
    if (youMarker) { map.removeLayer(youMarker); youMarker = null; }
    if (youCircle) { map.removeLayer(youCircle); youCircle = null; }
    if (!loc || !loc.point) return;
    if (loc.accuracy && loc.accuracy > 30) {
      youCircle = L.circle(loc.point, { radius: loc.accuracy, color: '#1c7ed6', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
    }
    youMarker = L.marker(loc.point, { icon: divIcon('<span></span>', 'you', 22), zIndexOffset: 1000, keyboard: false })
      .bindTooltip(SG.t('map.you'), { permanent: false }).addTo(map);
  };
})(typeof self !== 'undefined' ? self : this);
