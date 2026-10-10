/*
 * StormGuide core: data sync, offline cache, location, risk maths, outbox,
 * notifications, offline map pack and weather. No UI code here.
 */
/* global Geo, I18N, OutboxDB */
(function (root) {
  'use strict';

  var SG = root.SG = root.SG || {};
  var listeners = {};
  SG.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  SG.off = function (ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); };
  SG.emit = function (ev, data) { (listeners[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); };

  // ------------------------------------------------------------ storage (never throws)
  var LS = {
    get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  SG.LS = LS;

  function rid(n) {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = '', b = new Uint8Array(n || 10);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.random() * 256; });
    for (var i = 0; i < b.length; i++) s += a[b[i] % a.length];
    return s;
  }
  SG.rid = rid;

  // ------------------------------------------------------------ preferences
  var defaults = {
    lang: null,
    profile: { stepFree: false, children: false, elderly: false },
    notif: false,
    location: null,            // { mode: 'gps'|'manual'|'demo', point:[lat,lng], accuracy, label, at }
    deviceId: rid(16),
    lastNotified: {},          // alertId -> severity rank already notified
    confirmed: {},             // reportId -> true
    offlinePack: null,         // { at, center, tiles }
    contactPhone: ''
  };
  SG.prefs = Object.assign({}, defaults, LS.get('sg.prefs', {}));
  if (!SG.prefs.deviceId) SG.prefs.deviceId = rid(16);
  SG.savePrefs = function () { LS.set('sg.prefs', SG.prefs); };
  SG.savePrefs();

  SG.lang = function () { return SG.prefs.lang || I18N.detect(navigator.languages || [navigator.language]); };
  SG.t = function (key, vars) { return I18N.t(SG.lang(), key, vars); };

  // ------------------------------------------------------------ state + network
  SG.state = null;
  SG.meta = LS.get('sg.meta', { fetchedAt: 0, serverOffset: 0, etag: null });
  SG.net = { online: navigator.onLine !== false, live: false, slow: false, lastError: null };

  SG.now = function () { return Date.now() + (SG.meta.serverOffset || 0); };

  function loadCachedState() {
    var s = LS.get('sg.state', null);
    if (s && s.region) { SG.state = s; SG.emit('state', { source: 'cache' }); }
    return s;
  }

  function fetchWithTimeout(url, opts, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    opts = Object.assign({ cache: 'no-store' }, opts || {}, { signal: ctrl ? ctrl.signal : undefined });
    return fetch(url, opts).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  SG.fetchWithTimeout = fetchWithTimeout;

  function setOnline(v, err) {
    var changed = SG.net.online !== v;
    SG.net.online = v; SG.net.lastError = err || null;
    if (changed) SG.emit('net', SG.net);
  }

  var refreshing = null, refreshAgain = false;
  /** Fetch latest state. Falls back to cache after 3.5 s (slow or captive networks). */
  var slowRetrying = false;
  /**
   * Fetch latest state. The UI falls back to saved data after 3.5 s, but a slow
   * connection is not the same as no connection: a timeout keeps trying in the
   * background with a 20 s limit and is labelled "slow", not "offline".
   */
  SG.refresh = function (waitMs) {
    if (refreshing) { refreshAgain = true; return refreshing; } // a newer version arrived mid-fetch
    var headers = {};
    if (SG.state && SG.meta.etag) headers['If-None-Match'] = SG.meta.etag;
    var t0 = Date.now();
    var url = waitMs ? '/api/state?wait=1' : '/api/state';
    refreshing = fetchWithTimeout(url, { headers: headers }, waitMs || 3500).then(function (res) {
      if (res.status === 304) { SG.meta.fetchedAt = Date.now(); LS.set('sg.meta', SG.meta); SG.net.slow = false; setOnline(true); SG.emit('net', SG.net); return false; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // The service worker answers from its cache when the network fails; it marks that copy.
      var fromNetwork = res.headers.get('X-SG-From-Cache') !== '1';
      return res.json().then(function (data) {
        if (fromNetwork) {
          SG.meta.serverOffset = data.serverTime - Date.now() + (Date.now() - t0) / 2;
          SG.meta.fetchedAt = Date.now();
          SG.meta.etag = res.headers.get('ETag');
          SG.net.slow = false;
          setOnline(true);
        } else {
          SG.net.slow = false;
          setOnline(false, 'cached');
        }
        var prev = SG.state;
        SG.state = data;
        LS.set('sg.state', data);
        LS.set('sg.meta', SG.meta);
        SG.emit('state', { source: fromNetwork ? 'network' : 'cache', prev: prev });
        return true;
      });
    }).catch(function (e) {
      var timedOut = e && e.name === 'AbortError' && navigator.onLine !== false;
      SG.net.slow = timedOut;
      setOnline(false, timedOut ? 'timeout' : 'offline');
      SG.emit('net', SG.net);
      if (!SG.state) loadCachedState();
      if (timedOut && !waitMs && !slowRetrying) {
        slowRetrying = true;
        setTimeout(function () { SG.refresh(20000).then(function () { slowRetrying = false; }); }, 0);
      }
      return false;
    }).then(function (r) {
      refreshing = null;
      if (refreshAgain) { refreshAgain = false; return SG.refresh(); }
      return r;
    });
    return refreshing;
  };

  // Live updates over Server-Sent Events; falls back to polling.
  var es = null, pollTimer = null, retryDelay = 3000;
  SG.connectLive = function () {
    if (typeof EventSource === 'undefined') return startPolling();
    if (es) try { es.close(); } catch (e) { /* ignore */ }
    try { es = new EventSource('/api/stream'); } catch (e) { return startPolling(); }
    es.addEventListener('hello', function (e) {
      SG.net.live = true; retryDelay = 3000; setOnline(true); SG.emit('net', SG.net);
      try { var d = JSON.parse(e.data); if (!SG.state || d.version !== SG.state.version) SG.refresh(); } catch (x) { SG.refresh(); }
    });
    es.addEventListener('version', function (e) {
      try { var d = JSON.parse(e.data); if (!SG.state || d.version !== SG.state.version) SG.refresh(); } catch (x) { SG.refresh(); }
    });
    es.onerror = function () {
      SG.net.live = false; SG.emit('net', SG.net);
      try { es.close(); } catch (x) { /* ignore */ }
      es = null;
      setTimeout(SG.connectLive, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
    };
    startPolling();
  };
  function startPolling() {
    if (pollTimer) return;
    var ticks = 0;
    // Every 10 s while offline (so we notice the network coming back fast), every 30 s otherwise.
    pollTimer = setInterval(function () {
      ticks++;
      if (SG.net.live) return;
      if (!SG.net.online || ticks % 3 === 0) SG.refresh();
    }, 10000);
  }

  root.addEventListener('online', function () { SG.refresh(); SG.flush(); SG.connectLive(); });
  root.addEventListener('offline', function () { setOnline(false, 'offline'); SG.net.live = false; SG.emit('net', SG.net); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { SG.refresh(); SG.flush(); } });

  // ------------------------------------------------------------ alerts + risk
  SG.alertState = function (a) {
    var exp = Date.parse(a.expires);
    if (a.msgType === 'Cancel') return 'cancelled';
    if (isFinite(exp) && exp < SG.now()) return 'expired';
    return 'active';
  };

  SG.sortedAlerts = function () {
    if (!SG.state) return [];
    var order = { active: 0, expired: 1, cancelled: 2 };
    var p = SG.point();
    return SG.state.alerts.slice().map(function (a) {
      return { a: a, st: SG.alertState(a), here: !!(p && a.area && Geo.pointInPolygon(p, a.area.polygon)) };
    }).sort(function (x, y) {
      return (order[x.st] - order[y.st]) || ((y.here ? 1 : 0) - (x.here ? 1 : 0)) ||
        (Geo.SEVERITY_RANK[y.a.severity] - Geo.SEVERITY_RANK[x.a.severity]);
    });
  };

  SG.point = function () { return SG.prefs.location && SG.prefs.location.point || null; };

  var NEAR_KM = 1.5;
  /** Personal risk for the current location. Computed on the device: location never leaves the phone. */
  SG.risk = function () {
    var p = SG.point();
    if (!SG.state || !p) return { level: 'unknown' };
    var best = null;
    SG.state.zones.forEach(function (z) {
      if (z.kind === 'safe') return;
      var d = Geo.distanceToPolygonKm(p, z.polygon);
      if (!best || d < best.d) best = { z: z, d: d };
    });
    var alertsHere = SG.state.alerts.filter(function (a) {
      return SG.alertState(a) === 'active' && a.area && Geo.pointInPolygon(p, a.area.polygon);
    });
    var maxRank = alertsHere.reduce(function (m, a) { return Math.max(m, Geo.SEVERITY_RANK[a.severity] || 0); }, 0);
    var distFromRegion = Geo.distanceKm(p, SG.state.region.center);
    var r = { level: 'clear', alertsHere: alertsHere, maxRank: maxRank, distFromRegion: distFromRegion };
    if (best && best.d === 0) { r.level = 'inside'; r.zone = best.z; r.distKm = 0; }
    else if (best && best.d <= NEAR_KM) { r.level = 'near'; r.zone = best.z; r.distKm = best.d; }
    else if (maxRank >= 3) { r.level = 'alert'; }
    var safe = SG.state.zones.filter(function (z) { return z.kind === 'safe' && Geo.pointInPolygon(p, z.polygon); })[0];
    if (safe) r.safeZone = safe;
    return r;
  };

  /** Does the straight line from p to target cross a danger zone or a closed road? */
  SG.routeCheck = function (p, target) {
    if (!SG.state || !p) return [];
    var hits = [];
    SG.state.zones.forEach(function (z) {
      // A zone the person is already inside is reported by the risk card, not as a route warning.
      if (z.kind !== 'safe' && !Geo.pointInPolygon(p, z.polygon) && Geo.segmentCrossesPolygon(p, target, z.polygon)) hits.push(z.name);
    });
    SG.state.closures.forEach(function (c) {
      if (Geo.segmentCrossesPolyline(p, target, c.path)) hits.push(c.name);
    });
    return hits;
  };

  /** Shelters ordered for this person: open first, step-free first if needed, then distance. */
  SG.shelters = function () {
    if (!SG.state) return [];
    var p = SG.point();
    var stepFree = SG.prefs.profile.stepFree;
    var statusRank = { open: 0, full: 1, closed: 2 };
    return SG.state.shelters.map(function (s) {
      var pt = [s.lat, s.lng];
      var inDanger = SG.state.zones.some(function (z) { return z.kind !== 'safe' && Geo.pointInPolygon(pt, z.polygon); });
      return {
        s: s, pt: pt, inDanger: inDanger,
        d: p ? Geo.distanceKm(p, pt) : null,
        route: p ? SG.routeCheck(p, pt) : [],
        left: Math.max(0, s.capacity - s.occupancy)
      };
    }).sort(function (a, b) {
      var sa = statusRank[a.s.status] + (a.inDanger ? 2 : 0), sb = statusRank[b.s.status] + (b.inDanger ? 2 : 0);
      if (sa !== sb) return sa - sb;
      if (stepFree && a.s.stepFree !== b.s.stepFree) return a.s.stepFree ? -1 : 1;
      if (a.d == null || b.d == null) return 0;
      return a.d - b.d;
    });
  };

  // ------------------------------------------------------------ location
  var watchId = null;
  SG.setLocation = function (loc) {
    SG.prefs.location = Object.assign({ at: Date.now() }, loc);
    SG.savePrefs();
    SG.emit('location', SG.prefs.location);
  };

  SG.startGps = function (onError) {
    if (!('geolocation' in navigator)) { if (onError) onError('unsupported'); return; }
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(function (pos) {
      SG.setLocation({ mode: 'gps', point: [pos.coords.latitude, pos.coords.longitude], accuracy: pos.coords.accuracy, label: null });
    }, function (err) {
      if (onError) onError(err && err.code === 1 ? 'denied' : 'unavailable');
    }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
  };
  SG.stopGps = function () { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; };

  SG.setDemo = function (id) {
    var place = (SG.state && SG.state.demoPlaces || []).filter(function (p) { return p.id === id; })[0];
    if (!place) return;
    SG.stopGps();
    SG.setLocation({ mode: 'demo', point: place.point, accuracy: 20, label: place.name });
  };
  SG.setManual = function (point) {
    SG.stopGps();
    SG.setLocation({ mode: 'manual', point: [+point[0].toFixed(6), +point[1].toFixed(6)], accuracy: 50, label: null });
  };

  // ------------------------------------------------------------ outbox
  SG.queue = function (kind, url, body) {
    var item = { id: body.id || rid(10), kind: kind, url: url, body: body, status: 'queued', attempts: 0, createdAt: Date.now() };
    if (!body.id) body.id = item.id;
    return OutboxDB.put(item).then(function () {
      registerSync();
      SG.emit('outbox');
      return item;
    });
  };

  function registerSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.sync && reg.sync.register) return reg.sync.register('sg-outbox');
    }).catch(function () { /* Background Sync unsupported (Safari/Firefox): we retry on 'online' + app start */ });
  }

  SG.flush = function () {
    return OutboxDB.flush().then(function (r) { if (r.sent || r.failed) SG.emit('outbox', r); return r; });
  };
  setInterval(function () { if (navigator.onLine !== false) SG.flush(); }, 45000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'outbox') SG.emit('outbox', e.data.result);
    });
  }

  // ------------------------------------------------------------ notifications (only on escalation)
  SG.enableNotifications = function () {
    if (!('Notification' in root)) return Promise.resolve(false);
    return Notification.requestPermission().then(function (p) {
      SG.prefs.notif = p === 'granted'; SG.savePrefs(); return SG.prefs.notif;
    });
  };

  /** Returns alerts that are new or escalated since the last check (and records them). */
  SG.checkEscalation = function () {
    if (!SG.state) return [];
    var p = SG.point();
    var out = [];
    SG.state.alerts.forEach(function (a) {
      if (SG.alertState(a) !== 'active') return;
      var relevant = !p || (a.area && Geo.distanceToPolygonKm(p, a.area.polygon) < 5);
      if (!relevant) return;
      var rank = Geo.SEVERITY_RANK[a.severity] || 0;
      var prev = SG.prefs.lastNotified[a.id] || 0;
      if (rank > prev) { out.push(a); SG.prefs.lastNotified[a.id] = rank; }
    });
    if (out.length) SG.savePrefs();
    return out;
  };

  SG.showNotification = function (title, body) {
    if (!SG.prefs.notif || !('Notification' in root) || Notification.permission !== 'granted') return;
    var opts = { body: body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'sg-alert', renotify: true, vibrate: [300, 100, 300] };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, opts); }).catch(function () { try { new Notification(title, opts); } catch (e) { /* */ } });
    } else { try { new Notification(title, opts); } catch (e) { /* */ } }
  };

  // ------------------------------------------------------------ offline map pack
  // Tile URLs come from UI.TILES (ui.js).
  var packing = false;
  /**
   * Download a small set of map tiles around the person and the nearest
   * shelters so the map still works offline. Kept deliberately small (OSM
   * tile usage policy): ~2 km radius at street zooms + a city overview.
   */
  SG.offlinePack = function (onProgress) {
    if (packing || !SG.state) return Promise.resolve(false);
    packing = true;
    var center = SG.point() || SG.state.region.center;
    var tiles = Geo.tilesAround(SG.state.region.center, 14, 11, 12)
      .concat(Geo.tilesAround(center, 1.5, 13, 16));
    SG.shelters().filter(function (x) { return x.s.status === 'open'; }).slice(0, 2).forEach(function (x) {
      tiles = tiles.concat(Geo.tilesAround(x.pt, 0.6, 15, 16));
    });
    var seen = {};
    tiles = tiles.filter(function (t) { var k = t.z + '/' + t.x + '/' + t.y; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 300);
    var done = 0, ok = 0, i = 0;
    function worker() {
      if (i >= tiles.length) return Promise.resolve();
      var t = tiles[i++];
      var url = UI.tileUrl(t.z, t.x, t.y);
      return fetchWithTimeout(url, { mode: 'cors', cache: 'default' }, 10000).then(function (r) { if (r.ok || r.type === 'opaque') ok++; }, function () { /* skip */ })
        .then(function () { done++; if (onProgress) onProgress(Math.round(done * 100 / tiles.length)); return worker(); });
    }
    return Promise.all([worker(), worker(), worker(), worker()]).then(function () {
      packing = false;
      var success = ok >= tiles.length * 0.8;
      if (success) { SG.prefs.offlinePack = { at: Date.now(), center: center, tiles: ok }; SG.savePrefs(); }
      return success;
    });
  };

  /** Remove all downloaded / cached map tiles (they live in the browser's Cache Storage). */
  SG.deleteOfflineMap = function () {
    SG.prefs.offlinePack = null; SG.savePrefs();
    if (!('caches' in root)) return Promise.resolve();
    return Promise.all(['sg-tiles-v1', 'sg-tiles-v2'].map(function (n) { return caches.delete(n); })).catch(function () { /* ignore */ });
  };

  // ------------------------------------------------------------ weather (automatic, clearly not official)
  /** IMD 24-h rainfall categories (mm): heavy 64.5-115.5, very heavy 115.6-204.4, extremely heavy >= 204.5. */
  SG.weatherAdvice = function (w) {
    var out = [];
    if (w.rain >= 204.5) out.push('wx.extreme');
    else if (w.rain >= 115.6) out.push('wx.veryheavy');
    else if (w.rain >= 64.5) out.push('wx.heavy');
    if (w.gust >= 62) out.push('wx.gale');
    if (w.tmax >= 40) out.push('wx.heat');
    return out;
  };
  SG.weather = function () {
    var p = SG.point() || (SG.state && SG.state.region.center);
    if (!p) return Promise.resolve(null);
    var cached = LS.get('sg.weather', null);
    if (cached && Date.now() - cached.at < 3600e3 && Geo.distanceKm(cached.p, p) < 10) return Promise.resolve(cached);
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p[0].toFixed(3) + '&longitude=' + p[1].toFixed(3) +
      '&daily=precipitation_sum,wind_gusts_10m_max,temperature_2m_max&timezone=auto&forecast_days=1';
    return fetchWithTimeout(url, {}, 6000).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.daily) return cached || null;
      var w = { at: Date.now(), p: p, rain: +(d.daily.precipitation_sum[0] || 0), gust: +(d.daily.wind_gusts_10m_max[0] || 0), tmax: +(d.daily.temperature_2m_max[0] || 0) };
      LS.set('sg.weather', w);
      return w;
    }).catch(function () { return cached || null; });
  };

  // ------------------------------------------------------------ formatting
  SG.fmtAge = function (ms) {
    var s = Math.max(0, ms) / 1000;
    if (s < 60) return SG.t('time.just');
    if (s < 3600) return SG.t('time.min', { n: Math.round(s / 60) });
    if (s < 86400) return SG.t('time.hr', { n: Math.round(s / 3600) });
    return SG.t('time.day', { n: Math.round(s / 86400) });
  };
  SG.fmtTime = function (iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var tz = (SG.state && SG.state.region.timeZone) || undefined;
    try {
      return new Intl.DateTimeFormat(SG.lang(), { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d) +
        (tz ? ' ' + (SG.state.region.tzLabel || '') : '');
    } catch (e) { return d.toLocaleString(); }
  };
  SG.fmtDist = function (km) { return Geo.formatDistance(km); };

  SG.loadCachedState = loadCachedState;
})(typeof self !== 'undefined' ? self : this);
