'use strict';
/**
 * Coded SMS format, built by the app when there is no internet but there is
 * mobile signal. Short, ASCII-only (fits a single 160-char SMS), and still
 * readable by a human operator if no gateway is connected.
 *
 *   SOS 13.04001,80.23370 P:2 S:TRAP L:fr ID:k3j9x2mq7a  water up to knees
 *   RPT FLOOD 13.02300,80.22300 L:ja ID:p8w2c4n6r1  road under water
 *
 * Parsing is tolerant: case-insensitive, any order of tags, coordinates may be
 * inside a maps link, and an SOS with no coordinates is still accepted
 * (the operator can call back the sender's number).
 */
const crypto = require('crypto');

const TYPE_CODES = {
  FLOOD: 'flooding', FLD: 'flooding', WATER: 'flooding',
  ROAD: 'road_blocked', BLOCK: 'road_blocked',
  POWER: 'power_line', WIRE: 'power_line',
  TRAP: 'trapped', TRAPPED: 'trapped',
  INJ: 'injury', INJURY: 'injury',
  BLDG: 'building_damage', BUILDING: 'building_damage',
  OTHER: 'other'
};
const SIT_CODES = { TRAP: 'trapped', INJ: 'injured', WATER: 'water_rising', MED: 'medical', OTHER: 'other' };
const LANGS = ['en', 'ta', 'hi', 'te', 'fr', 'de', 'es', 'zh', 'ja', 'ar'];

const COORD_RE = /(-?\d{1,2}\.\d{2,8})\s*,\s*(-?\d{1,3}\.\d{2,8})/;

function parseSms(text) {
  if (typeof text !== 'string') return { ok: false, error: 'empty' };
  const raw = text.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 640);
  const m = /^\s*(SOS|RPT|REPORT|HELP)\b/i.exec(raw);
  if (!m) return { ok: false, error: 'unknown_command' };
  const kind = /^(SOS|HELP)$/i.test(m[1]) ? 'sos' : 'report';
  let rest = raw.slice(m[0].length);

  const data = { id: null, lat: null, lng: null, people: null, note: '', type: null, situation: null, lang: 'en' };

  const c = COORD_RE.exec(rest);
  if (c) {
    const lat = Number(c[1]), lng = Number(c[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) { data.lat = lat; data.lng = lng; }
    rest = rest.replace(c[0], ' ');
  }
  // Remove leftover URL fragments of a maps link.
  rest = rest.replace(/https?:\/\/\S+/gi, ' ');

  rest = rest.replace(/\bID:([A-Za-z0-9_-]{4,40})\b/i, (_, v) => { data.id = v; return ' '; });
  rest = rest.replace(/\bP:(\d{1,3})\b/i, (_, v) => { data.people = Math.min(999, parseInt(v, 10)); return ' '; });
  rest = rest.replace(/\bL:([a-z]{2})\b/i, (_, v) => { v = v.toLowerCase(); if (LANGS.includes(v)) data.lang = v; return ' '; });
  rest = rest.replace(/\bS:([A-Z]+)\b/i, (_, v) => { data.situation = SIT_CODES[v.toUpperCase()] || 'other'; return ' '; });

  if (kind === 'report') {
    const t = /^\s*([A-Za-z]+)\b/.exec(rest);
    if (t && TYPE_CODES[t[1].toUpperCase()]) {
      data.type = TYPE_CODES[t[1].toUpperCase()];
      rest = rest.slice(t[0].length);
    } else data.type = 'other';
    if (data.lat === null) return { ok: false, error: 'report_needs_location', kind };
  } else {
    data.situation = data.situation || 'other';
  }
  data.note = rest.replace(/\s+/g, ' ').trim().slice(0, 200);
  return { ok: true, kind, data };
}

const SmsCode = require('../public/js/smscode.js');
const buildSms = SmsCode.build;

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
}

function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`;
}

/**
 * Twilio request signature check (X-Twilio-Signature).
 * signature = base64(HMAC-SHA1(authToken, url + concat(sorted(key + value))))
 */
function verifyTwilioSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { parseSms, buildSms, twiml, xmlEscape, verifyTwilioSignature };
