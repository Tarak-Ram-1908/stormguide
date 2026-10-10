'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-test-'));
process.env.HOST_EMAILS = 'a@test.org,b@test.org';
process.env.INITIAL_PIN = '4321';
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
  const tok = (await (await post('/api/auth', { email: 'a@test.org', pin: '4321' })).json()).token;
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
  assert.equal((await post('/api/auth', { email: 'a@test.org', pin: '0000' })).status, 401);
  assert.equal((await post('/api/auth', { email: 'stranger@test.org', pin: '4321' })).status, 401, 'non-hosts cannot log in');
});

test('authority publishes an alert with fixed instructions only; update bumps revision; cancel', async () => {
  const tok = (await (await post('/api/auth', { email: 'a@test.org', pin: '4321' })).json()).token;
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
  const tok = (await (await post('/api/auth', { email: 'a@test.org', pin: '4321' })).json()).token;
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

test('hosts: access request -> approve -> new host logs in; PIN change; founders protected', async () => {
  const login = async (email, pin) => { const r = await post('/api/auth', { email, pin }); const j = await r.json(); if (!j.token) console.log('LOGIN FAIL', email, r.status, j); return j; };
  const b = await login('b@test.org', '4321');
  assert.ok(b.token); assert.equal(b.mustChangePin, true);
  const H = { Authorization: 'Bearer ' + b.token };
  // change PIN
  assert.equal((await post('/api/admin/pin', { currentPin: 'nope', newPin: '9876' }, H)).status, 401);
  assert.equal((await post('/api/admin/pin', { currentPin: '4321', newPin: '9876' }, H)).status, 200);
  assert.equal((await post('/api/auth', { email: 'b@test.org', pin: '4321' })).status, 401, 'old PIN stops working');
  const b2 = await login('b@test.org', '9876');
  const H2 = { Authorization: 'Bearer ' + b2.token };
  // request access
  const rq = await post('/api/access-request', { name: 'New Officer', email: 'new@test.org', reason: 'NDRF', pin: '5555x' });
  assert.equal(rq.status, 201);
  assert.equal((await post('/api/access-request', { name: 'New Officer', email: 'new@test.org', pin: '5555x' })).status, 409, 'no duplicate');
  assert.equal((await post('/api/auth', { email: 'new@test.org', pin: '5555x' })).status, 401, 'cannot log in before approval');
  const list = await (await fetch(base + '/api/admin/hosts', { headers: H2 })).json();
  assert.equal(list.requests.length, 1);
  const ap = await post('/api/admin/requests/' + list.requests[0].id, { action: 'approve' }, H2);
  assert.equal(ap.status, 200);
  const n = await login('new@test.org', '5555x');
  assert.ok(n.token, 'approved host can log in');
  // new host cannot remove founders, but founders can remove the new host
  const del1 = await fetch(base + '/api/admin/hosts/a%40test.org', { method: 'DELETE', headers: { Authorization: 'Bearer ' + n.token } });
  assert.equal(del1.status, 403);
  const del2 = await fetch(base + '/api/admin/hosts/new%40test.org', { method: 'DELETE', headers: H2 });
  assert.equal(del2.status, 200);
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer ' + n.token } })).status, 401, 'removed host loses access at once');
  // scenario reset keeps accounts
  await post('/api/admin/reset', { scenario: 'chennai-calm' }, H2);
  assert.ok((await login('b@test.org', '9876')).token);
  await post('/api/admin/reset', { scenario: 'chennai-flood' }, H2);
});

test('same problem reported twice nearby is merged; same device counts once', async () => {
  const a = await (await post('/api/reports', { id: 'dup-a-1', type: 'building_damage', lat: 13.05, lng: 80.25, deviceId: 'device-one-111' })).json();
  assert.equal(a.merged, false);
  const b = await (await post('/api/reports', { id: 'dup-b-1', type: 'building_damage', lat: 13.0505, lng: 80.2504, deviceId: 'device-two-222' })).json();
  assert.equal(b.merged, true); assert.equal(b.id, 'dup-a-1'); assert.equal(b.confirmations, 2);
  const c = await (await post('/api/reports', { id: 'dup-c-1', type: 'building_damage', lat: 13.0503, lng: 80.2502, deviceId: 'device-one-111' })).json();
  assert.equal(c.merged, true); assert.equal(c.confirmations, 2, 'reporter cannot inflate the count');
  const conf = await (await post('/api/reports/dup-a-1/confirm', { deviceId: 'device-two-222' })).json();
  assert.equal(conf.confirmations, 2, 'already counted device does not add again');
  const far = await (await post('/api/reports', { id: 'dup-d-1', type: 'building_damage', lat: 13.07, lng: 80.25, deviceId: 'device-three-3' })).json();
  assert.equal(far.merged, false, '2 km away is a different report');
});
