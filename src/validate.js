'use strict';
/**
 * Input validation. Every value from the network passes through here.
 * Functions throw ValidationError with a client-safe message.
 */
const crypto = require('crypto');
const Geo = require('../public/js/geo.js');

class ValidationError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

function fail(msg) { throw new ValidationError(msg); }

function obj(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${name || 'body'} must be an object`);
  return v;
}

function str(v, name, { max = 200, min = 0, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    if (min > 0) fail(`${name} is required`);
    return '';
  }
  if (typeof v !== 'string') fail(`${name} must be text`);
  // Strip control characters except newline/tab; normalise whitespace ends.
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (s.length < min) fail(`${name} is too short`);
  if (s.length > max) fail(`${name} is too long (max ${max})`);
  return s;
}

function num(v, name, { min = -Infinity, max = Infinity, int = false, optional = false, def } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return def;
    fail(`${name} is required`);
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${name} must be a number`);
  if (int && !Number.isInteger(n)) fail(`${name} must be a whole number`);
  if (n < min || n > max) fail(`${name} must be between ${min} and ${max}`);
  return n;
}

function oneOf(v, list, name, { optional = false, def } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return def;
  if (!list.includes(v)) fail(`${name} must be one of: ${list.join(', ')}`);
  return v;
}

function bool(v, def = false) {
  if (v === undefined || v === null) return def;
  return v === true || v === 'true' || v === 1;
}

function lat(v, name = 'lat') { return round6(num(v, name, { min: -90, max: 90 })); }
function lng(v, name = 'lng') { return round6(num(v, name, { min: -180, max: 180 })); }
function round6(n) { return Math.round(n * 1e6) / 1e6; }

function point(v, name = 'point') {
  if (!Array.isArray(v) || v.length < 2) fail(`${name} must be [lat, lng]`);
  return [lat(v[0], `${name} lat`), lng(v[1], `${name} lng`)];
}

function polygon(v, name = 'polygon', { maxPoints = 200 } = {}) {
  if (!Array.isArray(v) || v.length < 3) fail(`${name} needs at least 3 points`);
  if (v.length > maxPoints) fail(`${name} has too many points (max ${maxPoints})`);
  const pts = v.map((p, i) => point(p, `${name}[${i}]`));
  // Reject degenerate polygons (all points nearly identical).
  const c = Geo.polygonCentroid(pts);
  if (pts.every(p => Geo.distanceKm(p, c) < 0.005)) fail(`${name} is too small`);
  return pts;
}

function polyline(v, name = 'path', { maxPoints = 200 } = {}) {
  if (!Array.isArray(v) || v.length < 2) fail(`${name} needs at least 2 points`);
  if (v.length > maxPoints) fail(`${name} has too many points (max ${maxPoints})`);
  return v.map((p, i) => point(p, `${name}[${i}]`));
}

function listOf(v, list, name, { max = 20 } = {}) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`${name} must be a list`);
  if (v.length > max) fail(`${name} has too many items`);
  const out = [];
  for (const x of v) {
    if (!list.includes(x)) fail(`${name} contains an unknown value: ${String(x).slice(0, 30)}`);
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
/** Client-generated ids allow offline creation + server dedupe. */
function clientId(v, name = 'id') {
  if (v === undefined || v === null || v === '') return newId();
  if (typeof v !== 'string' || !ID_RE.test(v)) fail(`${name} is invalid`);
  return v;
}

function newId(len = 10) {
  // URL-safe, unambiguous alphabet (no 0/O/1/l/I).
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

function isoTime(v, name, { optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) fail(`${name} must be a date/time`);
  return new Date(t).toISOString();
}

/** Client timestamps can be wrong (bad clock, queued for hours). Clamp to a sane window. */
function clientTime(v) {
  const now = Date.now();
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t)) return new Date(now).toISOString();
  if (t > now + 5 * 60e3) return new Date(now).toISOString();        // future -> now
  if (t < now - 3 * 24 * 3600e3) return new Date(now - 3 * 24 * 3600e3).toISOString(); // > 3 days old
  return new Date(t).toISOString();
}

module.exports = {
  ValidationError, fail, obj, str, num, oneOf, bool, lat, lng, point, polygon, polyline,
  listOf, clientId, newId, isoTime, clientTime, ID_RE
};
