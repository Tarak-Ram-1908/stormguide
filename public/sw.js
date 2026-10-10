/*
 * StormGuide service worker.
 *  - Precaches the whole app shell (list injected by the server), so the app
 *    opens with no network at all.
 *  - Navigations: network first with a 3 s timeout, then the cached shell.
 *  - /api/state: network first (4 s), cached copy as fallback.
 *  - Map tiles: cache first; tiles fetched while online (or by the offline
 *    pack) keep working offline.
 *  - Background Sync flushes the outbox (reports, SOS) when signal returns.
 * The server injects a build hash on every deploy, so clients update.
 */
/* global OutboxDB */
'use strict';
var BUILD = '__BUILD_ID__';
var SHELL = __SHELL_FILES__;
var SHELL_CACHE = 'sg-shell-' + BUILD;
var DATA_CACHE = 'sg-data-v1';
var TILE_CACHE = 'sg-tiles-v1';
var MAX_TILES = 3000;

importScripts('/js/db.js');

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('sg-shell-') === 0 && k !== SHELL_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function timeout(ms, promise) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (r) { clearTimeout(t); resolve(r); }, function (e) { clearTimeout(t); reject(e); });
  });
}

function networkFirst(request, cacheName, ms, fallbackUrl) {
  var net = fetch(request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(cacheName).then(function (c) { c.put(fallbackUrl || request, copy); });
    }
    return res;
  });
  return timeout(ms, net).catch(function () {
    return caches.match(fallbackUrl || request, { ignoreSearch: true }).then(function (hit) {
      if (!hit) return net; // nothing cached: wait for the network after all
      // Mark the copy so the app can say "offline - showing saved updates".
      var h = new Headers(hit.headers);
      h.set('X-SG-From-Cache', '1');
      return hit.blob().then(function (b) { return new Response(b, { status: 200, headers: h }); });
    });
  });
}

var trimming = false;
function trimTiles() {
  if (trimming) return;
  trimming = true;
  caches.open(TILE_CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      var extra = keys.length - MAX_TILES;
      return Promise.all(keys.slice(0, Math.max(0, extra)).map(function (k) { return c.delete(k); }));
    });
  }).then(function () { trimming = false; }, function () { trimming = false; });
}

function tile(request) {
  return caches.open(TILE_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) { cache.put(request, res.clone()); if (Math.random() < 0.02) trimTiles(); }
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.hostname === 'tile.openstreetmap.org') { event.respondWith(tile(req)); return; }
  if (url.origin !== self.location.origin) return; // weather API etc.: straight to network

  if (url.pathname === '/api/state') { event.respondWith(networkFirst(req, DATA_CACHE, 4000, '/api/state')); return; }
  if (url.pathname.indexOf('/api/') === 0) return; // live API (SSE, SOS status): never cached

  if (req.mode === 'navigate') {
    var page = url.pathname === '/' ? '/index.html' : url.pathname;
    event.respondWith(
      timeout(3000, fetch(req)).catch(function () {
        return caches.match(page, { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match('/index.html');
        });
      })
    );
    return;
  }

  // Static assets: cache first (versioned by build), network as fallback.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    })
  );
});

function notifyClients(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (list) {
    list.forEach(function (c) { c.postMessage(msg); });
  });
}

self.addEventListener('sync', function (event) {
  if (event.tag === 'sg-outbox') {
    event.waitUntil(OutboxDB.flush().then(function (r) {
      return notifyClients({ type: 'outbox', result: { sent: r.sent, failed: r.failed, remaining: r.remaining } }).then(function () {
        if (r.remaining > 0) throw new Error('retry later'); // ask the browser to retry the sync
      });
    }));
  }
});

self.addEventListener('message', function (event) {
  var d = event.data || {};
  if (d.type === 'flush') {
    event.waitUntil(OutboxDB.flush().then(function (r) {
      return notifyClients({ type: 'outbox', result: { sent: r.sent, failed: r.failed, remaining: r.remaining } });
    }));
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ('focus' in list[i]) return list[i].focus();
    return self.clients.openWindow('/');
  }));
});
