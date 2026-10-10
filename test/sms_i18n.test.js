'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const sms = require('../src/sms');
const I18N = require('../public/js/i18n.js');

test('app-built SOS SMS round-trips through the gateway parser', () => {
  const body = sms.buildSms('sos', { lat: 13.04, lng: 80.2337, people: 3, situation: 'water_rising', lang: 'ja', id: 'abcd1234', note: 'third floor' });
  assert.ok(body.length <= 160, 'fits in one SMS: ' + body.length);
  const r = sms.parseSms(body + ' https://maps.google.com/?q=13.04000,80.23370');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'sos');
  assert.deepEqual([r.data.lat, r.data.lng, r.data.people, r.data.situation, r.data.lang, r.data.id, r.data.note],
    [13.04, 80.2337, 3, 'water_rising', 'ja', 'abcd1234', 'third floor']);
});

test('report SMS needs a location and maps type codes', () => {
  assert.equal(sms.parseSms('RPT FLOOD').ok, false);
  const r = sms.parseSms('rpt power 13.03300,80.26900 wire down');
  assert.equal(r.ok, true);
  assert.equal(r.data.type, 'power_line');
  assert.equal(r.data.note, 'wire down');
});

test('SOS without coordinates is still accepted (operator calls back)', () => {
  const r = sms.parseSms('help please');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'sos');
  assert.equal(r.data.lat, null);
});

test('garbage and out-of-range input is rejected safely', () => {
  assert.equal(sms.parseSms('hello world').ok, false);
  assert.equal(sms.parseSms(null).ok, false);
  const r = sms.parseSms('SOS 99.123,80.123');
  assert.equal(r.data.lat, null, 'latitude 99 ignored');
});

test('TwiML escapes XML', () => {
  assert.match(sms.twiml('a < b & "c"'), /a &lt; b &amp; &quot;c&quot;/);
});

test('Twilio signature verification', () => {
  const token = 'secret', url = 'https://example.org/api/sms/inbound', params = { From: '+911', Body: 'SOS' };
  const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
  const sig = crypto.createHmac('sha1', token).update(data).digest('base64');
  assert.equal(sms.verifyTwilioSignature(token, url, params, sig), true);
  assert.equal(sms.verifyTwilioSignature(token, url, params, 'bad'), false);
  assert.equal(sms.verifyTwilioSignature('', url, params, sig), false);
});

test('every language translates every fixed-vocabulary key (no gaps in safety text)', () => {
  const V = I18N.VOCAB;
  const keys = [].concat(
    V.events.map(x => 'ev.' + x), V.severities.map(x => 'sev.' + x), V.instructions.map(x => 'ins.' + x),
    V.zoneKinds.map(x => 'zone.' + x), V.reportTypes.map(x => 'rpt.' + x), V.situations.map(x => 'sit.' + x),
    V.rumorTopics.map(x => 'rt.' + x), V.rumorVerdicts.map(x => 'rumor.' + x), V.phrases.map(x => 'ph.' + x));
  for (const l of I18N.LANGS) {
    const missing = keys.filter(k => !I18N.has(l.code, k));
    assert.deepEqual(missing, [], l.code + ' missing ' + missing.join(','));
  }
});

test('UI strings: every language has every English key (except the SMS format help)', () => {
  const en = Object.keys(I18N._dict.en);
  for (const l of I18N.LANGS) {
    const missing = en.filter(k => k !== 'sms.bad' && !I18N.has(l.code, k));
    assert.deepEqual(missing, [], l.code + ' missing ' + missing.join(','));
  }
});

test('placeholders survive translation', () => {
  const en = I18N._dict.en;
  for (const l of I18N.LANGS) {
    for (const k of Object.keys(en)) {
      const want = (en[k].match(/\{\w+\}/g) || []).sort().join();
      const got = (I18N.t(l.code, k).match(/\{\w+\}/g) || []).sort().join();
      assert.equal(got, want, `${l.code} ${k}`);
    }
  }
});

test('translateAlert never alters the official text', () => {
  const a = { event: 'flood', severity: 'Extreme', instructions: ['move_higher'], headline: 'வெள்ள அபாயம்', description: 'x', originalLang: 'ta' };
  const fr = I18N.translateAlert(a, 'fr');
  assert.equal(fr.original.headline, a.headline);
  assert.equal(fr.event, 'Inondation');
  assert.equal(fr.instructions[0], 'Montez immédiatement en hauteur ou à un étage supérieur.');
  assert.equal(I18N.t('xx', 'ev.flood'), 'Flood', 'unknown language falls back to English');
  assert.equal(I18N.detect(['pt-BR', 'de-AT']), 'de');
});
