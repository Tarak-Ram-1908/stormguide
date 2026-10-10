/*
 * StormGuide traveller app: UI for status, map, SOS, reports and tools.
 */
/* global SG, UI, I18N, Geo, SGMap, SmsCode, OutboxDB */
(function () {
  'use strict';
  var h = UI.h, t = function (k, v) { return SG.t(k, v); };
  var currentView = 'status';
  var REPORT_ICON = { flooding: '🌊', road_blocked: '🚧', power_line: '⚡', trapped: '🆘', injury: '🩹', building_damage: '🏚️', other: '⚠️' };
  var SIT_ICON = { trapped: '🧱', injured: '🩹', water_rising: '🌊', medical: '💊', other: '❗' };
  var MODE_ICON = { metro: '🚇', train: '🚆', bus: '🚌', airport: '✈️' };
  var EVENT_ICON = { heavy_rain: '🌧️', flood: '🌊', cyclone: '🌀', storm_surge: '🌊', heatwave: '🌡️', landslide: '⛰️' };
  var HOTLINES = ['112', '108', '1070', '1913', '1363'];

  // ------------------------------------------------------------ language
  function applyLang() {
    var lang = SG.lang(), info = I18N.langInfo(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = info.dir;
    document.getElementById('lang-code').textContent = lang.toUpperCase();
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
    document.title = t('app.name') + ' — ' + t('app.tagline');
  }

  function langPicker(first) {
    var list = h('div', { class: 'lang-list' }, I18N.LANGS.map(function (l) {
      return h('button', {
        class: 'lang-option' + (l.code === SG.lang() ? ' selected' : ''), attrs: { lang: l.code, dir: l.dir },
        onclick: function () { SG.prefs.lang = l.code; SG.savePrefs(); UI.closeModal(); applyLang(); renderAll(); if (first) askLocation(); }
      }, h('span', { class: 'lang-name', text: l.name }), h('span', { class: 'muted', text: I18N.t(l.code, 'app.tagline') }));
    }));
    UI.modal([h('h2', { text: '🌐 ' + t('lang.choose') }), list], { sticky: first });
  }

  // ------------------------------------------------------------ navigation
  function show(view) {
    currentView = view;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (view === 'map') { SGMap.init(document.getElementById('map')); SGMap.invalidate(); renderMapTools(); }
    if (view === 'report') renderReports();
    window.scrollTo(0, 0);
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* file:// */ }
  }

  // ------------------------------------------------------------ top bars
  function renderNet() {
    var pill = document.getElementById('net-pill');
    var live = SG.net.online && SG.net.live;
    pill.className = 'net-pill ' + (live ? 'live' : SG.net.online ? 'online' : 'offline');
    document.getElementById('net-text').textContent = live ? t('net.live') : SG.net.online ? '●' : SG.net.slow ? '◐' : '⚠';
    if (!SG.net.online && SG.net.slow) pill.className = 'net-pill online';

    var bar = document.getElementById('databar');
    var age = SG.meta.fetchedAt ? Date.now() - SG.meta.fetchedAt : Infinity;
    var parts = [], cls = 'databar';
    if (!SG.state) { parts.push(t('net.never')); cls += ' bad'; }
    else {
      if (!SG.net.online) { parts.push(SG.net.slow ? t('net.slow') : t('net.offline')); cls += ' warn'; }
      if (isFinite(age)) parts.push(age < 60e3 ? t('net.now') : t('net.age', { age: SG.fmtAge(age) }));
      if (age > 3 * 3600e3) { parts.push(t('net.stale')); cls += ' bad'; }
    }
    bar.className = cls;
    bar.textContent = parts.join(' · ');
    bar.hidden = SG.net.online && SG.net.live && age < 120e3 && !!SG.state;
  }

  // ------------------------------------------------------------ status view
  function locationLine() {
    var loc = SG.prefs.location;
    if (!loc) return null;
    var label = loc.label || (loc.point[0].toFixed(4) + ', ' + loc.point[1].toFixed(4));
    var extra = loc.mode === 'demo' ? ' (' + t('loc.demo') + ')' : loc.mode === 'manual' ? ' (' + t('loc.manual') + ')' : '';
    var acc = loc.mode === 'gps' && loc.accuracy > 500 ? ' · ' + t('loc.approx', { dist: SG.fmtDist(loc.accuracy / 1000) }) : '';
    return h('div', { class: 'loc-line', text: '📍 ' + label + extra + acc });
  }

  function demoMenu() {
    var places = (SG.state && SG.state.demoPlaces) || [];
    return h('div', { class: 'chip-row' }, places.map(function (p) {
      return h('button', { class: 'chip', text: p.name, onclick: function () { SG.setDemo(p.id); if (!document.getElementById('modal').hidden) UI.closeModal(); } });
    }));
  }

  function locationButtons() {
    return h('div', { class: 'btn-row' },
      h('button', { class: 'btn', text: '📡 ' + t('loc.gps'), onclick: function () { useGps(); } }),
      h('button', { class: 'btn', text: '🗺️ ' + t('loc.set'), onclick: pickOnMap }),
      h('button', { class: 'btn ghost', text: '🎯 ' + t('loc.demo'), onclick: function () { UI.modal([h('h3', { text: t('loc.demo') }), demoMenu(), h('button', { class: 'btn ghost', text: t('common.close'), onclick: UI.closeModal })]); } })
    );
  }

  function useGps() {
    SG.startGps(function (err) { UI.toast(err === 'denied' ? t('loc.denied') : t('loc.denied'), 'warn', 5000); });
  }

  function pickOnMap() {
    show('map');
    UI.toast(t('loc.tapmap'), '', 5000);
    SGMap.pick(function (pt) { SG.setManual(pt); });
  }

  function renderRisk() {
    var box = document.getElementById('risk');
    var r = SG.risk();
    var level = r.level;
    box.className = 'card risk ' + level;
    var title, sub = null;
    if (level === 'unknown') title = t('risk.unknown');
    else if (level === 'inside') { title = '⚠️ ' + t('risk.inside'); sub = t('zone.' + r.zone.kind) + ': ' + r.zone.name; }
    else if (level === 'near') { title = '⚠️ ' + t('risk.near', { dist: SG.fmtDist(r.distKm) }); sub = t('zone.' + r.zone.kind) + ': ' + r.zone.name; }
    else if (level === 'alert') { title = '⚠️ ' + r.alertsHere.map(function (a) { return t('ev.' + a.event) + ' · ' + t('sev.' + a.severity); }).join(', '); }
    else title = '✅ ' + t('risk.clear');
    var children = [h('div', { class: 'risk-title', text: title })];
    if (sub) children.push(h('div', { class: 'risk-sub', text: sub }));
    if (r.level !== 'unknown' && r.alertsHere && r.alertsHere.length && level !== 'alert') {
      children.push(h('div', { class: 'risk-sub', text: r.alertsHere.map(function (a) { return (EVENT_ICON[a.event] || '') + ' ' + t('ev.' + a.event) + ' · ' + t('sev.' + a.severity); }).join('  ') }));
    }
    if (r.safeZone) children.push(h('div', { class: 'risk-sub ok', text: '🟢 ' + t('zone.safe') + ': ' + r.safeZone.name }));
    var ll = locationLine(); if (ll) children.push(ll);
    if (level === 'unknown') children.push(locationButtons());
    else {
      if (r.distFromRegion > 15) children.push(h('div', { class: 'risk-sub warn', text: t('loc.far', { dist: SG.fmtDist(r.distFromRegion) }) }), demoMenu());
      children.push(h('button', { class: 'link', text: t('loc.set') + ' / ' + t('loc.demo'), onclick: function () { UI.modal([h('h3', { text: t('loc.set') }), locationButtons(), demoMenu(), h('button', { class: 'btn ghost', text: t('common.close'), onclick: UI.closeModal })]); } }));
    }
    UI.mount(box, children);
  }

  function shelterCard(x, compact) {
    var s = x.s;
    var lines = [
      h('div', { class: 'row-between' },
        h('strong', { text: '⛺ ' + s.name }),
        h('span', { class: 'badge ' + s.status, text: t('shelter.' + s.status) })),
      h('div', { class: 'muted', text: [x.d != null ? SG.fmtDist(x.d) : null, s.status === 'open' ? t('shelter.left', { n: x.left }) : null, s.stepFree ? '♿ ' + t('shelter.stepfree') : null].filter(Boolean).join(' · ') })
    ];
    if (x.d != null && s.status === 'open') {
      lines.push(x.route.length
        ? h('div', { class: 'warn-text', text: '⚠ ' + t('shelter.route_warn', { name: x.route.join(', ') }) })
        : h('div', { class: 'ok-text', text: '✓ ' + t('shelter.route_ok') }));
    }
    if (!compact) {
      lines.push(h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', text: '🧭 ' + t('shelter.go'), onclick: function () { openCompass(x); } }),
        h('button', { class: 'btn', text: '🗺️ ' + t('tab.map'), onclick: function () { show('map'); SGMap.focus(x.pt, 15); } })
      ));
    }
    return h('div', { class: 'card shelter-card' }, lines);
  }

  function renderShelter() {
    var box = document.getElementById('shelter-card');
    if (!SG.state) return UI.clear(box);
    var list = SG.shelters();
    var usable = list.filter(function (x) { return x.s.status === 'open' && !x.inDanger; });
    var best = usable[0];
    // Prefer a shelter whose direct line avoids known danger, if it is not much farther.
    var safer = usable.filter(function (x) { return !x.route.length; })[0];
    if (best && safer && best.route.length && safer.d != null && safer.d <= best.d * 1.5) best = safer;
    if (!SG.point()) return UI.clear(box);
    if (best && best.d > 50) return UI.clear(box); // far from the active area: a shelter 1700 km away is not "nearest"
    if (!best) return UI.mount(box, h('div', { class: 'card warn', text: t('shelter.none') + ' — ' + t('sos.call') }));
    UI.mount(box, h('h2', { class: 'section-title', text: t('shelter.nearest') }), shelterCard(best),
      h('details', { class: 'more-shelters' }, h('summary', { text: t('shelter.list') + ' (' + list.length + ')' }),
        list.map(function (x) { return shelterCard(x, true); })));
  }

  function renderTips() {
    var p = SG.prefs.profile, tips = [];
    if (p.stepFree) tips.push('♿ ' + t('tip.stepfree'));
    if (p.children) tips.push('🧒 ' + t('tip.children'));
    if (p.elderly) tips.push('🧓 ' + t('tip.elderly'));
    UI.mount('tips', tips.length ? h('div', { class: 'card tips' }, tips.map(function (x) { return h('div', { text: x }); })) : null);
  }

  // Read-aloud with a real stop. State is kept by text key, so buttons survive live re-renders.
  var speakingKey = null;
  function markButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('button[data-speak]'), function (b) {
      var on = b.getAttribute('data-speak') === speakingKey;
      b.textContent = on ? '⏹ Stop' : b.getAttribute('data-label');
      b.classList.toggle('speaking', on);
    });
  }
  function stopSpeaking() {
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    speakingKey = null;
    markButtons();
  }
  function speak(text, lang) {
    if (!('speechSynthesis' in window)) { UI.toast('Text-to-speech not available on this device', 'warn'); return; }
    var same = speakingKey === text;
    stopSpeaking();
    if (same) return; // second tap = stop
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = lang || I18N.langInfo(SG.lang()).tts;
      u.rate = 0.95;
      u.onend = u.onerror = function () { if (speakingKey === text) { speakingKey = null; markButtons(); } };
      speakingKey = text;
      markButtons();
      speechSynthesis.speak(u);
    } catch (e) { stopSpeaking(); }
  }
  function speakButton(label, text, lang, cls) {
    var b = h('button', { class: cls || 'btn small', attrs: { 'data-speak': text, 'data-label': label }, onclick: function () { speak(text, lang); } });
    b.textContent = speakingKey === text ? '⏹ Stop' : label;
    if (speakingKey === text) b.classList.add('speaking');
    return b;
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopSpeaking(); });
  var closeModal = UI.closeModal;
  UI.closeModal = function () { if (document.querySelector('#modal-box [data-speak]')) stopSpeaking(); closeModal(); };

  function alertCard(item) {
    var a = item.a, st = item.st, tr = I18N.translateAlert(a, SG.lang());
    var origLang = I18N.langInfo(a.originalLang);
    var head = h('div', { class: 'alert-head' },
      h('span', { class: 'alert-ico', text: EVENT_ICON[a.event] || '⚠️' }),
      h('div', null,
        h('div', { class: 'alert-title', text: tr.event + ' · ' + tr.severity }),
        h('div', { class: 'muted', attrs: { dir: 'auto' }, text: a.area ? a.area.name : '' })),
      st !== 'active' ? h('span', { class: 'badge closed', text: st === 'cancelled' ? t('alerts.cancelled') : '⌛' }) :
        a.msgType === 'Update' ? h('span', { class: 'badge', text: t('alerts.updated') }) : null);
    var body = [head];
    if (item.here && st === 'active') body.push(h('div', { class: 'chip here', text: '📍 ' + t('alerts.here') }));
    if (st === 'expired') body.push(h('div', { class: 'warn-text', text: t('alerts.expired') }));
    body.push(h('div', { class: 'what' }, h('div', { class: 'what-title', text: t('alerts.what') }),
      h('ul', null, tr.instructions.map(function (s) { return h('li', { text: s }); }))));
    body.push(h('div', { class: 'muted small', text: t('alerts.issued', { time: SG.fmtTime(a.issuedAt || a.onset) }) + ' · ' + t('alerts.until', { time: SG.fmtTime(a.expires) }) }));
    body.push(h('div', { class: 'btn-row' },
      speakButton('🔊 ' + t('alerts.listen'), tr.event + '. ' + tr.severity + '. ' + tr.instructions.join(' '))));
    body.push(h('details', { class: 'original' },
      h('summary', { text: t('alerts.official') + ' (' + origLang.name + ')' }),
      h('div', { class: 'orig-text', attrs: { lang: a.originalLang, dir: origLang.dir } },
        h('strong', { text: a.headline }), h('p', { text: a.description })),
      h('div', { class: 'muted small', text: t('alerts.source', { src: a.source }) })));
    return h('article', { class: 'card alert sev-' + a.severity + ' ' + st }, body);
  }

  function renderAlerts() {
    var list = SG.sortedAlerts();
    UI.mount('alerts', list.length ? list.map(alertCard) : h('div', { class: 'card muted', text: t('alerts.none') }));
  }

  function renderTransport() {
    if (!SG.state) return;
    UI.mount('transport', SG.state.transport.map(function (x) {
      return h('div', { class: 'list-row' }, h('span', { text: (MODE_ICON[x.mode] || '') + ' ' + x.name }), h('span', { class: 'badge tr-' + x.status, text: t('tr.' + x.status) }));
    }));
  }

  function renderRumors() {
    if (!SG.state) return;
    var list = SG.state.rumors.slice().reverse();
    UI.mount('rumors', list.length ? [list.map(function (r) {
      return h('div', { class: 'card rumor ' + r.verdict },
        h('div', { class: 'row-between' }, h('strong', { text: t('rt.' + r.topic) }), h('span', { class: 'verdict ' + r.verdict, text: t('rumor.' + r.verdict) })),
        h('div', { class: 'claim', attrs: { dir: 'auto' }, text: '“' + r.claim + '”' }));
    }), h('p', { class: 'fineprint', text: t('rumor.tip') })] : null);
  }

  var weatherLoading = false;
  function renderWeather() {
    var box = document.getElementById('weather');
    if (weatherLoading) return;
    weatherLoading = true;
    SG.weather().then(function (w) {
      weatherLoading = false;
      if (!w) { UI.mount(box, h('div', { class: 'muted', text: '—' })); return; }
      var adv = SG.weatherAdvice(w);
      UI.mount(box,
        h('div', { class: 'wx-row' }, h('span', { text: '🌧️ ' + t('wx.rain', { n: Math.round(w.rain) }) }), h('span', { text: '💨 ' + t('wx.wind', { n: Math.round(w.gust) }) }), h('span', { text: '🌡️ ' + t('wx.temp', { n: Math.round(w.tmax) }) })),
        h('div', { class: adv.length ? 'warn-text' : 'ok-text', text: adv.length ? adv.map(t).join(' · ') : t('wx.ok') }),
        h('div', { class: 'fineprint', text: t('wx.note') + ' · Open-Meteo · ' + SG.fmtAge(Date.now() - w.at) }));
    });
  }

  function renderStatus() {
    renderRisk(); renderShelter(); renderTips(); renderAlerts(); renderTransport(); renderRumors();
    var demo = SG.state && SG.state.region.demo;
    UI.mount('demo-note', demo ? '🧪 ' + t('demo.badge') : null);
  }

  // ------------------------------------------------------------ compass guide
  var compassHandler = null;
  function openCompass(x) {
    var arrow = h('div', { class: 'compass-arrow', text: '⬆' });
    var dist = h('div', { class: 'compass-dist' });
    var hint = h('div', { class: 'muted' });
    var warn = h('div', { class: 'warn-text' });
    var heading = null;
    function update() {
      var p = SG.point();
      if (!p) { dist.textContent = t('risk.unknown'); return; }
      var d = Geo.distanceKm(p, x.pt), b = Geo.bearingDeg(p, x.pt);
      dist.textContent = SG.fmtDist(d);
      if (d < 0.05) { dist.textContent = '✅ ' + t('compass.arrived'); }
      var route = SG.routeCheck(p, x.pt);
      warn.textContent = route.length ? '⚠ ' + t('shelter.route_warn', { name: route.join(', ') }) : '';
      if (heading == null) {
        arrow.style.transform = 'rotate(' + b + 'deg)';
        hint.textContent = t('compass.nosensor', { dir: t('dir.' + Geo.cardinal(b)), deg: Math.round(b) });
      } else {
        arrow.style.transform = 'rotate(' + ((b - heading + 360) % 360) + 'deg)';
        hint.textContent = t('compass.calib');
      }
    }
    function onOrient(e) {
      var hd = null;
      if (typeof e.webkitCompassHeading === 'number') hd = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === 'number') hd = 360 - e.alpha;
      if (hd == null) return;
      var angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      heading = (hd + angle + 360) % 360;
      update();
    }
    function enable() {
      var add = function () {
        compassHandler = onOrient;
        window.addEventListener('deviceorientationabsolute', onOrient);
        window.addEventListener('deviceorientation', onOrient);
      };
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(function (s) { if (s === 'granted') add(); }).catch(function () { /* denied */ });
      } else add();
    }
    UI.onModalClose = function () {
      if (compassHandler) { window.removeEventListener('deviceorientationabsolute', compassHandler); window.removeEventListener('deviceorientation', compassHandler); compassHandler = null; }
      SG.off('location', update);
    };
    SG.on('location', update);
    UI.modal([
      h('h2', { text: '🧭 ' + t('compass.title') }),
      h('div', { class: 'compass-target', text: '⛺ ' + x.s.name }),
      h('div', { class: 'compass-dial' }, arrow), dist, warn, hint,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: t('compass.enable'), onclick: enable }),
        navigator.onLine ? h('a', { class: 'btn', text: t('shelter.directions'), attrs: { href: 'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + x.s.lat + ',' + x.s.lng, target: '_blank', rel: 'noopener' } }) : null,
        h('button', { class: 'btn ghost', text: t('common.close'), onclick: UI.closeModal }))
    ], { cls: 'compass' });
    enable();
    update();
  }

  // ------------------------------------------------------------ map tools
  function renderMapTools() {
    UI.mount('map-tools',
      h('button', { class: 'btn small', text: '📡 ' + t('loc.gps'), onclick: function () { useGps(); } }),
      h('button', { class: 'btn small', text: '👆 ' + t('loc.set'), onclick: function () { UI.toast(t('loc.tapmap')); SGMap.pick(function (pt) { SG.setManual(pt); }); } }),
      h('button', { class: 'btn small', text: '🎯 ' + t('loc.demo'), onclick: function () { UI.modal([h('h3', { text: t('loc.demo') }), demoMenu(), h('button', { class: 'btn ghost', text: t('common.close'), onclick: UI.closeModal })]); } }),
      h('button', { class: 'btn small', text: '📍', attrs: { 'aria-label': t('map.you') }, onclick: function () { SGMap.focus(SG.point(), 15); } }));
    UI.mount('legend',
      h('span', { class: 'lg flooded', text: t('zone.flooded') }), h('span', { class: 'lg unsafe', text: t('zone.unsafe') }),
      h('span', { class: 'lg safe', text: t('zone.safe') }), h('span', { class: 'lg alertarea', text: t('map.alertarea') }),
      h('span', { class: 'lg closure', text: t('map.closure') }), h('span', { text: '⛺ ' + t('map.shelter') }),
      h('span', { text: '? ' + t('rep.unverified') }));
  }

  // ------------------------------------------------------------ SOS chain: internet -> SMS -> 112
  var sosDraft = { people: 1, situation: 'trapped', note: '' };
  var sosPoll = null;

  function sosGet() { return SG.LS.get('sg.sos', null); }
  function sosSave(s) { SG.LS.set('sg.sos', s); renderSos(); }

  function smsBody(kind, d) {
    var code = SmsCode.build(kind, d);
    if (d.lat != null) code += ' https://maps.google.com/?q=' + Number(d.lat).toFixed(5) + ',' + Number(d.lng).toFixed(5);
    return code;
  }
  function smsNumber() { return (SG.state && SG.state.config && SG.state.config.smsNumber) || SG.prefs.contactPhone || ''; }

  function startSos() {
    var loc = SG.prefs.location;
    var data = {
      id: SG.rid(10), people: sosDraft.people, situation: sosDraft.situation, note: sosDraft.note.slice(0, 200),
      lang: SG.lang(), ts: Date.now(),
      lat: loc ? loc.point[0] : null, lng: loc ? loc.point[1] : null, accuracy: loc ? loc.accuracy : null
    };
    if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
    var s = { data: data, s1: 'sending', s2: 'idle', s3: 'idle', startedAt: Date.now(), server: null };
    sosSave(s);
    runStep1();
  }

  function runStep1() {
    var s = sosGet(); if (!s) return;
    SG.queue('sos', '/api/sos', s.data).then(function () {
      if (navigator.onLine === false) { s.s1 = 'skipped'; s.s2 = 'ready'; sosSave(s); return; }
      return SG.flush().then(function () { return OutboxDB.get(s.data.id); }).then(function (item) {
        var cur = sosGet(); if (!cur || cur.data.id !== s.data.id) return;
        if (item && item.status === 'sent') { cur.s1 = 'ok'; cur.server = item.response; sosSave(cur); trackSos(); }
        else { cur.s1 = 'fail'; if (cur.s2 === 'idle') cur.s2 = 'ready'; sosSave(cur); }
      });
    });
  }

  function trackSos() {
    clearInterval(sosPoll);
    var tick = function () {
      var s = sosGet();
      if (!s || s.s1 !== 'ok') return;
      SG.fetchWithTimeout('/api/sos/' + encodeURIComponent(s.data.id), {}, 8000).then(function (r) {
        if (r.status === 404) {
          // The server no longer has this request (e.g. it restarted). Send it again with the same ID.
          var c = sosGet(); if (!c) return null;
          c.s1 = 'sending'; c.server = null; sosSave(c);
          return OutboxDB.put({ id: c.data.id, kind: 'sos', url: '/api/sos', body: c.data, status: 'queued', attempts: 0, createdAt: Date.now() })
            .then(function () { return SG.flush(); }).then(function () { return OutboxDB.get(c.data.id); }).then(function (item) {
              var cur = sosGet(); if (!cur) return null;
              if (item && item.status === 'sent') { cur.s1 = 'ok'; cur.server = item.response; cur.checkedAt = Date.now(); }
              else { cur.s1 = 'fail'; if (cur.s2 === 'idle') cur.s2 = 'ready'; }
              sosSave(cur);
              return null;
            });
        }
        return r.ok ? r.json() : null;
      }).then(function (d) {
        if (!d || !d.id) return;
        var cur = sosGet(); if (!cur || cur.data.id !== d.id) return;
        var changed = !cur.server || cur.server.status !== d.status || cur.server.etaMin !== d.etaMin;
        cur.server = d;
        cur.checkedAt = Date.now();
        SG.LS.set('sg.sos', cur);
        if (changed) { renderSos(); if (navigator.vibrate) navigator.vibrate(150); }
        else updateSosAge();
        if (d.status === 'resolved') clearInterval(sosPoll);
      }).catch(function () { updateSosAge(); /* offline: keep last known */ });
    };
    tick();
    sosPoll = setInterval(tick, 10000);
  }

  /** Refresh only the "last update ... ago" line, without rebuilding the card. */
  function updateSosAge() {
    var el = document.getElementById('sos-age');
    var s = sosGet();
    if (!el || !s) return;
    var age = s.checkedAt ? Date.now() - s.checkedAt : null;
    el.textContent = age == null ? '' : age < 60e3 ? t('net.now') : t('sos.lastknown', { age: SG.fmtAge(age) });
    el.className = 'small ' + (!SG.net.online || (age != null && age > 60e3) ? 'warn-text' : 'muted');
  }

  function clearSos() { clearInterval(sosPoll); SG.LS.del('sg.sos'); renderSos(); }

  function stepRow(n, label, state, extra) {
    var ICON = { idle: '○', sending: '⏳', ok: '✅', fail: '❌', skipped: '⏭️', ready: '👉', opened: '⏳' };
    var text = { sending: t('sos.sending'), ok: '', fail: t('sos.failed'), skipped: t('sos.skipped') }[state] || '';
    return h('li', { class: 'step ' + state },
      h('span', { class: 'step-ico', text: ICON[state] || '○' }),
      h('div', { class: 'step-body' }, h('strong', { text: n + '. ' + label }), text ? h('div', { class: 'muted', text: text }) : null, extra || null));
  }

  function renderSosActive(s) {
    var d = s.data;
    var serverText = null;
    if (s.s1 === 'ok') {
      var st = s.server && s.server.status;
      serverText = st === 'dispatched' ? t('sos.dispatched', { n: s.server.etaMin || '?' }) :
        st === 'ack' ? t('sos.ack') : st === 'resolved' ? t('sos.resolved') : t('sos.received');
    }
    var smsHref = SmsCode.uri(smsNumber(), smsBody('sos', d));
    var step2Extra = null;
    if (s.s2 === 'ready' || s.s2 === 'idle') {
      step2Extra = h('a', { class: 'btn block' + (s.s1 === 'ok' ? '' : ' primary'), text: '✉️ ' + t('sos.sms_open'), attrs: { href: smsHref }, onclick: function () { var c = sosGet(); c.s2 = 'opened'; setTimeout(function () { sosSave(c); }, 300); } });
    } else if (s.s2 === 'opened') {
      step2Extra = h('div', null, h('div', { text: t('sos.sms_q') }), h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: '✅ ' + t('sos.sms_sent'), onclick: function () { var c = sosGet(); c.s2 = 'ok'; sosSave(c); } }),
        h('button', { class: 'btn', text: '❌ ' + t('sos.sms_fail'), onclick: function () { var c = sosGet(); c.s2 = 'fail'; c.s3 = 'ready'; sosSave(c); } }),
        h('a', { class: 'btn ghost', text: '↻', attrs: { href: smsHref, 'aria-label': t('sos.sms_open') } })));
    }
    var callBtn = h('a', { class: 'btn ' + (s.s3 === 'ready' ? 'danger block' : 'block'), text: '📞 ' + t('sos.call'), attrs: { href: 'tel:112' }, onclick: function () { var c = sosGet(); c.s3 = 'opened'; SG.LS.set('sg.sos', c); } });
    var s2state = s.s1 === 'ok' && s.s2 === 'idle' ? 'idle' : s.s2;
    var delivered = s.s1 === 'ok';
    var resolved = delivered && s.server && s.server.status === 'resolved';
    var step2 = stepRow(2, t('sos.step2'), delivered ? (s.s2 === 'idle' ? 'idle' : s2state) : s2state, step2Extra);
    var step3 = stepRow(3, t('sos.step3'), s.s3 === 'ready' ? 'ready' : s.s3 === 'opened' ? 'ok' : 'idle', callBtn);
    var age = s.checkedAt ? Date.now() - s.checkedAt : null;
    return [
      h('div', { class: 'card sos-active' + (delivered ? ' ok' : '') },
        h('h2', { text: '🆘 ' + t('sos.active') }),
        h('div', { class: 'muted', text: t('sos.id', { id: d.id }) + ' · ' + SG.fmtTime(new Date(s.startedAt).toISOString()) }),
        d.lat == null ? h('div', { class: 'warn-text', text: t('risk.unknown') }) : h('div', { class: 'muted', text: '📍 ' + d.lat.toFixed(5) + ', ' + d.lng.toFixed(5) }),
        serverText ? h('div', { class: 'server-status' + (!SG.net.online ? ' stale' : '') }, serverText,
          h('div', { id: 'sos-age', class: 'small ' + (!SG.net.online || (age != null && age > 60e3) ? 'warn-text' : 'muted'), text: age == null ? '' : age < 60e3 ? t('net.now') : t('sos.lastknown', { age: SG.fmtAge(age) }) })) : null,
        // Once the control room has the request, SMS / 112 become backup options (folded away).
        delivered
          ? h('ol', { class: 'steps' }, stepRow(1, t('sos.step1'), 'ok'),
            h('li', { class: 'step backup' }, h('details', { open: s.s2 === 'opened' || s.s3 === 'ready' },
              h('summary', { text: t('sos.backup') }), h('ol', { class: 'steps' }, step2, step3))))
          : h('ol', { class: 'steps' },
            stepRow(1, t('sos.step1'), s.s1, s.s1 === 'fail' || s.s1 === 'skipped' ? h('div', { class: 'muted small', text: t('sos.queued') }) : null),
            step2, step3),
        resolved ? null : h('p', { class: 'stay', text: t('sos.stay') }),
        h('div', { class: 'btn-row' },
          resolved ? null : h('button', { class: 'btn', text: '🔳 ' + t('sos.qr'), onclick: function () { showRelayQr('sos', d); } }),
          h('button', { class: resolved ? 'btn primary' : 'btn ghost', text: resolved ? '✓ ' + t('common.done') : t('sos.new'), onclick: function () {
            if (resolved || window.confirm(t('sos.new') + '?')) clearSos();
          } })))
    ];
  }

  function holdButton(onDone) {
    var btn = h('button', { class: 'sos-big', attrs: { 'aria-label': t('sos.hold') } }, h('span', { class: 'sos-label', text: 'SOS' }), h('span', { class: 'sos-hint', text: t('sos.hold') }), h('span', { class: 'sos-ring' }));
    var timer = null;
    function start(e) {
      if (e) e.preventDefault();
      if (timer) return;
      btn.classList.add('holding');
      if (navigator.vibrate) navigator.vibrate(30);
      timer = setTimeout(function () { timer = null; btn.classList.remove('holding'); onDone(); }, 2000);
    }
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } btn.classList.remove('holding'); }
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    btn.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); });
    btn.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ') cancel(); });
    return btn;
  }

  function renderSos() {
    var s = sosGet();
    if (s) { UI.mount('sos', renderSosActive(s)); return; }
    var people = h('div', { class: 'stepper' },
      h('button', { class: 'btn', text: '−', attrs: { 'aria-label': '-1' }, onclick: function () { sosDraft.people = Math.max(1, sosDraft.people - 1); renderSos(); } }),
      h('span', { class: 'stepper-val', text: String(sosDraft.people) }),
      h('button', { class: 'btn', text: '+', attrs: { 'aria-label': '+1' }, onclick: function () { sosDraft.people = Math.min(50, sosDraft.people + 1); renderSos(); } }));
    var sits = h('div', { class: 'chip-row' }, I18N.VOCAB.situations.map(function (k) {
      return h('button', { class: 'chip' + (sosDraft.situation === k ? ' selected' : ''), text: SIT_ICON[k] + ' ' + t('sit.' + k), attrs: { 'aria-pressed': sosDraft.situation === k ? 'true' : 'false' }, onclick: function () { sosDraft.situation = k; renderSos(); } });
    }));
    var note = h('input', { class: 'input', type: 'text', maxLength: 200, value: sosDraft.note, attrs: { placeholder: t('rep.note') }, oninput: function (e) { sosDraft.note = e.target.value; } });
    UI.mount('sos',
      h('div', { class: 'card sos-form' },
        h('h2', { text: t('sos.title') }),
        locationLine() || h('div', { class: 'warn-text', text: t('risk.unknown') }),
        h('label', { class: 'field-label', text: t('sos.people') }), people,
        h('label', { class: 'field-label', text: t('sos.situation') }), sits,
        note,
        h('div', { class: 'sos-wrap' }, holdButton(startSos)),
        h('ol', { class: 'chain' }, h('li', { text: '1 · ' + t('sos.step1') }), h('li', { text: '2 · ' + t('sos.step2') }), h('li', { text: '3 · ' + t('sos.step3') })),
        h('a', { class: 'btn danger block', text: '📞 ' + t('sos.call'), attrs: { href: 'tel:112' } })));
  }

  function renderHotlines() {
    UI.mount('hotlines', HOTLINES.map(function (n) {
      return h('a', { class: 'list-row hotline', attrs: { href: 'tel:' + n } }, h('span', { class: 'hot-num', text: '📞 ' + n }), h('span', { text: t('hot.' + n) }));
    }));
  }

  function showRelayQr(kind, d) {
    var payload = { k: kind, d: { id: d.id, lat: d.lat, lng: d.lng, people: d.people, situation: d.situation, type: d.type, note: (d.note || '').slice(0, 80), lang: d.lang, ts: d.ts } };
    var url = location.origin + '/relay.html#' + UI.b64encode(payload);
    UI.modal([h('h2', { text: '🔳 ' + (kind === 'sos' ? t('sos.qr') : t('rep.qr')) }), UI.qr(url),
      h('p', { class: 'muted small', text: t('relay.desc') }),
      h('button', { class: 'btn ghost', text: t('common.close'), onclick: UI.closeModal })], { cls: 'qr-modal' });
  }

  // ------------------------------------------------------------ reports
  var repDraft = { type: null, note: '', people: 0 };
  var lastQueued = null;

  function renderReportForm() {
    var types = h('div', { class: 'type-grid' }, I18N.VOCAB.reportTypes.map(function (k) {
      return h('button', { class: 'type-btn' + (repDraft.type === k ? ' selected' : ''), attrs: { 'aria-pressed': repDraft.type === k ? 'true' : 'false' }, onclick: function () { repDraft.type = k; renderReportForm(); } },
        h('span', { class: 'type-ico', text: REPORT_ICON[k] }), h('span', { text: t('rpt.' + k) }));
    }));
    var note = h('input', { class: 'input', type: 'text', maxLength: 200, value: repDraft.note, attrs: { placeholder: t('rep.note') }, oninput: function (e) { repDraft.note = e.target.value; } });
    var children = [h('h2', { text: t('rep.title') }), h('label', { class: 'field-label', text: t('rep.type') }), types];
    if (repDraft.type === 'trapped' || repDraft.type === 'injury') {
      children.push(h('label', { class: 'field-label', text: t('sos.people') }), h('div', { class: 'stepper' },
        h('button', { class: 'btn', text: '−', onclick: function () { repDraft.people = Math.max(0, repDraft.people - 1); renderReportForm(); } }),
        h('span', { class: 'stepper-val', text: String(repDraft.people) }),
        h('button', { class: 'btn', text: '+', onclick: function () { repDraft.people = Math.min(999, repDraft.people + 1); renderReportForm(); } })));
    }
    children.push(note);
    children.push(locationLine() || h('div', { class: 'warn-text', text: t('rep.loc_needed') }));
    children.push(h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', text: '📣 ' + t('rep.send'), disabled: !repDraft.type, onclick: function () { submitReport(false); } }),
      h('button', { class: 'btn ghost', text: '🗺️ ' + t('loc.set'), onclick: pickOnMap })));
    if (lastQueued) {
      children.push(h('div', { class: 'card warn queued-box' },
        h('div', { text: '💾 ' + t('rep.saved') }),
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn', text: '✉️ ' + t('rep.sms'), attrs: { href: SmsCode.uri(smsNumber(), smsBody('report', lastQueued)) } }),
          h('button', { class: 'btn', text: '🔳 ' + t('rep.qr'), onclick: function () { showRelayQr('report', lastQueued); } }))));
    }
    UI.mount('report-form', h('div', { class: 'card' }, children));
  }

  /** Same type, still open, within 200 m and 3 h: probably the same problem someone already reported. */
  function seenBy(n) { return (n || 1) > 1 ? t('rep.confirmed', { n: n }) : ''; }

  function findSimilarReport(type, p) {
    if (!SG.state) return null;
    var best = null;
    SG.state.reports.forEach(function (r) {
      if (r.type !== type || (r.status !== 'unverified' && r.status !== 'verified')) return;
      if (SG.now() - Date.parse(r.createdAt) > 3 * 3600e3) return;
      var d = Geo.distanceKm(p, [r.lat, r.lng]);
      if (d <= 0.2 && (!best || d < best.d)) best = { r: r, d: d };
    });
    return best;
  }

  function submitReport(force) {
    var p = SG.point();
    if (!p) { UI.toast(t('rep.loc_needed'), 'warn'); return; }
    if (!repDraft.type) return;
    var similar = force ? null : findSimilarReport(repDraft.type, p);
    if (similar) {
      var r = similar.r, already = SG.prefs.confirmed[r.id];
      UI.modal([
        h('h3', { text: REPORT_ICON[r.type] + ' ' + t('rpt.' + r.type) }),
        h('p', { text: t('rep.dup', { dist: SG.fmtDist(similar.d) }) }),
        r.note ? h('div', { class: 'claim', attrs: { dir: 'auto' }, text: r.note }) : null,
        h('div', { class: 'muted small', text: reportStatusLabel(r.status) + ' · ' + seenBy(r.confirmations) }),
        h('div', { class: 'btn-row' },
          already ? h('div', { class: 'ok-text', text: '✓ ' + seenBy(r.confirmations) }) :
            h('button', { class: 'btn primary', text: '👁 ' + t('rep.confirm'), onclick: function () { UI.closeModal(); repDraft = { type: null, note: '', people: 0 }; confirmReport(r.id); UI.toast('✅ ' + t('rep.merged'), 'ok'); renderReportForm(); } }),
          h('button', { class: 'btn', text: t('rep.send'), onclick: function () { UI.closeModal(); submitReport(true); } }),
          h('button', { class: 'btn ghost', text: t('common.cancel'), onclick: UI.closeModal }))
      ]);
      return;
    }
    var body = { id: SG.rid(10), type: repDraft.type, lat: p[0], lng: p[1], note: repDraft.note.slice(0, 200), people: repDraft.people, ts: Date.now(), lang: SG.lang(), deviceId: SG.prefs.deviceId };
    SG.prefs.confirmed[body.id] = true; SG.savePrefs(); // you can't "confirm" your own report
    SG.queue('report', '/api/reports', body).then(function () { return SG.flush(); }).then(function () { return OutboxDB.get(body.id); }).then(function (item) {
      repDraft = { type: null, note: '', people: 0 };
      if (item && item.status === 'sent') {
        lastQueued = null;
        var resp = item.response || {};
        if (resp.merged) { SG.prefs.confirmed[resp.id] = true; SG.savePrefs(); UI.toast('✅ ' + t('rep.merged') + ' · ' + t('rep.confirmed', { n: resp.confirmations || 2 }), 'ok', 5000); }
        else UI.toast('✅ ' + t('rep.sent'), 'ok');
        SG.refresh();
      }
      else if (item && item.status === 'failed') { lastQueued = null; UI.toast(t('rep.failed') + ': ' + (item.lastError || ''), 'warn', 6000); }
      else { lastQueued = body; UI.toast('💾 ' + t('rep.saved'), 'warn', 6000); }
      renderReports();
    });
  }

  function reportStatusLabel(status) {
    return { unverified: '? ' + t('rep.unverified'), verified: '✔ ' + t('rep.verified'), false: '✖ ' + t('rep.false'), resolved: '✓ ' + t('rep.resolved') }[status] || status;
  }

  function renderMyReports() {
    OutboxDB.all().then(function (items) {
      var mine = items.filter(function (x) { return x.kind === 'report'; }).reverse();
      if (!mine.length) { UI.mount('my-reports', h('div', { class: 'muted card', text: '—' })); return; }
      var byId = {};
      (SG.state ? SG.state.reports : []).forEach(function (r) { byId[r.id] = r; });
      UI.mount('my-reports', mine.map(function (x) {
        var server = byId[x.id] || (x.response && x.response.id && byId[x.response.id]);
        var label = x.status === 'queued' ? '⏳ ' + t('rep.queued') : x.status === 'failed' ? '❌ ' + t('rep.failed') : server ? reportStatusLabel(server.status) : '✅ ' + t('rep.sent');
        return h('div', { class: 'card list-row' },
          h('span', { text: REPORT_ICON[x.body.type] + ' ' + t('rpt.' + x.body.type) + (x.body.note ? ' — ' + x.body.note : '') }),
          h('span', { class: 'badge ' + (x.status === 'queued' ? 'warn' : x.status === 'failed' ? 'closed' : 'open'), text: label }));
      }));
    });
  }

  function renderNearby() {
    if (!SG.state) return;
    var p = SG.point();
    var list = SG.state.reports.map(function (r) { return { r: r, d: p ? Geo.distanceKm(p, [r.lat, r.lng]) : null }; })
      .filter(function (x) { return x.d == null || x.d < 8; })
      .sort(function (a, b) { return a.d == null ? 0 : a.d - b.d; }).slice(0, 25);
    UI.mount('nearby-reports', list.length ? list.map(function (x) {
      var r = x.r, mine = SG.prefs.confirmed[r.id];
      var canConfirm = r.status === 'unverified' && !mine;
      return h('div', { class: 'card report ' + r.status },
        h('div', { class: 'row-between' }, h('strong', { text: REPORT_ICON[r.type] + ' ' + t('rpt.' + r.type) }), h('span', { class: 'rep-status ' + r.status, text: reportStatusLabel(r.status) })),
        r.note ? h('div', { class: 'claim', attrs: { dir: 'auto' }, text: r.note }) : null,
        h('div', { class: 'muted small', text: [x.d != null ? SG.fmtDist(x.d) : null, SG.fmtAge(SG.now() - Date.parse(r.createdAt)), seenBy(r.confirmations)].filter(Boolean).join(' · ') }),
        canConfirm ? h('button', { class: 'btn small', text: '👁 ' + t('rep.confirm'), onclick: function () { confirmReport(r.id); } }) : null);
    }) : h('div', { class: 'muted card', text: '—' }));
  }

  function confirmReport(id) {
    SG.prefs.confirmed[id] = true; SG.savePrefs();
    SG.queue('confirm', '/api/reports/' + encodeURIComponent(id) + '/confirm', { id: 'cf' + SG.rid(8), deviceId: SG.prefs.deviceId })
      .then(function () { return SG.flush(); }).then(function () { SG.refresh(); renderNearby(); });
    renderNearby();
  }

  function renderReports() { renderReportForm(); renderMyReports(); renderNearby(); }

  // ------------------------------------------------------------ more
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (currentView === 'more') renderMore(); });

  function phraseModal(id) {
    var local = I18N.PHRASES_LOCAL[(SG.state && SG.state.region.localLang) || 'ta'] || I18N.PHRASES_LOCAL.ta;
    var p = local[id];
    UI.modal([
      h('div', { class: 'phrase-big', attrs: { lang: 'ta' }, text: p[0] }),
      h('div', { class: 'phrase-translit', text: p[1] }),
      h('div', { class: 'phrase-meaning', text: t('ph.' + id) }),
      h('div', { class: 'btn-row' },
        speakButton('🔊', p[0], 'ta-IN', 'btn'),
        h('button', { class: 'btn ghost', text: t('common.close'), onclick: UI.closeModal }))
    ], { cls: 'phrase' });
  }

  function safeMessage() {
    var loc = SG.prefs.location;
    var where = loc ? ((loc.label ? loc.label + ' ' : '') + 'https://maps.google.com/?q=' + loc.point[0].toFixed(5) + ',' + loc.point[1].toFixed(5)) : '—';
    return t('safe.msg', { loc: where, time: SG.fmtTime(new Date().toISOString()) }) + ' (StormGuide)';
  }

  function section(title, children) { return h('div', { class: 'card' }, h('h3', { text: title }), children); }

  function renderMore() {
    var p = SG.prefs.profile;
    var local = I18N.PHRASES_LOCAL[(SG.state && SG.state.region.localLang) || 'ta'] || I18N.PHRASES_LOCAL.ta;
    var pack = SG.prefs.offlinePack;
    var packStatus = h('div', { class: pack ? 'ok-text' : 'muted', text: pack ? '✅ ' + t('off.ready') + ' · ' + SG.fmtAge(Date.now() - pack.at) : '' });
    function toggle(key, label) {
      return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!p[key], onchange: function (e) { p[key] = e.target.checked; SG.savePrefs(); renderStatus(); } }), h('span', { text: label }));
    }
    UI.mount('more',
      section('🌐 ' + t('lang.label'), h('button', { class: 'btn', text: I18N.langInfo(SG.lang()).name + ' ▾', onclick: function () { langPicker(false); } })),
      section('✅ ' + t('safe.title'), [
        h('p', { class: 'muted small', text: safeMessage() }),
        h('div', { class: 'btn-row' },
          navigator.share ? h('button', { class: 'btn primary', text: t('safe.share'), onclick: function () { navigator.share({ text: safeMessage() }).catch(function () { /* cancelled */ }); } }) : null,
          h('a', { class: 'btn', text: '✉️ SMS', attrs: { href: SmsCode.uri(SG.prefs.contactPhone || '', safeMessage()) } }),
          h('a', { class: 'btn', text: 'WhatsApp', attrs: { href: 'https://wa.me/?text=' + encodeURIComponent(safeMessage()), target: '_blank', rel: 'noopener' } }))
      ]),
      section('🗣️ ' + t('phr.title'), [h('p', { class: 'muted small', text: t('phr.hint') }), h('div', { class: 'phrase-list' }, I18N.VOCAB.phrases.map(function (id) {
        return h('button', { class: 'phrase-btn', onclick: function () { phraseModal(id); } }, h('span', { text: t('ph.' + id) }), h('span', { class: 'muted', attrs: { lang: 'ta' }, text: local[id][0] }));
      }))]),
      section('🧑‍🦽 ' + t('prof.title'), [toggle('stepFree', t('prof.stepfree')), toggle('children', t('prof.children')), toggle('elderly', t('prof.elderly'))]),
      section('📦 ' + t('off.title'), [
        packStatus,
        h('button', { class: 'btn', text: '⬇️ ' + t('off.prepare'), onclick: function (e) {
          var b = e.target; b.disabled = true;
          SG.offlinePack(function (n) { b.textContent = t('off.progress', { n: n }); }).then(function (ok) {
            b.disabled = false; b.textContent = '⬇️ ' + t('off.prepare');
            UI.toast(ok ? '✅ ' + t('off.ready') : t('off.fail'), ok ? 'ok' : 'warn');
            renderMore();
          });
        } }),
        h('p', { class: 'muted small', text: '💾 ' + (pack ? (pack.tiles || 0) + ' map tiles · ' : '') + 'Stored inside this browser on your phone (not in your Downloads or gallery).' }),
        h('button', { class: 'btn ghost', text: '🗑️ Delete offline map', onclick: function () {
          SG.deleteOfflineMap().then(function () { UI.toast('🗑️ Offline map deleted', 'ok'); renderMore(); });
        } })
      ]),
      section('🔔 ' + t('notif.enable'), h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: SG.prefs.notif, onchange: function (e) {
        if (e.target.checked) SG.enableNotifications().then(function (ok) { if (!ok) e.target.checked = false; });
        else { SG.prefs.notif = false; SG.savePrefs(); }
      } }), h('span', { text: t('notif.enable') }))),
      section('👪 SMS', [h('label', { class: 'field-label', text: '☎️ +91… / +33…' }), h('input', { class: 'input', type: 'tel', value: SG.prefs.contactPhone, maxLength: 20, attrs: { placeholder: '+44 7700 900123', inputmode: 'tel' }, onchange: function (e) { SG.prefs.contactPhone = e.target.value.replace(/[^\d+]/g, ''); SG.savePrefs(); renderMore(); } })]),
      installEvt ? section('📲 ' + t('install'), h('button', { class: 'btn primary', text: t('install'), onclick: function () { installEvt.prompt(); installEvt = null; renderMore(); } })) : null,
      section('ℹ️ ' + t('about.title'), [
        h('p', { class: 'small', text: t('about.text') + (SG.state && SG.state.region.demo ? ' ' + t('demo.badge') : '') }),
        h('a', { class: 'link', text: t('about.officials'), attrs: { href: '/authority.html' } })
      ]));
  }

  // ------------------------------------------------------------ escalation + auto offline pack
  function onNewState(ev) {
    if (ev && ev.source === 'network') {
      var esc = SG.checkEscalation();
      esc.forEach(function (a) {
        var title = t('notif.new', { event: t('ev.' + a.event) + ' · ' + t('sev.' + a.severity) });
        UI.toast('⚠️ ' + title, 'danger', 7000);
        if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
        SG.showNotification(title, I18N.translateAlert(a, SG.lang()).instructions.join(' '));
      });
      var severe = esc.some(function (a) { return (Geo.SEVERITY_RANK[a.severity] || 0) >= 3; });
      var pack = SG.prefs.offlinePack;
      if (severe && navigator.onLine && (!pack || Date.now() - pack.at > 6 * 3600e3)) {
        SG.offlinePack().then(function (ok) { if (ok) UI.toast('📦 ' + t('off.auto'), 'ok', 5000); });
      }
    }
    renderAll();
  }

  // ------------------------------------------------------------ boot
  function renderAll() {
    applyLang();
    renderNet();
    renderStatus();
    renderSos();
    renderHotlines();
    if (currentView === 'report') renderReports();
    if (currentView === 'more') renderMore();
    if (currentView === 'map') renderMapTools();
    SGMap.render();
  }

  function askLocation() {
    if (SG.prefs.location) return;
    useGps();
  }

  SG.on('state', onNewState);
  SG.on('net', function () { renderNet(); updateSosAge(); var c = document.querySelector('.server-status'); if (c) c.classList.toggle('stale', !SG.net.online); });
  SG.on('location', function () { renderStatus(); renderSos(); SGMap.renderYou(); SGMap.render(); if (currentView === 'report') renderReportForm(); renderWeather(); });
  SG.on('outbox', function (r) {
    if (r && r.sent) { SG.refresh(); }
    var s = sosGet();
    if (s && s.s1 !== 'ok') {
      OutboxDB.get(s.data.id).then(function (item) {
        if (item && item.status === 'sent') { var c = sosGet(); c.s1 = 'ok'; c.server = item.response; sosSave(c); trackSos(); UI.toast('✅ ' + t('sos.received'), 'ok'); }
      });
    }
    if (currentView === 'report') renderMyReports();
  });
  SG.on('guide', function (x) { openCompass(x); });

  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (b) {
      if (b.getAttribute('data-view') === 'more') renderMore();
      show(b.getAttribute('data-view'));
    }
  });
  document.getElementById('lang-btn').addEventListener('click', function () { langPicker(false); });

  setInterval(renderNet, 30000);

  // Boot: show cached data instantly, then go to the network.
  SG.loadCachedState();
  applyLang();
  renderAll();
  var hashView = (location.hash || '').slice(1);
  if (['status', 'map', 'sos', 'report', 'more'].indexOf(hashView) >= 0) show(hashView);
  if (!SG.prefs.lang) langPicker(true);
  else if (SG.prefs.location && SG.prefs.location.mode === 'gps') useGps();
  SG.refresh().then(function () { renderWeather(); });
  SG.connectLive();
  SG.flush();
  OutboxDB.cleanup(7);
  (function () {
    var s = sosGet();
    if (!s) return;
    var ageMs = Date.now() - (s.startedAt || 0);
    var resolvedLongAgo = s.server && s.server.status === 'resolved' && s.checkedAt && Date.now() - s.checkedAt > 3600e3;
    if (ageMs > 24 * 3600e3 || resolvedLongAgo) { SG.LS.del('sg.sos'); renderSos(); return; }
    if (s.s1 === 'ok') trackSos();
    else if (s.s1 === 'sending') runStep1(); // the page was closed while sending: try again
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (e) { console.warn('SW registration failed', e); });
    });
  }
})();
