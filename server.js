'use strict';
/**
 * StormGuide server. Zero npm dependencies: Node's built-in http module serves
 * the offline-first web app (public/) and a small JSON API.
 *
 *   Public:    GET  /api/state  (ETag/304)   GET /api/stream (Server-Sent Events)
 *              POST /api/reports  /api/reports/:id/confirm  /api/sos  /api/relay
 *              GET  /api/sos/:id  POST /api/sms/inbound (Twilio-compatible webhook)
 *   Authority: POST /api/auth -> bearer token, then /api/admin/*
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const store = require('./src/store');
const V = require('./src/validate');
const sms = require('./src/sms');
const scenario = require('./src/scenario');
const I18N = require('./public/js/i18n.js');
const Geo = require('./public/js/geo.js');

const PORT = Number(process.env.PORT) || 3000;
// Control-room hosts. Only these people (plus hosts they approve) can change data.
const FOUNDER_HOSTS = String(process.env.HOST_EMAILS || 'lokesh09006@gmail.com,alaharitarak@gmail.com')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const INITIAL_PIN = String(process.env.INITIAL_PIN || '2026');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';      // optional: email hosts about access requests
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'StormGuide <onboarding@resend.dev>';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SMS_NUMBER = String(process.env.SMS_NUMBER || '').replace(/[^\d+]/g, '');
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 64 * 1024;
const TOKEN_TTL = 12 * 3600e3;

const VOC = I18N.VOCAB;
const startedAt = Date.now();

// ---------------------------------------------------------------- static files

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg)/;

/** Hash of every public file: changes on each deploy, so the service worker updates itself. */
function computeBuildId() {
  const h = crypto.createHash('sha256');
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else { h.update(path.relative(PUBLIC_DIR, p)); h.update(fs.readFileSync(p)); }
    }
  })(PUBLIC_DIR);
  return h.digest('hex').slice(0, 12);
}
const BUILD_ID = computeBuildId();

/** Precache list for the service worker: the whole app shell, so it opens offline. */
function listShellFiles() {
  const out = ['/'];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        const rel = '/' + path.relative(PUBLIC_DIR, p).split(path.sep).join('/');
        if (rel === '/sw.js' || /LICENSE|\.md$/.test(rel)) continue;
        out.push(rel);
      }
    }
  })(PUBLIC_DIR);
  return out;
}
const SHELL_FILES = listShellFiles();

const fileCache = new Map(); // path -> { mtimeMs, body, gz, etag, type }

function loadFile(abs) {
  const st = fs.statSync(abs);
  if (!st.isFile()) return null;
  const hit = fileCache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  let body = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  if (abs === path.join(PUBLIC_DIR, 'sw.js')) {
    body = Buffer.from(body.toString('utf8')
      .replace(/__BUILD_ID__/g, BUILD_ID)
      .replace(/__SHELL_FILES__/g, JSON.stringify(SHELL_FILES)));
  }
  const type = MIME[ext] || 'application/octet-stream';
  const entry = {
    mtimeMs: st.mtimeMs, body, type,
    gz: COMPRESSIBLE.test(type) && body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : null,
    etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"'
  };
  fileCache.set(abs, entry);
  return entry;
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return sendText(res, 400, 'Bad path'); }
  if (rel.includes('\0')) return sendText(res, 400, 'Bad path');
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
  let f;
  try { f = loadFile(abs); } catch (e) { f = null; }
  if (!f) return sendText(res, 404, 'Not found');

  const headers = { 'Content-Type': f.type, ETag: f.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
  if (rel === '/sw.js') headers['Cache-Control'] = 'no-store';
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
  const useGz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (useGz) headers['Content-Encoding'] = 'gzip';
  const body = useGz ? f.gz : f.body;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------- helpers

function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Leaflet positions elements with inline styles
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "connect-src 'self' https://tile.openstreetmap.org https://api.open-meteo.com",
    "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"
  ].join('; '));
  if ((req.headers['x-forwarded-proto'] || '') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

function sendJson(req, res, status, obj, extra = {}) {
  let body = Buffer.from(JSON.stringify(obj));
  const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra);
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = (req.headers['content-type'] || '').toLowerCase();
      if (!raw) return resolve({});
      try {
        if (type.includes('application/x-www-form-urlencoded')) {
          return resolve(Object.fromEntries(new URLSearchParams(raw)));
        }
        resolve(JSON.parse(raw));
      } catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// Token-bucket rate limiter per (bucket, ip).
const buckets = new Map();
function rateLimit(req, name, perMinute, burst = perMinute) {
  const key = name + '|' + clientIp(req);
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: burst, ts: now }; buckets.set(key, b); }
  b.tokens = Math.min(burst, b.tokens + (now - b.ts) * perMinute / 60000);
  b.ts = now;
  if (b.tokens < 1) throw new HttpError(429, 'Too many requests. Please wait a moment.');
  b.tokens -= 1;
}
setInterval(() => { // forget idle buckets
  const cutoff = Date.now() - 10 * 60e3;
  for (const [k, b] of buckets) if (b.ts < cutoff) buckets.delete(k);
}, 60e3).unref();

