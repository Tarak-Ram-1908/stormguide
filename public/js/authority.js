/*
 * Control-room console for disaster-management officials.
 * Publishes alerts (fixed instruction vocabulary => safe translation), draws
 * danger zones and closed roads, manages shelters/transport, verifies reports,
 * busts rumors, handles SOS requests and runs the demo storm simulation.
 */
/* global L, UI, I18N, Geo */
(function () {
  'use strict';
  var h = UI.h, T = function (k, v) { return I18N.t('en', k, v); };
  var VOC = I18N.VOCAB;
  var token = null, me = null;
  try { token = sessionStorage.getItem('sg.token'); me = sessionStorage.getItem('sg.me'); } catch (e) { token = null; }
  var state = null, overview = null, panel = 'sos', map = null, layers = {}, es = null;
  var seenSos = {}, firstLoad = true;
  var alertDraft = null, previewLang = 'fr';

  // ------------------------------------------------------------ API
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && url !== '/api/auth' && url !== '/api/admin/pin') { logout(); throw new Error('Session expired — log in again'); }
        if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  function act(promise, okMsg) {
    return promise.then(function (d) { if (okMsg) UI.toast('✅ ' + okMsg, 'ok'); return reload().then(function () { return d; }); })
      .catch(function (e) { UI.toast('❌ ' + e.message, 'danger', 6000); return null; });
  }

  function reload() {
    return Promise.all([
      fetch('/api/state', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      api('GET', '/api/admin/overview')
    ]).then(function (res) {
      state = res[0]; overview = res[1];
      checkNewSos();
      renderStats(); renderMap(); renderPanel();
    }).catch(function (e) { setNet(false); console.warn(e); });
  }

  // ------------------------------------------------------------ login
  function showLogin() {
    document.getElementById('login').hidden = false;
    document.getElementById('app').hidden = true;
    document.getElementById('logout').hidden = true;
    document.getElementById('change-pin').hidden = true;
  }
  function logout() {
    token = null; me = null;
    try { sessionStorage.removeItem('sg.token'); sessionStorage.removeItem('sg.me'); } catch (e) { /* */ }
    if (es) { es.close(); es = null; }
    showLogin();
  }
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pin = document.getElementById('pin').value;
    var email = document.getElementById('email').value.trim();
    api('POST', '/api/auth', { email: email, pin: pin }).then(function (d) {
      token = d.token; me = d.email;
      try { sessionStorage.setItem('sg.token', token); sessionStorage.setItem('sg.me', me); } catch (x) { /* */ }
      document.getElementById('pin').value = '';
      if (d.mustChangePin) changePin(true); // must set a real password before using the console
      else start();
    }).catch(function (err) { document.getElementById('login-error').textContent = err.message; });
  });

  document.getElementById('request-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var out = document.getElementById('request-result');
    api('POST', '/api/access-request', {
      name: document.getElementById('rq-name').value, email: document.getElementById('rq-email').value.trim(),
      reason: document.getElementById('rq-reason').value, pin: document.getElementById('rq-pin').value
    }).then(function () {
      out.className = 'small ok-text';
      out.textContent = '✅ Request sent. The hosts have been notified. Log in with this email and password after approval.';
      e.target.reset();
    }).catch(function (err) { out.className = 'small warn-text'; out.textContent = '❌ ' + err.message; });
  });

  function changePin(first) {
    var cur = h('input', { class: 'input', type: 'password', attrs: { placeholder: first ? 'Initial password' : 'Current password', autocomplete: 'current-password' } });
    var n1 = h('input', { class: 'input', type: 'password', attrs: { placeholder: 'New password', autocomplete: 'new-password', minlength: 6, maxlength: 64 } });
    var n2 = h('input', { class: 'input', type: 'password', attrs: { placeholder: 'Repeat new password', autocomplete: 'new-password' } });
    var err = h('div', { class: 'warn-text' });
    function valid(p) { return p.length >= 6 && /[A-Za-z]/.test(p) && /\d/.test(p); }
    UI.modal([
      h('h2', { text: first ? '🔑 Set your own password' : '🔑 Change your password' }),
      first ? h('p', { class: 'small', text: 'You signed in with the initial password. Choose your own to continue.' }) : null,
      h('p', { class: 'muted small', text: 'Signed in as ' + me + '. At least 6 characters, with letters and numbers.' }),
      cur, n1, n2, err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', text: 'Save password', onclick: function () {
          if (!valid(n1.value)) { err.textContent = 'Use at least 6 characters, with both letters and numbers.'; return; }
          if (n1.value !== n2.value) { err.textContent = 'The new passwords do not match.'; return; }
          api('POST', '/api/admin/pin', { currentPin: cur.value, newPin: n1.value }).then(function () {
            UI.closeModal(); UI.toast('✅ Password saved', 'ok');
            if (first) start();
          }).catch(function (x) { err.textContent = x.message; });
        } }),
        first ? h('button', { class: 'btn ghost', text: 'Log out', onclick: function () { UI.closeModal(); logout(); } })
          : h('button', { class: 'btn ghost', text: 'Cancel', onclick: UI.closeModal }))
    ], { sticky: first });
  }
  document.getElementById('change-pin').addEventListener('click', function () { changePin(false); });

  function start() {
    document.getElementById('login').hidden = true;
    document.getElementById('app').hidden = false;
    document.getElementById('logout').hidden = false;
    document.getElementById('change-pin').hidden = false;
    document.getElementById('logout').textContent = 'Log out' + (me ? ' (' + me.split('@')[0] + ')' : '');
    initMap();
    reload();
    connect();
  }

  function setNet(live) {
    var p = document.getElementById('net-pill');
    p.className = 'net-pill ' + (live ? 'live' : 'offline');
    document.getElementById('net-text').textContent = live ? 'Live' : 'Reconnecting…';
  }

  function connect() {
    if (es) es.close();
    es = new EventSource('/api/stream?token=' + encodeURIComponent(token));
    var pending = null;
    var soon = function () { clearTimeout(pending); pending = setTimeout(reload, 150); };
    es.addEventListener('hello', function () { setNet(true); soon(); });
    es.addEventListener('version', soon);
    es.addEventListener('sos', soon);
    es.addEventListener('access', function (e) {
      var d = {}; try { d = JSON.parse(e.data); } catch (x) { /* */ }
      if (d.name) { beep(); UI.toast('👥 Access request from ' + d.name + ' (' + d.email + ')', 'danger', 8000); }
      soon();
    });
    es.onerror = function () { setNet(false); };
  }

  // ------------------------------------------------------------ alerting on new SOS
  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      var ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination); o.start();
      setTimeout(function () { o.frequency.value = 660; }, 180);
      setTimeout(function () { o.stop(); ctx.close(); }, 420);
    } catch (e) { /* autoplay blocked */ }
  }
  function checkNewSos() {
    var fresh = overview.sos.filter(function (s) { return !seenSos[s.id]; });
    overview.sos.forEach(function (s) { seenSos[s.id] = seenSos[s.id] || (firstLoad ? 'old' : 'new'); });
    if (!firstLoad && fresh.length) { beep(); UI.toast('🆘 New SOS request (' + fresh.length + ')', 'danger', 6000); }
    var urgent = state.reports.filter(function (r) { return r.urgent && r.status === 'unverified' && !seenSos['r-' + r.id]; });
    urgent.forEach(function (r) { if (!firstLoad) { beep(); UI.toast('🆘 Urgent report: ' + T('rpt.' + r.type), 'danger', 6000); } seenSos['r-' + r.id] = 1; });
    firstLoad = false;
  }

  // ------------------------------------------------------------ stats
  function renderStats() {
    var s = overview.stats;
    var activeAlerts = state.alerts.filter(function (a) { return a.msgType !== 'Cancel' && Date.parse(a.expires) > Date.now(); }).length;
    UI.mount('stats',
      stat('Open SOS', s.sosOpen, s.sosOpen > 0),
      stat('Unverified reports', s.reportsUnverified, false),
      stat('Active alerts', activeAlerts, false),
      stat('Live devices', s.liveClients, false),
      stat('Scenario', state.scenario, false),
      overview.simulation.running || state.scenario === 'simulation' ? stat('Simulation', 'step ' + overview.simulation.step + '/' + overview.simulation.total, false) : null);
    document.getElementById('sos-count').textContent = s.sosOpen || '';
    document.getElementById('rep-count').textContent = s.reportsUnverified || '';
    document.getElementById('host-count').textContent = s.accessRequests || '';
  }
  function stat(label, val, hot) { return h('div', { class: 'stat' + (hot ? ' hot' : '') }, h('b', { text: String(val) }), h('span', { class: 'muted small', text: label })); }

  // ------------------------------------------------------------ map + drawing
  var draw = null; // { mode, pts, cb, layer }
  function initMap() {
    if (map) return;
    map = L.map('map').setView([13.03, 80.235], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, crossOrigin: true, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    ['alerts', 'zones', 'closures', 'shelters', 'reports', 'sos', 'draw'].forEach(function (k) { layers[k] = L.layerGroup().addTo(map); });
    map.on('click', function (e) {
      if (!draw) return;
      draw.pts.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
      if (draw.mode === 'point') return finishDraw();
      renderDraw();
    });
  }

  function startDraw(mode, cb) {
    draw = { mode: mode, pts: [], cb: cb };
    var hint = mode === 'polygon' ? 'Click the map to add polygon corners (min 3).' : mode === 'line' ? 'Click the map along the closed road (min 2 points).' : 'Click the map to choose the centre.';
    var bar = document.getElementById('drawbar');
    bar.hidden = false;
    UI.mount(bar, h('strong', { text: '✏️ ' + hint }),
      h('button', { class: 'btn small', text: 'Undo', onclick: function () { draw.pts.pop(); renderDraw(); } }),
      mode !== 'point' ? h('button', { class: 'btn small primary', text: 'Finish', onclick: finishDraw }) : null,
      h('button', { class: 'btn small ghost', text: 'Cancel', onclick: cancelDraw }));
    map.getContainer().classList.add('picking');
    map.closePopup();
    if (draw.removeCatcher) draw.removeCatcher();
    draw.removeCatcher = UI.clickCatcher(map, function (ll) {
      if (!draw) return;
      draw.pts.push([+ll.lat.toFixed(6), +ll.lng.toFixed(6)]);
      if (draw.mode === 'point') return finishDraw();
      renderDraw();
    });
    renderDraw();
  }
  function renderDraw() {
    layers.draw.clearLayers();
    if (!draw) return;
    draw.pts.forEach(function (p) { L.circleMarker(p, { radius: 5, color: '#f08c00' }).addTo(layers.draw); });
    if (draw.pts.length > 1) (draw.mode === 'polygon' ? L.polygon : L.polyline)(draw.pts, { color: '#f08c00', dashArray: '4 4' }).addTo(layers.draw);
  }
  function finishDraw() {
    if (!draw) return;
    var need = draw.mode === 'polygon' ? 3 : draw.mode === 'line' ? 2 : 1;
    if (draw.pts.length < need) { UI.toast('Need at least ' + need + ' point(s)', 'warn'); return; }
    var d = draw; cancelDraw(); d.cb(d.mode === 'point' ? d.pts[0] : d.pts);
  }
  function cancelDraw() {
    if (draw && draw.removeCatcher) draw.removeCatcher();
    draw = null; layers.draw.clearLayers();
    document.getElementById('drawbar').hidden = true;
    map.getContainer().classList.remove('picking');
  }

  function pop(title, lines) {
    var b = h('div', { class: 'pop' }, h('strong', { text: title }));
    lines.forEach(function (l) { if (l) b.appendChild(h('div', { class: 'muted', text: l })); });
    return b;
  }
  function icon(html, cls, size) { return L.divIcon({ html: html, className: 'sg-icon ' + cls, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }); }

  function renderMap() {
    if (!map || !state) return;
    Object.keys(layers).forEach(function (k) { if (k !== 'draw') layers[k].clearLayers(); });
    var SEV = { Minor: '#f59f00', Moderate: '#f76707', Severe: '#e03131', Extreme: '#862e9c' };
    state.alerts.forEach(function (a) {
      if (a.msgType === 'Cancel' || !a.area) return;
      L.polygon(a.area.polygon, { color: SEV[a.severity], dashArray: '6 6', weight: 2, fillOpacity: 0.03 }).bindPopup(pop(T('ev.' + a.event) + ' · ' + a.severity, [a.area.name, a.headline])).addTo(layers.alerts);
    });
    var ZC = { flooded: '#1d6fd8', unsafe: '#d9480f', safe: '#2b8a3e' };
    state.zones.forEach(function (z) { L.polygon(z.polygon, { color: ZC[z.kind], fillOpacity: 0.3, weight: 2 }).bindPopup(pop(T('zone.' + z.kind), [z.name])).addTo(layers.zones); });
    state.closures.forEach(function (c) { L.polyline(c.path, { color: '#e03131', weight: 7, dashArray: '2 10' }).bindPopup(pop('Road closed', [c.name])).addTo(layers.closures); });
    state.shelters.forEach(function (s) { L.marker([s.lat, s.lng], { icon: icon('⛺', 'shelter ' + s.status, 30) }).bindPopup(pop(s.name, [s.status + ' · ' + s.occupancy + '/' + s.capacity])).addTo(layers.shelters); });
    var RI = { flooding: '🌊', road_blocked: '🚧', power_line: '⚡', trapped: '🆘', injury: '🩹', building_damage: '🏚️', other: '⚠️' };
    state.reports.forEach(function (r) { if (r.status !== 'false' && r.status !== 'resolved') L.marker([r.lat, r.lng], { icon: icon(RI[r.type], 'rep ' + r.status, 26) }).bindPopup(pop(T('rpt.' + r.type) + ' (' + r.status + ')', [r.note, r.confirmations + ' confirmations'])).addTo(layers.reports); });
    overview.sos.forEach(function (s) {
      if (s.status === 'resolved' || s.lat == null) return;
      L.marker([s.lat, s.lng], { icon: icon('SOS', 'sos', 36), zIndexOffset: 2000 }).bindPopup(pop('🆘 ' + T('sit.' + s.situation) + ' · ' + s.people + ' people', [s.status, s.note, s.phone ? '☎ ' + s.phone : null])).addTo(layers.sos);
    });
  }

  // ------------------------------------------------------------ panels
  document.getElementById('ptabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-p]'); if (!b) return;
    panel = b.getAttribute('data-p');
    Array.prototype.forEach.call(document.querySelectorAll('#ptabs button'), function (x) { x.classList.toggle('active', x === b); });
    renderPanel();
  });

  function renderPanel() {
    if (!state || !overview) return;
    if (panel === 'hosts') return pHosts();
    var fn = { sos: pSos, reports: pReports, alert: pAlert, zones: pZones, shelters: pShelters, rumors: pRumors, sms: pSms, sim: pSim }[panel];
    // Don't wipe a form the official is typing into on every live update.
    var active = document.activeElement;
    if (active && document.getElementById('panel').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && (panel === 'alert' || panel === 'zones' || panel === 'rumors' || panel === 'sms')) return;
    UI.mount('panel', fn());
  }

  function age(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; return Math.round(s / 3600) + ' h ago';
  }
  function field(label, el) { return h('label', { class: 'field-label' }, label, el); }
  function select(options, value, onchange) {
    return h('select', { class: 'input', onchange: onchange }, options.map(function (o) {
      var v = typeof o === 'string' ? o : o[0], l = typeof o === 'string' ? o : o[1];
      return h('option', { value: v, text: l, selected: v === value });
    }));
  }

  // ---- SOS
  function pSos() {
    var list = overview.sos;
    if (!list.length) return h('div', { class: 'card muted', text: 'No SOS requests yet. They arrive here from the app (internet), the SMS gateway and QR relays — de-duplicated by request ID.' });
    return list.map(function (s) {
      var eta = h('input', { class: 'input', type: 'number', min: 1, max: 600, value: s.etaMin || 20, style: 'max-width:90px' });
      return h('div', { class: 'card sos-item ' + s.status + (seenSos[s.id] === 'new' && s.status === 'new' ? ' fresh' : '') },
        h('div', { class: 'row-between' }, h('strong', { text: '🆘 ' + T('sit.' + s.situation) + ' · ' + s.people + (s.people > 1 ? ' people' : ' person') }), h('span', { class: 'badge ' + (s.status === 'resolved' ? 'open' : s.status === 'new' ? 'closed' : 'warn'), text: s.status })),
        h('div', { class: 'kv' },
          h('span', { text: 'ID ' + s.id }), h('span', { text: age(s.receivedAt) }),
          h('span', { text: 'via ' + (s.channels || [s.via]).join(' + ') }),
          h('span', { text: 'lang ' + I18N.langInfo(s.lang).name }),
          s.lat != null ? h('span', { text: s.lat.toFixed(5) + ', ' + s.lng.toFixed(5) + (s.accuracy ? ' ±' + Math.round(s.accuracy) + 'm' : '') }) : h('span', { class: 'warn-text', text: 'no location — call back' })),
        s.note ? h('div', { class: 'claim', text: s.note }) : null,
        h('div', { class: 'btn-row' },
          s.lat != null ? h('button', { class: 'btn small', text: '🗺️ Show', onclick: function () { map.setView([s.lat, s.lng], 16); } }) : null,
          s.phone ? h('a', { class: 'btn small', text: '☎ ' + s.phone, attrs: { href: 'tel:' + s.phone } }) : null,
          s.status === 'new' ? h('button', { class: 'btn small', text: '👁 Acknowledge', onclick: function () { act(api('PATCH', '/api/admin/sos/' + s.id, { status: 'ack' }), 'Acknowledged'); } }) : null,
          s.status !== 'resolved' ? h('span', { class: 'inline' }, eta, h('button', { class: 'btn small primary', text: '🚑 Dispatch (min)', onclick: function () { act(api('PATCH', '/api/admin/sos/' + s.id, { status: 'dispatched', etaMin: Number(eta.value) || 20 }), 'Team dispatched'); } })) : null,
          s.status !== 'resolved' ? h('button', { class: 'btn small', text: '✓ Resolve', onclick: function () { act(api('PATCH', '/api/admin/sos/' + s.id, { status: 'resolved' }), 'Resolved'); } }) : null));
    });
  }

  // ---- Reports
  function pReports() {
    var list = state.reports.slice().sort(function (a, b) {
      var o = { unverified: 0, verified: 1, false: 2, resolved: 3 };
      return (o[a.status] - o[b.status]) || ((b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)) || (Date.parse(b.createdAt) - Date.parse(a.createdAt));
    });
    if (!list.length) return h('div', { class: 'card muted', text: 'No reports.' });
    return [h('p', { class: 'fineprint', text: 'Travellers see unverified reports labelled "Not checked by officials". Verifying a flooding report can also draw a 150 m flooded zone that every phone uses for its risk check.' })].concat(list.map(function (r) {
      return h('div', { class: 'card report ' + r.status },
        h('div', { class: 'row-between' }, h('strong', { text: (r.urgent ? '🆘 ' : '') + T('rpt.' + r.type) }), h('span', { class: 'rep-status ' + r.status, text: r.status })),
        r.note ? h('div', { class: 'claim', text: r.note }) : null,
        h('div', { class: 'kv' }, h('span', { text: age(r.createdAt) }), h('span', { text: 'via ' + r.via }), h('span', { text: r.confirmations + ' confirmations' }), r.people ? h('span', { text: r.people + ' people' }) : null),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', text: '🗺️ Show', onclick: function () { map.setView([r.lat, r.lng], 16); } }),
          r.status !== 'verified' ? h('button', { class: 'btn small', text: '✔ Verify', onclick: function () { act(api('PATCH', '/api/admin/reports/' + r.id, { status: 'verified' }), 'Verified'); } }) : null,
          r.status !== 'verified' && (r.type === 'flooding' || r.type === 'power_line' || r.type === 'building_damage') ? h('button', { class: 'btn small primary', text: '✔ Verify + mark zone', onclick: function () { act(api('PATCH', '/api/admin/reports/' + r.id, { status: 'verified', promote: true }), 'Verified and zone added'); } }) : null,
          r.status !== 'false' ? h('button', { class: 'btn small', text: '✖ False', onclick: function () { act(api('PATCH', '/api/admin/reports/' + r.id, { status: 'false' }), 'Marked false'); } }) : null,
          r.status !== 'resolved' ? h('button', { class: 'btn small ghost', text: 'Resolved', onclick: function () { act(api('PATCH', '/api/admin/reports/' + r.id, { status: 'resolved' }), 'Resolved'); } }) : null));
    }));
  }

  // ---- Publish alert
  function newDraft() {
    return { id: null, event: 'flood', severity: 'Severe', source: 'Disaster control room (demo)', originalLang: 'en', headline: '', description: '', instructions: ['move_higher', 'avoid_water'], areaName: '', polygon: null, expiresInHours: 12 };
  }
  function pAlert() {
    if (!alertDraft) alertDraft = newDraft();
    var d = alertDraft;
    var preview = h('div', { class: 'preview' });
    function renderPreview() {
      var tr = I18N.translateAlert({ event: d.event, severity: d.severity, instructions: d.instructions }, previewLang);
      UI.mount(preview,
        h('div', { class: 'inline' }, h('strong', { text: 'Traveller preview:' }), select(I18N.LANGS.map(function (l) { return [l.code, l.name]; }), previewLang, function (e) { previewLang = e.target.value; renderPreview(); })),
        h('div', { attrs: { dir: I18N.langInfo(previewLang).dir, lang: previewLang } },
          h('div', { class: 'alert-title', text: tr.event + ' · ' + tr.severity }),
          h('ul', null, tr.instructions.map(function (x) { return h('li', { text: x }); }))),
        h('div', { class: 'fineprint', text: 'Only the fixed instructions are translated (pre-translated, reviewed vocabulary). Your headline and description are shown to travellers exactly as written, labelled as the original official text.' }));
    }
    var checks = h('div', { class: 'checks' }, VOC.instructions.map(function (k) {
      return h('label', null, h('input', { type: 'checkbox', checked: d.instructions.indexOf(k) >= 0, onchange: function (e) {
        if (e.target.checked) { if (d.instructions.indexOf(k) < 0) d.instructions.push(k); } else d.instructions = d.instructions.filter(function (x) { return x !== k; });
        renderPreview();
      } }), h('span', { text: T('ins.' + k) }));
    }));
    var presets = [['', '— choose area —']].concat(state.alerts.filter(function (a) { return a.area; }).map(function (a) { return ['a:' + a.id, 'Area of: ' + a.area.name]; }))
      .concat(state.zones.map(function (z) { return ['z:' + z.id, 'Zone: ' + z.name]; }));
    var areaStatus = h('div', { class: d.polygon ? 'ok-text' : 'warn-text', text: d.polygon ? '✓ Area set (' + d.polygon.length + ' points)' : 'No area yet' });
    renderPreview();
    var existing = state.alerts.slice().reverse().map(function (a) {
      return h('div', { class: 'card alert sev-' + a.severity + (a.msgType === 'Cancel' ? ' cancelled' : '') },
        h('div', { class: 'row-between' }, h('strong', { text: T('ev.' + a.event) + ' · ' + a.severity + ' · ' + a.msgType + ' r' + a.revision }), h('span', { class: 'muted small', text: age(a.updatedAt) })),
        h('div', { class: 'small', attrs: { lang: a.originalLang }, text: a.headline }),
        h('div', { class: 'muted small', text: a.area ? a.area.name : '' }),
        a.msgType !== 'Cancel' ? h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', text: '✏️ Update', onclick: function () {
            alertDraft = { id: a.id, event: a.event, severity: a.severity, source: a.source, originalLang: a.originalLang, headline: a.headline, description: a.description, instructions: a.instructions.slice(), areaName: a.area.name, polygon: a.area.polygon, expiresInHours: 12 };
            renderPanelForce();
          } }),
          h('button', { class: 'btn small', text: '🛑 Cancel alert (all clear)', onclick: function () { act(api('POST', '/api/admin/alerts/' + a.id + '/cancel'), 'Alert cancelled'); } })) : null);
    });
    return [
      h('div', { class: 'card' },
        h('h3', { text: d.id ? '✏️ Update alert ' + d.id : '📢 New alert' }),
        h('div', { class: 'grid2' },
          field('Hazard', select(VOC.events.map(function (e) { return [e, T('ev.' + e)]; }), d.event, function (e) { d.event = e.target.value; renderPreview(); })),
          field('Severity', select(VOC.severities, d.severity, function (e) { d.severity = e.target.value; renderPreview(); })),
          field('Source', h('input', { class: 'input', value: d.source, maxLength: 120, oninput: function (e) { d.source = e.target.value; } })),
          field('Language of your text', select(I18N.LANGS.map(function (l) { return [l.code, l.name]; }), d.originalLang, function (e) { d.originalLang = e.target.value; }))),
        field('Headline (shown verbatim)', h('input', { class: 'input', value: d.headline, maxLength: 200, oninput: function (e) { d.headline = e.target.value; } })),
        field('Description (shown verbatim)', h('textarea', { class: 'input', value: d.description, maxLength: 1500, oninput: function (e) { d.description = e.target.value; } })),
        h('div', { class: 'field-label', text: 'Instructions (translated into every language)' }), checks,
        h('div', { class: 'grid2' },
          field('Area name', h('input', { class: 'input', value: d.areaName, maxLength: 120, oninput: function (e) { d.areaName = e.target.value; } })),
          field('Expires in (hours)', h('input', { class: 'input', type: 'number', min: 0.25, max: 168, step: 0.25, value: d.expiresInHours, oninput: function (e) { d.expiresInHours = Number(e.target.value); } }))),
        h('div', { class: 'inline', style: 'margin-top:8px' },
          select(presets, '', function (e) {
            var v = e.target.value; if (!v) return;
            var src = v[0] === 'a' ? state.alerts.filter(function (a) { return 'a:' + a.id === v; })[0].area : state.zones.filter(function (z) { return 'z:' + z.id === v; })[0];
            d.polygon = src.polygon; if (!d.areaName) d.areaName = src.name; renderPanelForce();
          }),
          h('button', { class: 'btn small', text: '✏️ Draw area', onclick: function () { startDraw('polygon', function (pts) { d.polygon = pts; renderPanelForce(); }); } })),
        areaStatus,
        preview,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', text: d.id ? 'Publish update' : 'Publish alert', onclick: publishAlert }),
          h('button', { class: 'btn ghost', text: 'Clear form', onclick: function () { alertDraft = newDraft(); renderPanelForce(); } }))),
      h('h3', { class: 'section-title', text: 'Current alerts' })
    ].concat(existing);
  }
  function publishAlert() {
    var d = alertDraft;
    if (!d.polygon) { UI.toast('Choose or draw the alert area first', 'warn'); return; }
    act(api('POST', '/api/admin/alerts', {
      id: d.id || undefined, event: d.event, severity: d.severity, source: d.source, originalLang: d.originalLang,
      headline: d.headline, description: d.description, instructions: d.instructions,
      area: { name: d.areaName || 'Affected area', polygon: d.polygon }, expiresInHours: d.expiresInHours
    }), d.id ? 'Alert updated — phones notified' : 'Alert published — phones notified').then(function (ok) { if (ok) { alertDraft = newDraft(); renderPanelForce(); } });
  }
  function renderPanelForce() { if (panel === 'hosts') return pHosts(); UI.mount('panel', ({ sos: pSos, reports: pReports, alert: pAlert, zones: pZones, shelters: pShelters, rumors: pRumors, sms: pSms, sim: pSim })[panel]()); }

  // ---- Zones & roads
  var zoneDraft = { kind: 'flooded', name: '', radius: 0.3 };
  function pZones() {
    var name = h('input', { class: 'input', value: zoneDraft.name, maxLength: 120, attrs: { placeholder: 'e.g. Adyar riverbank, Kotturpuram' }, oninput: function (e) { zoneDraft.name = e.target.value; } });
    var radius = h('input', { class: 'input', type: 'number', step: 0.05, min: 0.02, max: 20, value: zoneDraft.radius, oninput: function (e) { zoneDraft.radius = Number(e.target.value); } });
    var roadName = h('input', { class: 'input', maxLength: 120, attrs: { placeholder: 'e.g. Kathipara underpass' } });
    function needName(v) { if (!v || v.trim().length < 2) { UI.toast('Enter a name first', 'warn'); return false; } return true; }
    return [
      h('div', { class: 'card' }, h('h3', { text: 'Add danger / safe zone' }),
        h('div', { class: 'grid2' }, field('Kind', select(VOC.zoneKinds.map(function (k) { return [k, T('zone.' + k)]; }), zoneDraft.kind, function (e) { zoneDraft.kind = e.target.value; })), field('Circle radius (km)', radius)),
        field('Name', name),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', text: '✏️ Draw polygon', onclick: function () { if (needName(zoneDraft.name)) startDraw('polygon', function (pts) { act(api('POST', '/api/admin/zones', { kind: zoneDraft.kind, name: zoneDraft.name, polygon: pts }), 'Zone added').then(function (ok) { if (ok) zoneDraft.name = ''; }); }); } }),
          h('button', { class: 'btn', text: '⭕ Circle (click centre)', onclick: function () { if (needName(zoneDraft.name)) startDraw('point', function (c) { act(api('POST', '/api/admin/zones', { kind: zoneDraft.kind, name: zoneDraft.name, center: c, radiusKm: zoneDraft.radius }), 'Zone added').then(function () { zoneDraft.name = ''; }); }); } }))),
      h('div', { class: 'card' }, h('h3', { text: 'Zones (' + state.zones.length + ')' }), state.zones.map(function (z) {
        return h('div', { class: 'list-row' }, h('span', { text: T('zone.' + z.kind) + ' — ' + z.name }), h('span', { class: 'inline' },
          h('button', { class: 'btn small', text: '🗺️', onclick: function () { map.fitBounds(L.polygon(z.polygon).getBounds()); } }),
          h('button', { class: 'btn small', text: '🗑', onclick: function () { act(api('DELETE', '/api/admin/zones/' + z.id), 'Zone removed'); } })));
      })),
      h('div', { class: 'card' }, h('h3', { text: 'Close a road' }), field('Road name', roadName),
        h('button', { class: 'btn', text: '✏️ Draw closed road', onclick: function () { var n = roadName.value; if (needName(n)) startDraw('line', function (pts) { act(api('POST', '/api/admin/closures', { name: n, path: pts }), 'Road closure added'); }); } }),
        state.closures.map(function (c) {
          return h('div', { class: 'list-row' }, h('span', { text: '⛔ ' + c.name }), h('button', { class: 'btn small', text: 'Reopen', onclick: function () { act(api('DELETE', '/api/admin/closures/' + c.id), 'Road reopened'); } }));
        }))
    ];
  }

  // ---- Shelters & transport
  function pShelters() {
    return [
      h('div', { class: 'card' }, h('h3', { text: 'Shelters' }), state.shelters.map(function (s) {
        var occ = h('input', { class: 'input', type: 'number', min: 0, max: 100000, value: s.occupancy, style: 'max-width:100px' });
        return h('div', { class: 'list-row' },
          h('div', null, h('strong', { text: s.name }), h('div', { class: 'muted small', text: 'capacity ' + s.capacity + (s.stepFree ? ' · step-free' : '') })),
          h('div', { class: 'inline' },
            select(VOC.shelterStatus, s.status, function (e) { act(api('PATCH', '/api/admin/shelters/' + s.id, { status: e.target.value }), 'Shelter updated'); }),
            occ, h('button', { class: 'btn small', text: 'Save', onclick: function () { act(api('PATCH', '/api/admin/shelters/' + s.id, { occupancy: Number(occ.value) }), 'Occupancy saved'); } })));
      })),
      h('div', { class: 'card' }, h('h3', { text: 'Transport' }), state.transport.map(function (x) {
        return h('div', { class: 'list-row' }, h('span', { text: x.name }), select(VOC.transportStatus, x.status, function (e) { act(api('PATCH', '/api/admin/transport/' + x.id, { status: e.target.value }), 'Transport updated'); }));
      }))
    ];
  }

  // ---- Rumors
  function pRumors() {
    var topic = select(VOC.rumorTopics.map(function (k) { return [k, T('rt.' + k)]; }), 'dam_burst');
    var verdict = select(VOC.rumorVerdicts.map(function (k) { return [k, T('rumor.' + k)]; }), 'false');
    var claim = h('textarea', { class: 'input', maxLength: 300, attrs: { placeholder: 'Paste the forwarded message / claim' } });
    return [
      h('div', { class: 'card' }, h('h3', { text: 'Add rumor verdict' }),
        h('div', { class: 'grid2' }, field('Topic (translated)', topic), field('Verdict (translated)', verdict)),
        field('Claim (shown verbatim)', claim),
        h('button', { class: 'btn primary', text: 'Publish verdict', onclick: function () { act(api('POST', '/api/admin/rumors', { topic: topic.value, verdict: verdict.value, claim: claim.value }), 'Verdict published'); } })),
      h('div', { class: 'card' }, state.rumors.slice().reverse().map(function (r) {
        return h('div', { class: 'list-row' }, h('div', null, h('strong', { text: T('rumor.' + r.verdict) + ' · ' + T('rt.' + r.topic) }), h('div', { class: 'claim', text: r.claim })),
          h('button', { class: 'btn small', text: '🗑', onclick: function () { act(api('DELETE', '/api/admin/rumors/' + r.id), 'Removed'); } }));
      }))
    ];
  }

  // ---- SMS gateway
  function pSms() {
    var from = h('input', { class: 'input', value: '+91 98400 00000', maxLength: 32 });
    var body = h('textarea', { class: 'input', value: 'SOS 13.04001,80.23370 P:2 S:TRAP L:fr ID:demo' + Math.floor(Math.random() * 1e6) + ' water rising' });
    var out = h('div', { class: 'preview', hidden: !lastSms });
    if (lastSms) renderSmsResult(out, lastSms);
    var base = location.origin;
    return h('div', { class: 'card' },
      h('h3', { text: 'SMS gateway' }),
      h('p', { class: 'small', text: 'When a traveller has mobile signal but no internet, the app pre-fills a short coded SMS. In production an SMS gateway (e.g. Twilio) forwards it to this webhook:' }),
      h('code', { text: base + '/api/sms/inbound' }),
      h('p', { class: 'small muted', text: 'Set TWILIO_AUTH_TOKEN to enforce request signatures. Number shown to travellers: ' + (overview.config.smsNumber || '(not set — the app lets the user choose a recipient, e.g. a family member)') }),
      h('h3', { text: 'Test: paste a received SMS' }),
      field('From', from), field('Message', body),
      h('button', { class: 'btn primary', text: 'Process SMS', onclick: function () {
        api('POST', '/api/admin/sms-sim', { from: from.value, body: body.value }).then(function (d) {
          lastSms = d;
          out.hidden = false;
          renderSmsResult(out, d);
          reload();
        }).catch(function (e) { UI.toast(e.message, 'danger'); });
      } }),
      out);
  }

  var lastSms = null;
  function renderSmsResult(out, d) {
    UI.mount(out, h('strong', { text: d.ok ? '✅ Parsed as ' + d.parsed.kind : '❌ Not understood (' + (d.parsed && d.parsed.error) + ')' }),
      h('pre', { class: 'small', style: 'white-space:pre-wrap', text: JSON.stringify(d.parsed && d.parsed.data, null, 1) }),
      h('div', { class: 'small', attrs: { dir: 'auto' }, text: 'Auto-reply SMS: ' + d.reply }));
  }

  // ---- Simulation
  function pSim() {
    var sim = overview.simulation;
    var interval = h('input', { class: 'input', type: 'number', min: 3, max: 300, value: sim.intervalSec || 12, style: 'max-width:90px' });
    return h('div', { class: 'card' },
      h('h3', { text: '🎬 Storm simulation' }),
      h('p', { class: 'small', text: 'Replays a scripted Chennai storm so judges can watch phones update live. Starts from a calm city.' }),
      h('ol', { class: 'tl' }, sim.labels.map(function (l, i) { return h('li', { class: i < sim.step ? 'done' : i === sim.step ? 'next' : '', text: l }); })),
      h('div', { class: 'btn-row' },
        h('span', { class: 'inline' }, interval, h('button', { class: 'btn primary', text: '▶ Auto (seconds/step)', onclick: function () { act(api('POST', '/api/admin/simulate', { action: 'start', intervalSec: Number(interval.value) || 12 }), 'Simulation started'); } })),
        h('button', { class: 'btn', text: '⏮ Start manual', onclick: function () { act(api('POST', '/api/admin/simulate', { action: 'start', manual: true }), 'Calm city loaded'); } }),
        h('button', { class: 'btn', text: '⏭ Next step', onclick: function () { act(api('POST', '/api/admin/simulate', { action: 'next' }), 'Step applied'); } }),
        h('button', { class: 'btn ghost', text: '⏸ Stop', onclick: function () { act(api('POST', '/api/admin/simulate', { action: 'stop' }), 'Stopped'); } })),
      h('h3', { text: 'Reset', style: 'margin-top:14px' }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: '🌊 Full flood scenario', onclick: function () { if (confirmReset()) act(api('POST', '/api/admin/reset', { scenario: 'chennai-flood' }), 'Scenario reset'); } }),
        h('button', { class: 'btn', text: '☀️ Calm city', onclick: function () { if (confirmReset()) act(api('POST', '/api/admin/reset', { scenario: 'chennai-calm' }), 'Calm city loaded'); } })),
      h('p', { class: 'fineprint', text: 'Reset clears SOS requests and reports too.' }));
  }
  // ---- Hosts (who may use the control room)
  function pHosts() {
    api('GET', '/api/admin/hosts').then(function (d) {
      if (panel !== 'hosts') return;
      UI.mount('panel',
        h('div', { class: 'card' }, h('h3', { text: '👥 Access requests (' + d.requests.length + ')' }),
          d.requests.length ? d.requests.map(function (r) {
            return h('div', { class: 'list-row' },
              h('div', null, h('strong', { text: r.name }), h('div', { class: 'muted small', text: r.email + ' · ' + age(r.createdAt) }), r.reason ? h('div', { class: 'claim', text: r.reason }) : null),
              h('div', { class: 'inline' },
                h('button', { class: 'btn small primary', text: '✔ Approve', onclick: function () { act(api('POST', '/api/admin/requests/' + r.id, { action: 'approve' }), r.email + ' is now a host').then(pHosts); } }),
                h('button', { class: 'btn small', text: '✖ Reject', onclick: function () { act(api('POST', '/api/admin/requests/' + r.id, { action: 'reject' }), 'Request rejected').then(pHosts); } })));
          }) : h('div', { class: 'muted', text: 'No pending requests. People can ask for access from the login page.' })),
        h('div', { class: 'card' }, h('h3', { text: 'Current hosts (' + d.hosts.length + ')' }),
          d.hosts.map(function (x) {
            return h('div', { class: 'list-row' },
              h('div', null, h('strong', { text: x.email + (x.email === d.me ? ' (you)' : '') }), h('div', { class: 'muted small', text: x.founder ? 'Founding host' : 'Added by ' + x.addedBy + ' · ' + age(x.addedAt) })),
              !x.founder ? h('button', { class: 'btn small', text: 'Remove', onclick: function () { if (window.confirm('Remove ' + x.email + ' as host?')) act(api('DELETE', '/api/admin/hosts/' + encodeURIComponent(x.email)), 'Host removed').then(pHosts); } }) : null);
          })));
    }).catch(function (e) { UI.toast('❌ ' + e.message, 'danger'); });
    return null;
  }

  function confirmReset() { return window.confirm('Reset all data to the selected scenario?'); }

  // ------------------------------------------------------------ boot
  if (token) start(); else showLogin();
  setInterval(function () { if (token && panel === 'sos') renderPanel(); }, 30000); // refresh "x min ago"
})();
