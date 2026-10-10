'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-test-'));
process.env.AUTHORITY_PIN = '4321';
const { createServer } = require('../server');

let base, server;
test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });

test('state is public, cacheable with ETag, and has no private SOS data', async () => {
  const r = await fetch(base + '/api/state');
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.ok(s.alerts.length > 0 && s.shelters.length > 0 && s.zones.length > 0);
  assert.equal(s.sos, undefined);
  assert.equal(s.private, undefined);
  const r2 = await fetch(base + '/api/state', { headers: { 'If-None-Match': r.headers.get('etag') } });
  assert.equal(r2.status, 304);
});

test('reports: validation, dedupe by client id, confirmations counted once per device', async () => {
  assert.equal((await post('/api/reports', { type: 'flooding', lat: 200, lng: 80 })).status, 400);
  assert.equal((await post('/api/reports', { type: 'nope', lat: 13, lng: 80 })).status, 400);
  const a = await post('/api/reports', { id: 'rep-test-1', type: 'flooding', lat: 13.01, lng: 80.22, note: '<b>x</b>' });
  assert.equal(a.status, 201);
  const b = await post('/api/reports', { id: 'rep-test-1', type: 'flooding', lat: 13.01, lng: 80.22 });
  assert.equal(b.status, 200);
  assert.equal((await b.json()).duplicate, true);
  await post('/api/reports/rep-test-1/confirm', { deviceId: 'device-aaaa-1' });
  await post('/api/reports/rep-test-1/confirm', { deviceId: 'device-aaaa-1' });
  const c = await (await post('/api/reports/rep-test-1/confirm', { deviceId: 'device-bbbb-2' })).json();
  assert.equal(c.confirmations, 3);
  const s = await (await fetch(base + '/api/state')).json();
  const rep = s.reports.find(r => r.id === 'rep-test-1');
  assert.equal(rep.note, '<b>x</b>', 'stored as text; the client renders with textContent');
});

test('SOS over internet then SMS with the same id merges channels', async () => {
  const r = await post('/api/sos', { id: 'sos-test-1', lat: 13.04, lng: 80.23, people: 2, situation: 'trapped', lang: 'fr' });
  assert.equal(r.status, 201);
  const smsRes = await fetch(base + '/api/sms/inbound', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'From=%2B91999&Body=' + encodeURIComponent('SOS 13.04000,80.23000 P:2 L:fr ID:sos-test-1') });
  const xml = await smsRes.text();
  assert.match(xml, /SOS reçu/);
  const tok = (await (await post('/api/auth', { pin: '4321' })).json()).token;
  const ov = await (await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer ' + tok } })).json();
  const s = ov.sos.filter(x => x.id === 'sos-test-1');
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].channels.sort(), ['sms', 'web']);
  assert.equal(s[0].phone, '+91999');
  // Public status endpoint hides location and phone.
  const pub = await (await fetch(base + '/api/sos/sos-test-1')).json();
  assert.equal(pub.lat, undefined); assert.equal(pub.phone, undefined);
  // Dispatch shows up for the traveller.
  await fetch(base + '/api/admin/sos/sos-test-1', { method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'dispatched', etaMin: 25 }) });
  const pub2 = await (await fetch(base + '/api/sos/sos-test-1')).json();
  assert.equal(pub2.status, 'dispatched'); assert.equal(pub2.etaMin, 25);
});

test('QR relay forwards a report', async () => {
  const r = await post('/api/relay', { kind: 'report', data: { id: 'relay-test-1', type: 'road_blocked', lat: 13.0, lng: 80.25 } });
  assert.equal(r.status, 201);
  const s = await (await fetch(base + '/api/state')).json();
  assert.equal(s.reports.find(x => x.id === 'relay-test-1').via, 'relay');
});

test('authority endpoints require a valid token; wrong PIN rejected', async () => {
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401);
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer 9999999999999.forged' } })).status, 401);
  assert.equal((await post('/api/auth', { pin: '0000' })).status, 401);
});

test('authority publishes an alert with fixed instructions only; update bumps revision; cancel', async () => {
  const tok = (await (await post('/api/auth', { pin: '4321' })).json()).token;
  const H = { Authorization: 'Bearer ' + tok };
  const poly = [[13.0, 80.2], [13.0, 80.25], [12.97, 80.25], [12.97, 80.2]];
  const bad = await post('/api/admin/alerts', { event: 'flood', severity: 'Severe', headline: 'Test', instructions: ['run_around'], area: { name: 'X', polygon: poly } }, H);
  assert.equal(bad.status, 400, 'free-text instructions are not allowed');
  const ok = await (await post('/api/admin/alerts', { event: 'flood', severity: 'Severe', headline: 'Test flood', instructions: ['move_higher'], area: { name: 'Test area', polygon: poly } }, H)).json();
  assert.equal(ok.alert.revision, 1);
  const up = await (await post('/api/admin/alerts', { id: ok.alert.id, event: 'flood', severity: 'Extreme', headline: 'Test flood worse', instructions: ['evacuate'], area: { name: 'Test area', polygon: poly } }, H)).json();
  assert.equal(up.alert.revision, 2); assert.equal(up.alert.msgType, 'Update');
  const c = await (await post('/api/admin/alerts/' + ok.alert.id + '/cancel', {}, H)).json();
  assert.equal(c.alert.msgType, 'Cancel');
});

test('zones from circle, report promotion to zone, simulation steps', async () => {
  const tok = (await (await post('/api/auth', { pin: '4321' })).json()).token;
  const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const z = await (await post('/api/admin/zones', { kind: 'flooded', name: 'Circle', center: [13.02, 80.22], radiusKm: 0.3 }, H)).json();
  assert.equal(z.zone.polygon.length, 24);
  const pr = await (await fetch(base + '/api/admin/reports/rep-test-1', { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'verified', promote: true }) })).json();
  assert.equal(pr.zone.kind, 'flooded');
  let sim = await (await post('/api/admin/simulate', { action: 'start', manual: true }, H)).json();
  assert.equal(sim.simulation.step, 0);
  let s = await (await fetch(base + '/api/state')).json();
  assert.equal(s.alerts.length, 0, 'calm city');
  for (let i = 0; i < 3; i++) sim = await (await post('/api/admin/simulate', { action: 'next' }, H)).json();
  s = await (await fetch(base + '/api/state')).json();
  assert.ok(s.alerts.some(a => a.id === 'gcc-flood' && a.originalLang === 'ta'));
  await post('/api/admin/reset', { scenario: 'chennai-flood' }, H);
});

test('static files: app shell, SW build id injected, traversal blocked, security headers', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  const sw = await (await fetch(base + '/sw.js')).text();
  assert.doesNotMatch(sw, /__BUILD_ID__|__SHELL_FILES__/);
  assert.match(sw, /"\/index.html"/);
  assert.equal((await fetch(base + '/..%2fserver.js')).status === 200, false);
  assert.equal((await fetch(base + '/api/nope')).status, 404);
});

test('oversized and malformed bodies are rejected', async () => {
  const big = await fetch(base + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'x'.repeat(70000) }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  const bad = await fetch(base + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
});