// ---------------------------------------------------------------- auth

function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url'); }

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
function normEmail(v) {
  const e = V.str(v, 'email', { min: 5, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(e)) V.fail('Enter a valid email address');
  return e;
}
/** Host password rule: at least 6 characters, with at least one letter and one number. */
function checkPin(v, name = 'Password') {
  const pw = V.str(v, name, { min: 6, max: 64 });
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) V.fail(name + ' must contain both letters and numbers');
  return pw;
}
function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function newPinRecord(pin) { const salt = crypto.randomBytes(16).toString('hex'); return { salt, pinHash: hashPin(pin, salt) }; }
function pinOk(rec, pin) {
  if (!rec || !rec.salt) { hashPin(String(pin || ''), 'x'.repeat(32)); return false; } // same work either way
  const a = Buffer.from(hashPin(String(pin || ''), rec.salt), 'hex'), b = Buffer.from(rec.pinHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Founders always exist (initial PIN until they change it). */
function ensureHosts() {
  store.mutate((pub, priv) => {
    priv.hosts = priv.hosts || {};
    priv.accessRequests = priv.accessRequests || [];
    for (const email of FOUNDER_HOSTS) {
      if (!priv.hosts[email]) priv.hosts[email] = Object.assign({ founder: true, addedAt: new Date().toISOString(), addedBy: 'setup', pinChanged: false }, newPinRecord(INITIAL_PIN));
      else priv.hosts[email].founder = true;
    }
  }, { privateOnly: true });
}
function hosts() { return store.get().private.hosts || {}; }

function issueToken(email) {
  const payload = Buffer.from(email).toString('base64url') + '.' + String(Date.now() + TOKEN_TTL);
  return payload + '.' + sign(payload);
}
/** Returns the host email for a valid token, or null. Removed hosts lose access immediately. */
function verifyToken(tok) {
  if (typeof tok !== 'string') return null;
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  const [em, exp, sig] = parts;
  if (!/^\d{10,16}$/.test(exp) || Number(exp) < Date.now()) return null;
  const a = Buffer.from(sign(em + '.' + exp)), b = Buffer.from(sig || '');
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return null;
  let email;
  try { email = Buffer.from(em, 'base64url').toString('utf8'); } catch (e) { return null; }
  return hosts()[email] ? email : null;
}
function requireAuth(req, url) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  const email = verifyToken(tok);
  if (!email) throw new HttpError(401, 'Host login required');
  return email;
}

function notifyHostsByEmail(subject, text) {
  if (!RESEND_API_KEY || typeof fetch !== 'function') return;
  const to = Object.keys(hosts());
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: NOTIFY_FROM, to, subject, text })
  }).then(r => { if (!r.ok) console.error('[notify] email failed', r.status); }).catch(e => console.error('[notify]', e.message));
}

// ---------------------------------------------------------------- live updates (SSE)

const sseClients = new Set();

function sseSend(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* closed */ }
}

store.events.on('change', (version) => {
  for (const c of sseClients) sseSend(c, 'version', { version });
});
store.events.on('sos', (data) => {
  for (const c of sseClients) if (c.authority) sseSend(c, 'sos', data);
});
store.events.on('access', (data) => {
  for (const c of sseClients) if (c.authority) sseSend(c, 'access', data);
});

setInterval(() => {
  for (const c of sseClients) { try { c.res.write(': ping\n\n'); } catch (e) { /* ignore */ } }
}, 20e3).unref();

function handleStream(req, res, url) {
  let authority = false;
  if (url.searchParams.get('token')) authority = !!verifyToken(url.searchParams.get('token'));
  req.socket.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 5000\n\n');
  const client = { res, authority };
  sseClients.add(client);
  sseSend(client, 'hello', { version: store.get().version, serverTime: Date.now(), authority });
  req.on('close', () => sseClients.delete(client));
}

// ---------------------------------------------------------------- domain logic

function publicConfig() {
  return { smsNumber: SMS_NUMBER, build: BUILD_ID, emergency: '112' };
}

function round4(n) { return Math.round(n * 1e4) / 1e4; }

function deviceHash(deviceId) {
  return crypto.createHash('sha256').update(SECRET + deviceId).digest('base64url').slice(0, 16);
}

