'use strict';
/**
 * Tiny JSON-file store. One in-memory document, saved atomically (tmp + rename)
 * with a short debounce. Every mutation bumps `version`, which drives ETags and
 * live pushes. Private data (SOS requests, device ids for confirmations) is kept
 * outside the public state so it can never leak through /api/state.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const scenario = require('./scenario');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const LIMITS = { reports: 500, sos: 1000, rumors: 50, zones: 200, closures: 200, alerts: 50 };

const events = new EventEmitter();
events.setMaxListeners(0);

let db = null;
let saveTimer = null;

function fresh(name) {
  return {
    // Seconds since epoch: stays monotonic even if the (ephemeral) disk is wiped on restart.
    version: Math.floor(Date.now() / 1000),
    updatedAt: new Date().toISOString(),
    public: scenario.build(name || 'chennai-flood'),
    private: { sos: [], confirmations: {} }
  };
}

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.public || !parsed.private) throw new Error('bad shape');
    db = parsed;
  } catch (e) {
    db = fresh('chennai-flood');
    saveNow();
  }
  return db;
}

function saveNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    // Disk is best effort (Render free disks are ephemeral); memory stays authoritative.
    console.error('[store] save failed:', e.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 250);
}

function prune(pub, priv) {
  const now = Date.now();
  // Drop cancelled alerts 6 h after cancellation and anything expired for > 24 h.
  pub.alerts = pub.alerts.filter(a => {
    const exp = Date.parse(a.expires);
    if (a.msgType === 'Cancel' && now - Date.parse(a.updatedAt) > 6 * 3600e3) return false;
    return !(Number.isFinite(exp) && now - exp > 24 * 3600e3);
  });
  for (const k of ['reports', 'rumors', 'zones', 'closures', 'alerts']) {
    if (pub[k].length > LIMITS[k]) pub[k] = pub[k].slice(-LIMITS[k]);
  }
  if (priv.sos.length > LIMITS.sos) priv.sos = priv.sos.slice(-LIMITS.sos);
}

/**
 * Apply a change. `fn(public, private)` may return a value; `opts.silent`
 * skips the version bump (for private-only bookkeeping).
 */
function mutate(fn, opts = {}) {
  if (!db) load();
  const result = fn(db.public, db.private);
  prune(db.public, db.private);
  if (!opts.privateOnly) {
    db.version += 1;
    db.updatedAt = new Date().toISOString();
    events.emit('change', db.version);
  }
  if (opts.emit) events.emit(opts.emit.event, opts.emit.data);
  scheduleSave();
  return result;
}

function get() { if (!db) load(); return db; }

function publicState() {
  const d = get();
  return Object.assign({ version: d.version, updatedAt: d.updatedAt }, d.public);
}

function reset(name) {
  const prev = db ? db.version : 0;
  db = fresh(name);
  db.version = Math.max(db.version, prev + 1);
  events.emit('change', db.version);
  saveNow();
  return db;
}

module.exports = { load, get, mutate, publicState, reset, events, saveNow, FILE };
