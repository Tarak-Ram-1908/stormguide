/*
 * Outbox: every report / SOS / relay is written to IndexedDB FIRST, then sent.
 * If the network is down the item simply waits; it is retried on reconnect, on
 * Background Sync (service worker) and on every app start. Items carry a
 * client-generated id, so the server de-duplicates retries and multi-channel
 * delivery (internet + SMS + QR relay of the same SOS).
 *
 * Works in pages and in the service worker (importScripts). If IndexedDB is
 * unavailable (some private modes) it falls back to memory + localStorage.
 */
(function (root) {
  'use strict';
  var DB_NAME = 'stormguide';
  var STORE = 'outbox';
  var TIMEOUT_MS = 8000;
  var dbPromise = null;
  var memory = {};
  var hasLS = (function () { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch (e) { return false; } })();

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }

  function lsLoad() {
    if (!hasLS) return;
    try { var x = JSON.parse(localStorage.getItem('sg.outbox.fallback') || '{}'); memory = x || {}; } catch (e) { memory = {}; }
  }
  function lsSave() {
    if (!hasLS) return;
    try { localStorage.setItem('sg.outbox.fallback', JSON.stringify(memory)); } catch (e) { /* full */ }
  }
  lsLoad();

  function tx(mode, fn) {
    return openDb().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var t;
        try { t = db.transaction(STORE, mode); } catch (e) { return resolve(fn(null)); }
        var store = t.objectStore(STORE);
        var result;
        Promise.resolve(fn(store)).then(function (r) { result = r; });
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  function put(item) {
    return tx('readwrite', function (store) {
      if (!store) { memory[item.id] = item; lsSave(); return item; }
      store.put(item);
      return item;
    }).catch(function () { memory[item.id] = item; lsSave(); return item; });
  }

  function get(id) {
    return tx('readonly', function (store) {
      if (!store) return memory[id] || null;
      return reqP(store.get(id)).then(function (x) { return x || null; });
    }).catch(function () { return memory[id] || null; });
  }

  function all() {
    return tx('readonly', function (store) {
      if (!store) return Object.keys(memory).map(function (k) { return memory[k]; });
      return reqP(store.getAll());
    }).then(function (list) {
      // Merge any memory fallback items (written while IDB failed).
      var ids = {}; (list || []).forEach(function (x) { ids[x.id] = 1; });
      Object.keys(memory).forEach(function (k) { if (!ids[k]) list.push(memory[k]); });
      return list.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    }).catch(function () { return Object.keys(memory).map(function (k) { return memory[k]; }); });
  }

  function postWithTimeout(url, body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      cache: 'no-store'
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    }, function (err) { clearTimeout(timer); throw err; });
  }

  var flushing = null;
  /** Send every queued item once. Resolves { sent, failed, remaining }. Never rejects. */
  function flush() {
    if (flushing) return flushing;
    flushing = all().then(function (items) {
      var queued = items.filter(function (x) { return x.status === 'queued'; });
      var out = { sent: 0, failed: 0, remaining: 0, items: [] };
      return queued.reduce(function (p, item) {
        return p.then(function () {
          return postWithTimeout(item.url, item.body).then(function (r) {
            item.lastTry = Date.now();
            if (r.status >= 200 && r.status < 300) {
              item.status = 'sent'; item.sentAt = Date.now(); item.response = r.data; out.sent++;
            } else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
              item.status = 'failed'; item.lastError = (r.data && r.data.error) || ('HTTP ' + r.status); out.failed++;
            } else {
              item.attempts = (item.attempts || 0) + 1; item.lastError = 'HTTP ' + r.status; out.remaining++;
            }
            out.items.push(item);
            return put(item);
          }, function (err) {
            item.attempts = (item.attempts || 0) + 1; item.lastTry = Date.now();
            item.lastError = (err && err.name === 'AbortError') ? 'timeout' : 'offline';
            out.remaining++;
            out.items.push(item);
            return put(item);
          });
        });
      }, Promise.resolve()).then(function () { return out; });
    }).catch(function () { return { sent: 0, failed: 0, remaining: -1, items: [] }; })
      .then(function (r) { flushing = null; return r; });
    return flushing;
  }

  /** Remove sent items older than `days` to keep storage small. */
  function cleanup(days) {
    var cutoff = Date.now() - (days || 7) * 86400e3;
    return all().then(function (items) {
      return Promise.all(items.filter(function (x) { return x.status !== 'queued' && (x.createdAt || 0) < cutoff; }).map(function (x) {
        return tx('readwrite', function (store) {
          if (!store) { delete memory[x.id]; lsSave(); return; }
          store.delete(x.id);
        });
      }));
    }).catch(function () { /* ignore */ });
  }

  root.OutboxDB = { put: put, get: get, all: all, flush: flush, cleanup: cleanup };
})(typeof self !== 'undefined' ? self : this);