/** Count a device once per report. Returns true if this device had not counted yet. */
function addConfirmation(priv, report, hash) {
  const set = priv.confirmations[report.id] || (priv.confirmations[report.id] = []);
  if (!hash) return false;
  if (set.includes(hash)) return false;
  set.push(hash);
  return true;
}

const MERGE_KM = 0.15, MERGE_MS = 3 * 3600e3;

function createReport(body, via) {
  V.obj(body);
  const r = {
    id: V.clientId(body.id),
    type: V.oneOf(body.type, VOC.reportTypes, 'type'),
    lat: round4(V.lat(body.lat)),
    lng: round4(V.lng(body.lng)),
    note: V.str(body.note, 'note', { max: 200, optional: true }),
    people: V.num(body.people, 'people', { min: 0, max: 999, int: true, optional: true, def: 0 }),
    status: 'unverified',
    confirmations: 1,
    createdAt: V.clientTime(body.ts),
    receivedAt: new Date().toISOString(),
    via: V.oneOf(via || body.via, ['web', 'sms', 'relay'], 'via', { optional: true, def: 'web' }),
    urgent: false
  };
  const device = body.deviceId ? V.str(body.deviceId, 'deviceId', { min: 8, max: 64 }) : null;
  const hash = device ? deviceHash(device) : null;
  r.urgent = r.type === 'trapped' || r.type === 'injury';
  return store.mutate((pub, priv) => {
    const existing = pub.reports.find(x => x.id === r.id);
    if (existing) return { duplicate: true, report: existing };
    // Same problem already reported close by and recently: count it as a confirmation instead of a new report.
    const now = Date.now();
    const near = pub.reports.find(x => x.type === r.type && (x.status === 'unverified' || x.status === 'verified') &&
      now - Date.parse(x.createdAt) < MERGE_MS && Geo.distanceKm([x.lat, x.lng], [r.lat, r.lng]) <= MERGE_KM);
    if (near) {
      if (!hash || addConfirmation(priv, near, hash)) near.confirmations = (near.confirmations || 1) + 1;
      if (r.note && !near.note) near.note = r.note;
      if (r.people > (near.people || 0)) near.people = r.people;
      return { duplicate: false, merged: true, report: near };
    }
    addConfirmation(priv, r, hash);
    pub.reports.push(r);
    return { duplicate: false, report: r };
  }, r.urgent ? { emit: { event: 'sos', data: { kind: 'report', id: r.id } } } : {});
}

function createSos(body, via, phone) {
  V.obj(body);
  const hasLoc = body.lat !== undefined && body.lat !== null && body.lng !== undefined && body.lng !== null;
  const s = {
    id: V.clientId(body.id),
    lat: hasLoc ? V.lat(body.lat) : null,
    lng: hasLoc ? V.lng(body.lng) : null,
    accuracy: V.num(body.accuracy, 'accuracy', { min: 0, max: 100000, optional: true, def: null }),
    people: V.num(body.people, 'people', { min: 1, max: 999, int: true, optional: true, def: 1 }),
    situation: V.oneOf(body.situation, VOC.situations, 'situation', { optional: true, def: 'other' }),
    note: V.str(body.note, 'note', { max: 200, optional: true }),
    lang: V.oneOf(body.lang, I18N.LANGS.map(l => l.code), 'lang', { optional: true, def: 'en' }),
    phone: phone || null,
    via: V.oneOf(via || body.via, ['web', 'sms', 'relay'], 'via', { optional: true, def: 'web' }),
    createdAt: V.clientTime(body.ts),
    receivedAt: new Date().toISOString(),
    status: 'new', etaMin: null, updatedAt: new Date().toISOString(),
    channels: []
  };
  return store.mutate((pub, priv) => {
    const existing = priv.sos.find(x => x.id === s.id);
    if (existing) {
      // Same request arriving over a second channel (e.g. SMS then internet): merge, don't duplicate.
      if (!existing.channels.includes(s.via)) existing.channels.push(s.via);
      if (existing.lat === null && s.lat !== null) { existing.lat = s.lat; existing.lng = s.lng; existing.accuracy = s.accuracy; }
      if (!existing.phone && s.phone) existing.phone = s.phone;
      return { duplicate: true, sos: existing };
    }
    s.channels = [s.via];
    priv.sos.push(s);
    return { duplicate: false, sos: s };
  }, { privateOnly: true, emit: { event: 'sos', data: { kind: 'sos', id: s.id } } });
}

function sosPublicView(s) {
  return { id: s.id, status: s.status, etaMin: s.etaMin, updatedAt: s.updatedAt, receivedAt: s.receivedAt };
}

