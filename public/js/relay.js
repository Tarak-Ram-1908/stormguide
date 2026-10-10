/*
 * QR relay page. A person with no signal shows a QR code; anyone nearby with
 * internet scans it with their camera, this page opens and forwards the SOS or
 * report. If the relayer is offline too, it is stored in their outbox and sent
 * later (store-carry-forward).
 */
/* global UI, I18N, OutboxDB */
(function () {
  'use strict';
  var h = UI.h;
  var lang = I18N.detect(navigator.languages || [navigator.language]);
  var t = function (k, v) { return I18N.t(lang, k, v); };
  document.documentElement.lang = lang;
  document.documentElement.dir = I18N.langInfo(lang).dir;

  var payload = null;
  try { payload = UI.b64decode((location.hash || '').slice(1)); } catch (e) { payload = null; }

  function valid(p) {
    if (!p || (p.k !== 'sos' && p.k !== 'report') || !p.d || typeof p.d !== 'object') return false;
    var d = p.d;
    if (typeof d.id !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(d.id)) return false;
    if (d.lat != null && (typeof d.lat !== 'number' || Math.abs(d.lat) > 90)) return false;
    if (d.lng != null && (typeof d.lng !== 'number' || Math.abs(d.lng) > 180)) return false;
    if (p.k === 'report' && (d.lat == null || I18N.VOCAB.reportTypes.indexOf(d.type) < 0)) return false;
    return true;
  }

  if (!valid(payload)) {
    UI.mount('relay', h('div', { class: 'card warn' }, h('h2', { text: '⚠️ ' + t('relay.bad') })));
    return;
  }
  var d = payload.d, kind = payload.k;
  var status = h('div', { class: 'server-status', text: '…' });
  status.hidden = true;

  function send() {
    var url = '/api/relay';
    var item = { id: 'relay-' + d.id, kind: 'relay', url: url, body: { kind: kind, data: d }, status: 'queued', attempts: 0, createdAt: Date.now() };
    btn.disabled = true;
    OutboxDB.put(item).then(function () { return OutboxDB.flush(); }).then(function () { return OutboxDB.get(item.id); }).then(function (x) {
      status.hidden = false;
      if (x && x.status === 'sent') { status.className = 'server-status'; status.textContent = '✅ ' + t('relay.sent'); btn.hidden = true; }
      else if (x && x.status === 'failed') { status.className = 'server-status warn-text'; status.textContent = '❌ ' + (x.lastError || t('rep.failed')); btn.disabled = false; }
      else {
        status.className = 'server-status warn-text'; status.textContent = '💾 ' + t('relay.saved'); btn.disabled = false;
        if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(function (r) { if (r.sync) r.sync.register('sg-outbox'); }).catch(function () {});
      }
    });
  }

  var btn = h('button', { class: 'btn primary block', text: '📡 ' + t('relay.send'), onclick: send });
  var what = kind === 'sos' ? '🆘 SOS · ' + t('sit.' + (d.situation || 'other')) + ' · ' + t('sos.people') + ': ' + (d.people || 1)
    : '📣 ' + t('rpt.' + d.type);
  UI.mount('relay', h('div', { class: 'card' },
    h('h2', { text: t('relay.title') }),
    h('p', { text: t('relay.desc') }),
    h('div', { class: 'card ' + (kind === 'sos' ? 'risk inside' : '') },
      h('strong', { text: what }),
      d.lat != null ? h('div', { class: 'muted', text: '📍 ' + d.lat.toFixed(5) + ', ' + d.lng.toFixed(5) }) : null,
      d.note ? h('div', { class: 'claim', text: String(d.note).slice(0, 120) }) : null,
      h('div', { class: 'muted small', text: 'ID ' + d.id })),
    btn, status,
    kind === 'sos' ? h('a', { class: 'btn danger block', text: '📞 ' + t('sos.call'), attrs: { href: 'tel:112' } }) : null));

  window.addEventListener('online', function () { if (!btn.hidden) send(); });
  send(); // scanning the code is the intent to help: forward straight away
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