function handleInboundSms(params) {
  const from = V.str(params.From || params.from, 'From', { max: 32, optional: true });
  const body = V.str(params.Body || params.body, 'Body', { max: 640, optional: true });
  const parsed = sms.parseSms(body);
  if (!parsed.ok) return { reply: I18N.t('en', 'sms.bad'), parsed };
  const d = parsed.data;
  const lang = d.lang || 'en';
  if (parsed.kind === 'sos') {
    const r = createSos({ id: d.id || undefined, lat: d.lat, lng: d.lng, people: d.people || 1, situation: d.situation, note: d.note, lang }, 'sms', from);
    return { reply: I18N.t(lang, 'sms.sos_ok', { id: r.sos.id }), parsed, id: r.sos.id };
  }
  const r = createReport({ id: d.id || undefined, type: d.type, lat: d.lat, lng: d.lng, note: d.note, people: d.people || 0 }, 'sms');
  return { reply: I18N.t(lang, 'sms.rpt_ok', { id: r.report.id }), parsed, id: r.report.id };
}

// Simulation (scripted storm for demos).
const sim = { running: false, step: 0, timer: null, intervalSec: 12 };
function simApplyNext() {
  if (sim.step >= scenario.TIMELINE.length) { simStop(); return false; }
  const step = scenario.TIMELINE[sim.step];
  store.mutate((pub) => { step.apply(pub, Date.now()); pub.scenario = 'simulation'; });
  sim.step += 1;
  if (sim.step >= scenario.TIMELINE.length) simStop();
  return true;
}
function simStop() { sim.running = false; if (sim.timer) clearInterval(sim.timer); sim.timer = null; }
function simInfo() {
  return { running: sim.running, step: sim.step, total: scenario.TIMELINE.length, intervalSec: sim.intervalSec, labels: scenario.TIMELINE.map(s => s.label) };
}

function adminAlert(body) {
  V.obj(body);
  const now = Date.now();
  const hours = V.num(body.expiresInHours, 'expiresInHours', { min: 0.25, max: 168, optional: true, def: 12 });
  const a = {
    event: V.oneOf(body.event, VOC.events, 'event'),
    severity: V.oneOf(body.severity, VOC.severities, 'severity'),
    source: V.str(body.source, 'source', { max: 120, optional: true }) || 'Disaster control room',
    originalLang: V.oneOf(body.originalLang, I18N.LANGS.map(l => l.code), 'originalLang', { optional: true, def: 'en' }),
    headline: V.str(body.headline, 'headline', { min: 3, max: 200 }),
    description: V.str(body.description, 'description', { max: 1500, optional: true }),
    instructions: V.listOf(body.instructions, VOC.instructions, 'instructions', { max: 10 }),
    area: {
      name: V.str(body.area && body.area.name, 'area name', { min: 2, max: 120 }),
      polygon: V.polygon(body.area && body.area.polygon, 'area polygon')
    },
    expires: new Date(now + hours * 3600e3).toISOString(),
    updatedAt: new Date(now).toISOString()
  };
  if (a.instructions.length === 0) V.fail('Pick at least one instruction');
  return store.mutate((pub) => {
    const id = body.id ? V.clientId(body.id) : null;
    const existing = id ? pub.alerts.find(x => x.id === id) : null;
    if (existing) {
      Object.assign(existing, a, { msgType: 'Update', revision: (existing.revision || 1) + 1 });
      return existing;
    }
    const created = Object.assign({ id: 'al-' + V.newId(8), msgType: 'Alert', revision: 1, onset: a.updatedAt, issuedAt: a.updatedAt }, a);
    pub.alerts.push(created);
    return created;
  });
}

function findOr404(list, id, what) {
  const x = list.find(i => i.id === id);
  if (!x) throw new HttpError(404, `${what} not found`);
  return x;
}

// ---------------------------------------------------------------- routes

const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
}

route('GET', '/api/health', (req, res) => sendJson(req, res, 200, {
  ok: true, build: BUILD_ID, uptimeSec: Math.round((Date.now() - startedAt) / 1000), version: store.get().version, live: sseClients.size
}));

route('GET', '/api/state', (req, res) => {
  const st = store.publicState();
  const etag = `"v${st.version}-${BUILD_ID}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
  st.config = publicConfig();
  st.serverTime = Date.now();
  sendJson(req, res, 200, st, { ETag: etag, 'Cache-Control': 'no-cache' });
});

route('GET', '/api/stream', (req, res, p, url) => handleStream(req, res, url));

route('POST', '/api/reports', async (req, res) => {
  rateLimit(req, 'report', 20, 10);
  const r = createReport(await readBody(req), 'web');
  sendJson(req, res, r.duplicate || r.merged ? 200 : 201, { ok: true, id: r.report.id, status: r.report.status, duplicate: r.duplicate, merged: !!r.merged, confirmations: r.report.confirmations });
});

route('POST', '/api/reports/:id/confirm', async (req, res, p) => {
  rateLimit(req, 'confirm', 30, 10);
  const body = V.obj(await readBody(req));
  const device = V.str(body.deviceId, 'deviceId', { min: 8, max: 64 });
  const hash = deviceHash(device);
  const count = store.mutate((pub, priv) => {
    const r = findOr404(pub.reports, p.id, 'Report');
    if (addConfirmation(priv, r, hash)) r.confirmations = (r.confirmations || 1) + 1;
    return r.confirmations;
  });
  sendJson(req, res, 200, { ok: true, confirmations: count });
});

route('POST', '/api/sos', async (req, res) => {
  rateLimit(req, 'sos', 10, 5);
  const r = createSos(await readBody(req), 'web');
  sendJson(req, res, r.duplicate ? 200 : 201, Object.assign({ ok: true, duplicate: r.duplicate }, sosPublicView(r.sos)));
});

route('GET', '/api/sos/:id', (req, res, p) => {
  rateLimit(req, 'sos-status', 60, 20);
  if (!V.ID_RE.test(p.id)) throw new HttpError(400, 'Invalid id');
  const s = store.get().private.sos.find(x => x.id === p.id);
  if (!s) throw new HttpError(404, 'Request not found');
  sendJson(req, res, 200, sosPublicView(s));
});

route('POST', '/api/relay', async (req, res) => {
  rateLimit(req, 'relay', 20, 10);
  const body = V.obj(await readBody(req));
  const kind = V.oneOf(body.kind, ['sos', 'report'], 'kind');
  if (kind === 'sos') {
    const r = createSos(V.obj(body.data, 'data'), 'relay');
    return sendJson(req, res, r.duplicate ? 200 : 201, Object.assign({ ok: true, kind, duplicate: r.duplicate }, sosPublicView(r.sos)));
  }
  const r = createReport(V.obj(body.data, 'data'), 'relay');
  sendJson(req, res, r.duplicate ? 200 : 201, { ok: true, kind, id: r.report.id, duplicate: r.duplicate });
});

route('POST', '/api/sms/inbound', async (req, res, p, url) => {
  rateLimit(req, 'sms', 60, 30);
  const params = await readBody(req);
  if (TWILIO_AUTH_TOKEN) {
    const fullUrl = (PUBLIC_URL || `https://${req.headers.host}`) + url.pathname + url.search;
    if (!sms.verifyTwilioSignature(TWILIO_AUTH_TOKEN, fullUrl, params, req.headers['x-twilio-signature'])) {
      throw new HttpError(403, 'Invalid signature');
    }
  }
  let reply;
  try { reply = handleInboundSms(params).reply; } catch (e) { reply = I18N.t('en', 'sms.bad'); }
  sendText(res, 200, sms.twiml(reply), 'text/xml; charset=utf-8');
});

route('POST', '/api/auth', async (req, res) => {
  rateLimit(req, 'auth', 20, 20);
  const body = V.obj(await readBody(req));
  const email = normEmail(body.email);
  rateLimit({ headers: {}, socket: { remoteAddress: 'email:' + email } }, 'auth-email', 8, 8); // per-account brute-force limit
  const rec = hosts()[email];
  if (!pinOk(rec, body.pin)) throw new HttpError(401, 'Wrong email or password');
  sendJson(req, res, 200, { ok: true, token: issueToken(email), email, founder: !!rec.founder, mustChangePin: !rec.pinChanged, expiresInSec: TOKEN_TTL / 1000 });
});

// Anyone can ASK to become a host; only existing hosts can approve.
route('POST', '/api/access-request', async (req, res) => {
  rateLimit(req, 'access', 3, 3);
  const body = V.obj(await readBody(req));
  const email = normEmail(body.email);
  const name = V.str(body.name, 'name', { min: 2, max: 80 });
  const reason = V.str(body.reason, 'reason', { max: 300, optional: true });
  const pin = checkPin(body.pin);
  const r = store.mutate((pub, priv) => {
    priv.accessRequests = priv.accessRequests || [];
    if ((priv.hosts || {})[email]) throw new HttpError(409, 'This email is already a host');
    const dup = priv.accessRequests.find(x => x.email === email && x.status === 'pending');
    if (dup) throw new HttpError(409, 'A request for this email is already waiting for approval');
    if (priv.accessRequests.filter(x => x.status === 'pending').length >= 50) throw new HttpError(429, 'Too many pending requests');
    const reqRec = Object.assign({ id: 'ar-' + V.newId(8), email, name, reason, status: 'pending', createdAt: new Date().toISOString() }, newPinRecord(pin));
    priv.accessRequests.push(reqRec);
    if (priv.accessRequests.length > 200) priv.accessRequests = priv.accessRequests.slice(-200);
    return reqRec;
  }, { privateOnly: true });
  store.events.emit('access', { id: r.id, name, email });
  notifyHostsByEmail('StormGuide: ' + name + ' asks for control-room access',
    name + ' (' + email + ') asked to become a StormGuide host.\nReason: ' + (reason || '-') + '\n\nApprove or reject in the control room: ' + (PUBLIC_URL || '') + '/authority.html');
  sendJson(req, res, 201, { ok: true, status: 'pending' });
});

// ---- authority (all require a valid token)
function admin(method, pattern, handler) {
  route(method, pattern, async (req, res, p, url) => {
    const email = requireAuth(req, url);
    rateLimit(req, 'admin', 240, 60);
    req.host = email;
    // A host still on the initial password must set their own before doing anything else.
    if (!hosts()[email].pinChanged && pattern !== '/api/admin/pin') throw new HttpError(403, 'Set your own password first');
    return handler(req, res, p, url);
  });
}

function hostView() {
  const h = hosts();
  const reqs = (store.get().private.accessRequests || []);
  return {
    hosts: Object.keys(h).sort().map(e => ({ email: e, founder: !!h[e].founder, addedAt: h[e].addedAt, addedBy: h[e].addedBy })),
    requests: reqs.filter(r => r.status === 'pending').map(r => ({ id: r.id, email: r.email, name: r.name, reason: r.reason, createdAt: r.createdAt }))
  };
}

admin('GET', '/api/admin/hosts', (req, res) => sendJson(req, res, 200, Object.assign({ ok: true, me: req.host }, hostView())));

admin('POST', '/api/admin/pin', async (req, res) => {
  const b = V.obj(await readBody(req));
  const rec = hosts()[req.host];
  if (!pinOk(rec, b.currentPin)) throw new HttpError(401, 'Current password is wrong');
  const pin = checkPin(b.newPin, 'New password');
  if (pin === INITIAL_PIN) V.fail('Choose a password different from the initial one');
  store.mutate((pub, priv) => { Object.assign(priv.hosts[req.host], newPinRecord(pin), { pinChanged: true }); }, { privateOnly: true });
  sendJson(req, res, 200, { ok: true });
});

admin('POST', '/api/admin/requests/:id', async (req, res, p) => {
  const b = V.obj(await readBody(req));
  const action = V.oneOf(b.action, ['approve', 'reject'], 'action');
  store.mutate((pub, priv) => {
    const r = findOr404(priv.accessRequests || [], p.id, 'Request');
    if (r.status !== 'pending') throw new HttpError(409, 'Request already handled');
    r.status = action === 'approve' ? 'approved' : 'rejected';
    r.decidedBy = req.host; r.decidedAt = new Date().toISOString();
    if (action === 'approve') {
      priv.hosts[r.email] = { founder: false, salt: r.salt, pinHash: r.pinHash, pinChanged: true, addedAt: r.decidedAt, addedBy: req.host, name: r.name };
    }
    delete r.salt; delete r.pinHash;
  }, { privateOnly: true });
  store.events.emit('access', { id: p.id, decided: action });
  sendJson(req, res, 200, Object.assign({ ok: true }, hostView()));
});

admin('DELETE', '/api/admin/hosts/:email', (req, res, p) => {
  const email = String(p.email).toLowerCase();
  store.mutate((pub, priv) => {
    const h = priv.hosts[email];
    if (!h) throw new HttpError(404, 'Host not found');
    if (h.founder) throw new HttpError(403, 'Founding hosts cannot be removed');
    delete priv.hosts[email];
  }, { privateOnly: true });
  store.events.emit('access', { removed: true });
  sendJson(req, res, 200, Object.assign({ ok: true }, hostView()));
});

admin('GET', '/api/admin/overview', (req, res) => {
  const d = store.get();
  const sos = d.private.sos.slice().reverse();
  sendJson(req, res, 200, {
    sos,
    stats: {
      liveClients: sseClients.size,
      version: d.version,
      sosOpen: sos.filter(s => s.status !== 'resolved').length,
      reportsUnverified: d.public.reports.filter(r => r.status === 'unverified').length,
      accessRequests: (d.private.accessRequests || []).filter(r => r.status === 'pending').length
    },
    me: req.host,
    simulation: simInfo(),
    config: publicConfig(),
    serverTime: Date.now()
  });
});

admin('POST', '/api/admin/alerts', async (req, res) => {
  const a = adminAlert(await readBody(req));
  sendJson(req, res, 200, { ok: true, alert: a });
});

admin('POST', '/api/admin/alerts/:id/cancel', (req, res, p) => {
  const a = store.mutate((pub) => {
    const x = findOr404(pub.alerts, p.id, 'Alert');
    x.msgType = 'Cancel'; x.revision = (x.revision || 1) + 1; x.instructions = ['all_clear'];
    x.updatedAt = new Date().toISOString();
    x.expires = new Date(Date.now() + 3600e3).toISOString();
    return x;
  });
  sendJson(req, res, 200, { ok: true, alert: a });
});

admin('POST', '/api/admin/zones', async (req, res) => {
  const b = V.obj(await readBody(req));
  const kind = V.oneOf(b.kind, VOC.zoneKinds, 'kind');
  const name = V.str(b.name, 'name', { min: 2, max: 120 });
  let polygon;
  if (b.center) {
    const c = V.point(b.center, 'center');
    const r = V.num(b.radiusKm, 'radiusKm', { min: 0.02, max: 20 });
    polygon = Geo.circlePolygon(c, r, 24);
  } else polygon = V.polygon(b.polygon);
  const z = store.mutate((pub) => {
    const zone = { id: 'z-' + V.newId(8), kind, name, polygon, updatedAt: new Date().toISOString() };
    pub.zones.push(zone);
    return zone;
  });
  sendJson(req, res, 201, { ok: true, zone: z });
});

admin('DELETE', '/api/admin/zones/:id', (req, res, p) => {
  store.mutate((pub) => { findOr404(pub.zones, p.id, 'Zone'); pub.zones = pub.zones.filter(z => z.id !== p.id); });
  sendJson(req, res, 200, { ok: true });
});

admin('PATCH', '/api/admin/shelters/:id', async (req, res, p) => {
  const b = V.obj(await readBody(req));
  const s = store.mutate((pub) => {
    const sh = findOr404(pub.shelters, p.id, 'Shelter');
    if (b.status !== undefined) sh.status = V.oneOf(b.status, VOC.shelterStatus, 'status');
    if (b.occupancy !== undefined) {
      sh.occupancy = V.num(b.occupancy, 'occupancy', { min: 0, max: 100000, int: true });
      if (sh.occupancy >= sh.capacity && sh.status === 'open') sh.status = 'full';
      if (sh.occupancy < sh.capacity && sh.status === 'full') sh.status = 'open';
    }
    return sh;
  });
  sendJson(req, res, 200, { ok: true, shelter: s });
});

admin('PATCH', '/api/admin/transport/:id', async (req, res, p) => {
  const b = V.obj(await readBody(req));
  const t = store.mutate((pub) => {
    const x = findOr404(pub.transport, p.id, 'Transport line');
    x.status = V.oneOf(b.status, VOC.transportStatus, 'status');
    x.updatedAt = new Date().toISOString();
    return x;
  });
  sendJson(req, res, 200, { ok: true, transport: t });
});

admin('POST', '/api/admin/closures', async (req, res) => {
  const b = V.obj(await readBody(req));
  const c = { id: 'c-' + V.newId(8), name: V.str(b.name, 'name', { min: 2, max: 120 }), path: V.polyline(b.path), updatedAt: new Date().toISOString() };
  store.mutate((pub) => { pub.closures.push(c); });
  sendJson(req, res, 201, { ok: true, closure: c });
});

admin('DELETE', '/api/admin/closures/:id', (req, res, p) => {
  store.mutate((pub) => { findOr404(pub.closures, p.id, 'Closure'); pub.closures = pub.closures.filter(c => c.id !== p.id); });
  sendJson(req, res, 200, { ok: true });
});

admin('PATCH', '/api/admin/reports/:id', async (req, res, p) => {
  const b = V.obj(await readBody(req));
  const status = V.oneOf(b.status, VOC.reportStatus, 'status');
  const promote = V.bool(b.promote);
  const out = store.mutate((pub) => {
    const r = findOr404(pub.reports, p.id, 'Report');
    r.status = status;
    r.reviewedAt = new Date().toISOString();
    let zone = null;
    if (promote && status === 'verified') {
      const kind = r.type === 'flooding' ? 'flooded' : 'unsafe';
      zone = { id: 'z-' + V.newId(8), kind, name: I18N.t('en', 'rpt.' + r.type) + ' (verified report)', polygon: Geo.circlePolygon([r.lat, r.lng], 0.15, 20), updatedAt: r.reviewedAt, fromReport: r.id };
      pub.zones.push(zone);
    }
    return { report: r, zone };
  });
  sendJson(req, res, 200, Object.assign({ ok: true }, out));
});

admin('PATCH', '/api/admin/sos/:id', async (req, res, p) => {
  const b = V.obj(await readBody(req));
  const s = store.mutate((pub, priv) => {
    const x = findOr404(priv.sos, p.id, 'SOS request');
    x.status = V.oneOf(b.status, VOC.sosStatus, 'status');
    if (b.etaMin !== undefined) x.etaMin = V.num(b.etaMin, 'etaMin', { min: 1, max: 1440, int: true, optional: true, def: null });
    x.updatedAt = new Date().toISOString();
    return x;
  }, { privateOnly: true, emit: { event: 'sos', data: { kind: 'sos-update', id: p.id } } });
  sendJson(req, res, 200, { ok: true, sos: s });
});

admin('POST', '/api/admin/rumors', async (req, res) => {
  const b = V.obj(await readBody(req));
  const r = {
    id: 'rm-' + V.newId(8),
    topic: V.oneOf(b.topic, VOC.rumorTopics, 'topic'),
    verdict: V.oneOf(b.verdict, VOC.rumorVerdicts, 'verdict'),
    claim: V.str(b.claim, 'claim', { min: 3, max: 300 }),
    createdAt: new Date().toISOString()
  };
  store.mutate((pub) => { pub.rumors.push(r); });
  sendJson(req, res, 201, { ok: true, rumor: r });
});

admin('DELETE', '/api/admin/rumors/:id', (req, res, p) => {
  store.mutate((pub) => { findOr404(pub.rumors, p.id, 'Rumor'); pub.rumors = pub.rumors.filter(r => r.id !== p.id); });
  sendJson(req, res, 200, { ok: true });
});

admin('POST', '/api/admin/sms-sim', async (req, res) => {
  const b = V.obj(await readBody(req));
  const out = handleInboundSms({ From: b.from || '+91-demo', Body: b.body });
  sendJson(req, res, 200, Object.assign({ ok: out.parsed.ok }, out));
});

admin('POST', '/api/admin/simulate', async (req, res) => {
  const b = V.obj(await readBody(req));
  const action = V.oneOf(b.action, ['start', 'next', 'stop'], 'action');
  if (action === 'start') {
    simStop();
    sim.intervalSec = V.num(b.intervalSec, 'intervalSec', { min: 3, max: 300, optional: true, def: 12 });
    store.reset('chennai-calm');
    store.mutate((pub) => { pub.scenario = 'simulation'; });
    sim.step = 0;
    sim.running = !b.manual;
    if (sim.running) sim.timer = setInterval(simApplyNext, sim.intervalSec * 1000);
  } else if (action === 'next') {
    if (sim.timer) { clearInterval(sim.timer); sim.timer = null; sim.running = false; }
    simApplyNext();
  } else simStop();
  sendJson(req, res, 200, { ok: true, simulation: simInfo() });
});

admin('POST', '/api/admin/reset', async (req, res) => {
  const b = V.obj(await readBody(req));
  simStop(); sim.step = 0;
  store.reset(V.oneOf(b.scenario, ['chennai-flood', 'chennai-calm'], 'scenario', { optional: true, def: 'chennai-flood' }));
  sendJson(req, res, 200, { ok: true });
});

// ---------------------------------------------------------------- server

async function handle(req, res) {
  securityHeaders(req, res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return sendText(res, 400, 'Bad request'); }
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return r.handler(req, res, params, url);
    }
    const allowed = routes.filter(r => r.re.test(pathname)).map(r => r.method);
    if (allowed.length) { res.setHeader('Allow', allowed.join(', ')); throw new HttpError(405, 'Method not allowed'); }
    throw new HttpError(404, 'Unknown API endpoint');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  return serveStatic(req, res, pathname);
}

function onError(req, res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', req.method, req.url, err.stack || err);
  if (res.headersSent) { try { res.end(); } catch (e) { /* ignore */ } return; }
  sendJson(req, res, status, { ok: false, error: status >= 500 ? 'Server error' : err.message });
}

function createServer() {
  store.load();
  ensureHosts();
  const server = http.createServer((req, res) => {
    Promise.resolve().then(() => handle(req, res)).catch((err) => onError(req, res, err));
  });
  server.keepAliveTimeout = 65e3; // longer than typical load balancer idle timeouts
  server.headersTimeout = 66e3;
  server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) { /* ignore */ } });
  return server;
}

if (require.main === module) {
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
  process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`StormGuide running on http://localhost:${PORT}  (build ${BUILD_ID})`);
    console.log('Control-room hosts: ' + FOUNDER_HOSTS.join(', ') + ' (initial PIN until each host changes it)');
  });
  const shutdown = () => { store.saveNow(); for (const c of sseClients) { try { c.res.end(); } catch (e) { /* */ } } server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createServer, BUILD_ID, SHELL_FILES };
