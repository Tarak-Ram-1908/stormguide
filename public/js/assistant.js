/*
 * Offline travel assistant.
 *
 * Runs entirely on the phone. A small multilingual intent matcher (keywords in
 * the 10 app languages + English) picks what the traveller is asking about,
 * then answers from the data already cached on the device: shelters, zones,
 * alerts, transport, rumors, weather, closures, hotlines and phrases. Answers
 * reuse the app's pre-translated strings, so they come back in the traveller's
 * language and can never invent facts. Because it reads SG.state, it is
 * automatically up to date whenever the app re-syncs after reconnecting.
 */
/* global SG, UI, I18N, Geo */
(function (root) {
  'use strict';
  var h = UI.h, t = function (k, v) { return SG.t(k, v); };

  // Keywords per intent. Latin words match whole words; other scripts match as substrings.
  var INTENTS = {
    sos: ['help me', 'sos', 'trapped', 'rescue', 'save me', 'stuck', 'aide', 'ayuda', 'hilfe', 'socorro', '救命', '助けて', 'मदद', 'बचाओ', 'உதவி', 'காப்பாற்று', 'సహాయం', 'కాపాడండి', 'مساعدة', 'النجدة'],
    injury: ['injured', 'injury', 'hurt', 'bleeding', 'blood', 'wound', 'fracture', 'sprain', 'twisted', 'knee', 'ankle', 'leg', 'arm', 'pain', 'burn', 'faint', 'fainted', 'unconscious', 'dizzy', 'first aid', 'medical', 'sick', 'fever', 'blessé', 'blessure', 'saigne', 'douleur', 'herido', 'herida', 'sangre', 'dolor', 'verletzt', 'verletzung', 'blutet', 'schmerz', '受伤', '流血', '疼', '骨折', 'けが', '怪我', '出血', '痛', 'घायल', 'चोट', 'खून', 'दर्द', 'காயம்', 'இரத்த', 'வலி', 'గాయ', 'రక్త', 'నొప్పి', 'مصاب', 'جرح', 'نزيف', 'ألم'],
    shelter: ['shelter', 'shelters', 'camp', 'relief', 'refuge', 'where to go', 'where should i go', 'safe place', 'sleep', 'stay', 'evacuate', 'abri', 'abris', 'refugio', 'albergue', 'unterkunft', 'notunterkunft', '避难', '避難', 'शिविर', 'आश्रय', 'राहत', 'முகாம்', 'நிவாரண', 'ఆశ్రయ', 'శిబిర', 'ملجأ', 'ملاجئ', 'مأوى'],
    safety: ['safe', 'safety', 'danger', 'dangerous', 'risk', 'am i', 'flood near', 'flooded near', 'sécurité', 'sûr', 'danger', 'peligro', 'seguro', 'gefahr', 'sicher', '安全', '危险', '危険', 'सुरक्षित', 'ख़तरा', 'खतरा', 'பாதுகாப்ப', 'ஆபத்து', 'సురక్షిత', 'ప్రమాద', 'آمن', 'بأمان', 'خطر'],
    alerts: ['alert', 'alerts', 'warning', 'warnings', 'what to do', 'what should i do', 'instruction', 'advice', 'official', 'precaution', 'precautions', 'precautionary', 'prepare', 'tips', 'alerte', 'consigne', 'aviso', 'alerta', 'warnung', '预警', '警报', '警報', 'चेतावनी', 'क्या करें', 'எச்சரிக்கை', 'என்ன செய்ய', 'హెచ్చరిక', 'ఏం చేయాలి', 'تنبيه', 'تحذير', 'ماذا أفعل'],
    numbers: ['number', 'numbers', 'call', 'phone number', 'police', 'ambulance', 'fire', 'hospital', 'doctor', 'emergency', 'helpline', '112', '108', 'numéro', 'urgence', 'hôpital', 'policía', 'ambulancia', 'hospital', 'polizei', 'krankenhaus', 'notruf', 'arzt', '电话', '医院', '救护', '警察', '病院', '救急', 'पुलिस', 'एम्बुलेंस', 'अस्पताल', 'नंबर', 'காவல்', 'ஆம்புலன்ஸ்', 'மருத்துவமனை', 'எண்', 'పోలీస్', 'అంబులెన్స్', 'ఆసుపత్రి', 'నంబర్', 'مستشفى', 'إسعاف', 'شرطة', 'رقم'],
    transport: ['metro', 'train', 'trains', 'bus', 'buses', 'airport', 'flight', 'flights', 'transport', 'taxi', 'mrts', 'suburban', 'railway', 'gare', 'avion', 'aéroport', 'tren', 'autobús', 'aeropuerto', 'vuelo', 'zug', 'flughafen', 'flug', '地铁', '机场', '火车', '航班', '電車', '空港', '地下鉄', 'मेट्रो', 'ट्रेन', 'बस', 'हवाई', 'உள்ளூர் ரயில்', 'ரயில்', 'பேருந்து', 'விமான', 'మెట్రో', 'రైలు', 'బస్సు', 'విమాన', 'مطار', 'قطار', 'حافلة', 'رحلة'],
    rumor: ['rumor', 'rumour', 'true', 'fake', 'real', 'heard', 'whatsapp', 'forward', 'is it true', 'burst', 'dam', 'lake', 'rumeur', 'vrai', 'faux', 'rumor', 'verdad', 'falso', 'gerücht', 'wahr', '谣言', '真的', '噂', '本当', 'अफ़वाह', 'अफवाह', 'सच', 'வதந்தி', 'உண்மை', 'పుకారు', 'నిజం', 'شائعة', 'صحيح'],
    weather: ['weather', 'rain', 'raining', 'wind', 'temperature', 'storm', 'cyclone', 'hot', 'météo', 'pluie', 'tiempo', 'lluvia', 'wetter', 'regen', '天气', '下雨', '天気', '雨', 'मौसम', 'बारिश', 'வானிலை', 'மழை', 'వాతావరణం', 'వర్షం', 'طقس', 'مطر'],
    phrase: ['say', 'speak', 'tamil', 'translate', 'phrase', 'words', 'local language', 'how do i say', 'dire', 'parler', 'decir', 'hablar', 'sagen', 'sprechen', '怎么说', '泰米尔', '言う', 'タミル', 'बोल', 'कहें', 'तमिल', 'சொல்', 'தமிழ்', 'చెప్ప', 'తమిళ', 'أقول', 'التاميل'],
    roads: ['road', 'roads', 'street', 'route', 'closed', 'blocked', 'way', 'path', 'drive', 'walk', 'subway', 'bridge', 'route', 'rue', 'carretera', 'calle', 'straße', 'strasse', '道路', '道', '封闭', '通行止め', 'सड़क', 'रास्ता', 'சாலை', 'வழி', 'రోడ్డు', 'దారి', 'طريق', 'شارع'],
    supplies: ['water', 'food', 'eat', 'drink', 'hungry', 'thirsty', 'toilet', 'eau', 'manger', 'nourriture', 'agua', 'comida', 'wasser', 'essen', '水', '食物', '吃', '食べ', 'पानी', 'खाना', 'भूख', 'தண்ணீர்', 'உணவு', 'குடிநீர்', 'నీరు', 'ఆహారం', 'ماء', 'طعام', 'جائع'],
    charge: ['charge', 'charging', 'battery', 'power bank', 'electricity', 'recharger', 'batterie', 'cargar', 'batería', 'akku', 'laden', '充电', '电池', '充電', 'चार्ज', 'बैटरी', 'சார்ஜ்', 'பேட்டரி', 'ఛార్జ్', 'బ్యాటరీ', 'شحن', 'بطارية']
  };
  // Which phrase card a question points at (for "how do I say ... water").
  var PHRASE_HINTS = {
    water: ['water', 'drink', 'eau', 'agua', 'wasser', '水', 'पानी', 'தண்ணீர்', 'நீர்', 'నీరు', 'ماء'],
    hospital: ['hospital', 'doctor', 'hôpital', 'krankenhaus', '医院', '病院', 'अस्पताल', 'மருத்துவமனை', 'ఆసుపత్రి', 'مستشفى'],
    shelter: ['shelter', 'camp', 'abri', 'refugio', 'unterkunft', '避难', '避難', 'शिविर', 'முகாம்', 'ఆశ్రయ', 'ملجأ'],
    help: ['help', 'aide', 'ayuda', 'hilfe', '救命', '助け', 'मदद', 'உதவி', 'సహాయం', 'مساعدة'],
    lost: ['lost', 'perdu', 'perdido', 'verirrt', '迷路', 'भटक', 'வழி தவற', 'దారి తప్ప', 'ضللت'],
    injured: ['injured', 'hurt', 'blessé', 'herido', 'verletzt', '受伤', 'けが', 'घायल', 'காயம்', 'గాయ', 'مصاب'],
    charge: ['charge', 'battery', 'recharger', 'cargar', 'laden', '充电', '充電', 'चार्ज', 'சார்ஜ்', 'ఛార్జ్', 'شحن'],
    call112: ['112', 'police', 'policía', 'polizei', 'पुलिस', 'காவல்', 'పోలీస్', 'شرطة'],
    flooded: ['flooded', 'flood', 'inondé', 'inundad', 'überflutet', '淹', '冠水', 'पानी भरा', 'வெள்ள', 'వరద', 'غارق'],
    nolang: ['speak tamil', 'don t speak', 'do not speak', 'ne parle pas', 'no hablo', 'spreche kein']
  };

  function norm(s) { return String(s || '').toLowerCase().replace(/[?!.,;:¿¡،。？！、'’"«»“”]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function hits(q, words) {
    var n = 0;
    words.forEach(function (w) {
      if (/^[\x00-\x7f]+$/.test(w)) { if ((' ' + q + ' ').indexOf(' ' + w + ' ') >= 0 || (w.length > 4 && q.indexOf(w) >= 0)) n += w.indexOf(' ') > 0 ? 2 : 1; }
      else if (q.indexOf(w) >= 0) n += 1;
    });
    return n;
  }

  /** Pick the best intent for a question. Exposed for tests. */
  function classify(text) {
    var q = norm(text), best = null, bestScore = 0;
    Object.keys(INTENTS).forEach(function (k) {
      var s = hits(q, INTENTS[k]);
      if (k === 'phrase' && s) s += 1;   // "how do I say water" is about the phrase, not water
      if (k === 'sos' && s) s += 3;      // urgent requests win
      if (k === 'injury' && s) s += 2;   // "hurt my knee in the storm" is about the injury, not the weather
      if (s > bestScore) { best = k; bestScore = s; }
    });
    return best;
  }

  // ------------------------------------------------------------ answers (built from cached data)
  function point() { return SG.point(); }
  function line(text, cls) { return h('div', { class: 'ai-line ' + (cls || ''), text: text }); }
  function bullets(list) { return h('ul', { class: 'ai-list' }, list.map(function (x) { return h('li', null, x); })); }
  function btn(label, fn, cls) { return h('button', { class: 'btn small ' + (cls || ''), text: label, onclick: fn }); }
  function goTab(view) { UI.closeModal(); setTimeout(function () { var b = document.getElementById('tab-' + view); if (b) b.click(); }, 60); }

  function needLocation() {
    return [line('📍 ' + t('risk.unknown'), 'warn'), h('div', { class: 'btn-row' }, btn('📡 ' + t('loc.gps'), function () { UI.closeModal(); SG.startGps(); }), btn('🎯 ' + t('loc.demo'), function () { goTab('status'); }))];
  }

  function shelterLine(x) {
    var s = x.s;
    return h('div', { class: 'ai-item' },
      h('strong', { text: '⛺ ' + s.name }),
      h('div', { class: 'muted small', text: [x.d != null ? SG.fmtDist(x.d) : null, t('shelter.' + s.status), s.status === 'open' ? t('shelter.left', { n: x.left }) : null, s.stepFree ? '♿ ' + t('shelter.stepfree') : null].filter(Boolean).join(' · ') }),
      x.route.length ? h('div', { class: 'warn-text small', text: '⚠ ' + t('shelter.route_warn', { name: x.route.join(', ') }) }) : null);
  }

  var ANSWERS = {
    sos: function () {
      return [line('🆘 ' + t('sos.title'), 'strong'), line(t('sos.stay')),
        h('div', { class: 'btn-row' }, btn('🆘 ' + t('tab.sos'), function () { goTab('sos'); }, 'danger'), h('a', { class: 'btn small', text: '📞 ' + t('sos.call'), attrs: { href: 'tel:112' } }))];
    },
    injury: function () {
      var local = I18N.PHRASES_LOCAL[(SG.state && SG.state.region.localLang) || 'ta'] || I18N.PHRASES_LOCAL.ta;
      var out = [line('🩹 ' + t('ph.injured'), 'strong'), line(t('ai.injury')),
        h('a', { class: 'ai-call first', attrs: { href: 'tel:108' } }, h('span', { class: 'hot-num', text: '📞 108' }), h('span', { text: t('hot.108') })),
        h('a', { class: 'ai-call', attrs: { href: 'tel:112' } }, h('span', { class: 'hot-num', text: '📞 112' }), h('span', { text: t('hot.112') })),
        h('div', { class: 'btn-row' }, btn('🆘 ' + t('tab.sos'), function () { goTab('sos'); }, 'danger'))];
      var near = point() && SG.shelters().filter(function (x) { return x.s.status === 'open' && !x.inDanger && x.d != null && x.d <= 50; })[0];
      if (near) out.push(line(t('shelter.nearest'), 'strong'), shelterLine(near));
      out.push(h('div', { class: 'ai-item' }, h('div', { class: 'ai-phrase', attrs: { lang: 'ta' }, text: local.injured[0] }), h('div', { class: 'muted small', text: local.injured[1] + ' — ' + t('ph.injured') })));
      return out;
    },
    shelter: function () {
      if (!point()) return [line(t('shelter.nearest'), 'strong')].concat(needLocation());
      var list = SG.shelters().filter(function (x) { return x.s.status === 'open' && !x.inDanger; });
      if (!list.length) return [line(t('shelter.none'), 'warn')];
      if (list[0].d > 50) return [line(t('loc.far', { dist: SG.fmtDist(Geo.distanceKm(point(), SG.state.region.center)) }), 'warn')];
      var best = list[0];
      return [line(t('shelter.nearest'), 'strong'), shelterLine(best),
        h('div', { class: 'btn-row' }, btn('🧭 ' + t('shelter.go'), function () { UI.closeModal(); setTimeout(function () { SG.emit('guide', best); }, 80); }, 'primary'),
          btn('🗺️ ' + t('tab.map'), function () { goTab('map'); }))]
        .concat(list.length > 1 ? [h('details', { class: 'ai-more' }, h('summary', { text: t('shelter.list') }), list.slice(1, 4).map(shelterLine))] : []);
    },
    safety: function () {
      if (!point()) return needLocation();
      var r = SG.risk(), out = [];
      if (r.distFromRegion > 50) return [line(t('loc.far', { dist: SG.fmtDist(r.distFromRegion) }), 'warn'), h('div', { class: 'btn-row' }, btn('🎯 ' + t('loc.demo'), function () { goTab('status'); }))];
      if (r.level === 'inside') out.push(line('⚠️ ' + t('risk.inside'), 'danger'), line(t('zone.' + r.zone.kind) + ': ' + r.zone.name));
      else if (r.level === 'near') out.push(line('⚠️ ' + t('risk.near', { dist: SG.fmtDist(r.distKm) }), 'warn'), line(t('zone.' + r.zone.kind) + ': ' + r.zone.name));
      else out.push(line('✅ ' + t('risk.clear'), 'ok'));
      if (r.alertsHere && r.alertsHere.length) {
        out.push(line(t('alerts.here') + ':', 'strong'));
        r.alertsHere.forEach(function (a) { var tr = I18N.translateAlert(a, SG.lang()); out.push(line(tr.event + ' · ' + tr.severity), bullets(tr.instructions.slice(0, 3))); });
      }
      if (r.level === 'inside' || r.level === 'near') out.push(h('div', { class: 'btn-row' }, btn('⛺ ' + t('shelter.nearest'), function () { ask('shelter', true); }, 'primary')));
      return out;
    },
    alerts: function () {
      var list = SG.sortedAlerts().filter(function (x) { return x.st === 'active'; });
      if (!list.length) return [line(t('alerts.none'))];
      var mine = list.filter(function (x) { return x.here; });
      var show = (mine.length ? mine : list).slice(0, 3);
      var out = [line(t('alerts.what'), 'strong')];
      show.forEach(function (x) {
        var tr = I18N.translateAlert(x.a, SG.lang());
        out.push(line(tr.event + ' · ' + tr.severity + (x.here ? ' · 📍 ' + t('alerts.here') : '')), bullets(tr.instructions));
      });
      out.push(h('div', { class: 'btn-row' }, btn(t('alerts.title'), function () { goTab('status'); })));
      return out;
    },
    numbers: function (q) {
      var want = /ambulance|hospital|doctor|108|ambulancia|hôpital|krankenhaus|医院|病院|救急|एम्बुलेंस|अस्पताल|ஆம்புலன்ஸ்|மருத்துவமனை|అంబులెన్స్|ఆసుపత్రి|مستشفى|إسعاف/i.test(q) ? '108' : null;
      var nums = ['112', '108', '1070', '1913', '1363'];
      if (want) nums = [want].concat(nums.filter(function (n) { return n !== want; }));
      return [line(t('hot.title'), 'strong')].concat(nums.map(function (n, i) {
        return h('a', { class: 'ai-call' + (i === 0 ? ' first' : ''), attrs: { href: 'tel:' + n } }, h('span', { class: 'hot-num', text: '📞 ' + n }), h('span', { text: t('hot.' + n) }));
      }));
    },
    transport: function (q) {
      var mode = /airport|flight|aéroport|avion|aeropuerto|vuelo|flughafen|flug|机场|航班|空港|हवाई|விமான|విమాన|مطار/i.test(q) ? 'airport'
        : /metro|地铁|地下鉄|मेट्रो|மெட்ரோ|మెట్రో/i.test(q) ? 'metro'
        : /bus|autobús|बस|பேருந்து|బస్సు|حافلة/i.test(q) ? 'bus'
        : /train|mrts|suburban|railway|gare|tren|zug|火车|電車|ट्रेन|ரயில்|రైలు|قطار/i.test(q) ? 'train' : null;
      var list = SG.state.transport.filter(function (x) { return !mode || x.mode === mode; });
      if (!list.length) list = SG.state.transport;
      return [line(t('tr.title'), 'strong')].concat(list.map(function (x) {
        return h('div', { class: 'ai-item row-between' }, h('span', { text: x.name }), h('span', { class: 'badge tr-' + x.status, text: t('tr.' + x.status) }));
      }));
    },
    rumor: function (q) {
      var topic = /dam|lake|burst|barrage|presa|damm|水坝|ダム|बाँध|அணை|ஏரி|ఆనకట్ట|చెరువు|سد/i.test(q) ? 'dam_burst'
        : /airport|aéroport|aeropuerto|flughafen|机场|空港|हवाई|விமான|విమాన|مطار/i.test(q) ? 'airport_closed'
        : /water|eau|agua|wasser|水|पानी|நீர்|నీరు|ماء/i.test(q) ? 'water_unsafe'
        : /power|electric|courant|luz|strom|停电|停電|बिजली|மின்|కరెంట్|كهرباء/i.test(q) ? 'power_off' : null;
      var list = SG.state.rumors.filter(function (r) { return !topic || r.topic === topic; });
      if (!list.length) return [line(topic ? t('rt.' + topic) + ': ' + t('rumor.unverified') : t('rumor.tip'))];
      return [line(t('rumor.title'), 'strong')].concat(list.slice(0, 4).map(function (r) {
        return h('div', { class: 'ai-item' }, h('div', { class: 'row-between' }, h('strong', { text: t('rt.' + r.topic) }), h('span', { class: 'verdict ' + r.verdict, text: t('rumor.' + r.verdict) })),
          h('div', { class: 'claim', attrs: { dir: 'auto' }, text: '“' + r.claim + '”' }));
      }), [line(t('rumor.tip'), 'muted small')]);
    },
    weather: function () {
      var w = SG.LS.get('sg.weather', null);
      var out = [line(t('wx.title'), 'strong')];
      if (w) {
        var adv = SG.weatherAdvice(w);
        out.push(line('🌧️ ' + t('wx.rain', { n: Math.round(w.rain) }) + ' · 💨 ' + t('wx.wind', { n: Math.round(w.gust) }) + ' · 🌡️ ' + t('wx.temp', { n: Math.round(w.tmax) })),
          line(adv.length ? adv.map(function (k) { return t(k); }).join(' · ') : t('wx.ok'), adv.length ? 'warn' : 'ok'), line(t('wx.note'), 'muted small'));
      }
      var rain = SG.state.alerts.filter(function (a) { return SG.alertState(a) === 'active' && /rain|cyclone|storm|flood/.test(a.event); });
      rain.slice(0, 2).forEach(function (a) { var tr = I18N.translateAlert(a, SG.lang()); out.push(line('📢 ' + tr.event + ' · ' + tr.severity)); });
      if (out.length === 1) out.push(line('—'));
      return out;
    },
    phrase: function (q) {
      var local = I18N.PHRASES_LOCAL[(SG.state && SG.state.region.localLang) || 'ta'] || I18N.PHRASES_LOCAL.ta;
      var pick = null;
      Object.keys(PHRASE_HINTS).forEach(function (k) { if (!pick && hits(norm(q), PHRASE_HINTS[k])) pick = k; });
      var ids = pick ? [pick] : ['help', 'shelter', 'water', 'hospital'];
      return [line(t('phr.title'), 'strong')].concat(ids.map(function (id) {
        return h('div', { class: 'ai-item' }, h('div', { class: 'ai-phrase', attrs: { lang: 'ta' }, text: local[id][0] }), h('div', { class: 'muted small', text: local[id][1] + ' — ' + t('ph.' + id) }));
      }), [h('div', { class: 'btn-row' }, btn(t('phr.title'), function () { goTab('more'); }))]);
    },
    roads: function () {
      var p = point(), list = SG.state.closures.map(function (c) { return { c: c, d: p ? Geo.distanceToPolylineKm(p, c.path) : null }; })
        .sort(function (a, b) { return (a.d == null ? 0 : a.d) - (b.d == null ? 0 : b.d); });
      var out = [line('⛔ ' + t('map.closure'), 'strong')];
      if (!list.length) out.push(line('—'));
      list.slice(0, 5).forEach(function (x) { out.push(line(x.c.name + (x.d != null ? ' · ' + SG.fmtDist(x.d) : ''))); });
      var zones = SG.state.zones.filter(function (z) { return z.kind !== 'safe'; }).map(function (z) { return { z: z, d: p ? Geo.distanceToPolygonKm(p, z.polygon) : null }; })
        .sort(function (a, b) { return (a.d == null ? 0 : a.d) - (b.d == null ? 0 : b.d); }).slice(0, 3);
      if (zones.length) { out.push(line(t('zone.flooded') + ' / ' + t('zone.unsafe'), 'strong')); zones.forEach(function (x) { out.push(line(x.z.name + (x.d != null ? ' · ' + SG.fmtDist(x.d) : ''))); }); }
      out.push(line(t('ins.avoid_water'), 'muted small'), h('div', { class: 'btn-row' }, btn('🗺️ ' + t('tab.map'), function () { goTab('map'); })));
      return out;
    },
    supplies: function (q) {
      var wantFood = /food|eat|hungry|manger|nourriture|comida|essen|食|खाना|भूख|உணவு|ఆహారం|طعام|جائع/i.test(q);
      var need = wantFood ? 'food' : 'water';
      var list = SG.shelters().filter(function (x) { return x.s.status === 'open' && !x.inDanger && x.s.amenities.indexOf(need) >= 0; }).slice(0, 3);
      var out = [line(wantFood ? '🍲 ' : '💧 ', 'strong')];
      out[0].textContent += t('shelter.nearest');
      if (!list.length) out.push(line(t('shelter.none'), 'warn')); else list.forEach(function (x) { out.push(shelterLine(x)); });
      if (!wantFood) out.push(line(t('ins.boil_water'), 'muted small'));
      return out;
    },
    charge: function () {
      var list = SG.shelters().filter(function (x) { return x.s.status === 'open' && !x.inDanger && x.s.amenities.indexOf('power') >= 0; }).slice(0, 3);
      var out = [line('🔌 ' + t('ins.charge_phone'), 'strong')];
      list.forEach(function (x) { out.push(shelterLine(x)); });
      return out;
    }
  };

  // ------------------------------------------------------------ chat UI
  var log = [], logLang = null;
  function render() {
    var box = document.getElementById('ai-log');
    if (!box) return;
    UI.mount(box, log.map(function (m) {
      return m.who === 'me' ? h('div', { class: 'ai-msg me', attrs: { dir: 'auto' }, text: m.text }) : h('div', { class: 'ai-msg bot' }, m.nodes);
    }));
    var mine = box.querySelectorAll('.ai-msg.me');
    var last = mine[mine.length - 1];
    function scroll() { box.scrollTop = last ? last.offsetTop - box.offsetTop - 4 : box.scrollHeight; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' }); }
    scroll(); requestAnimationFrame(scroll);
  }
  function answer(text, intentOverride) {
    var intent = intentOverride || classify(text);
    var nodes;
    try { nodes = intent && SG.state ? ANSWERS[intent](norm(text)) : null; } catch (e) { nodes = null; }
    if (!nodes) nodes = [line(SG.state ? t('ai.unknown') : t('net.never'))];
    return nodes;
  }
  function ask(text, isIntent) {
    var label = isIntent ? chipLabel(text) : text;
    log.push({ who: 'me', text: label });
    log.push({ who: 'bot', nodes: answer(isIntent ? '' : text, isIntent ? text : null) });
    if (log.length > 30) log = log.slice(-30);
    render();
  }
  var CHIPS = ['injury', 'safety', 'shelter', 'alerts', 'numbers', 'transport', 'rumor', 'supplies', 'phrase'];
  function chipLabel(k) {
    return { injury: '🩹 ' + t('ph.injured'), safety: t('ai.safe'), shelter: t('shelter.nearest'), alerts: t('alerts.what'), numbers: t('hot.title'), transport: t('tr.title'), rumor: t('rumor.title'), supplies: t('ph.water'), phrase: t('phr.title') }[k] || k;
  }
  function chips() {
    return h('div', { class: 'chip-row ai-chips' }, CHIPS.map(function (k) { return h('button', { class: 'chip', text: chipLabel(k), onclick: function () { ask(k, true); } }); }));
  }

  function open(initial) {
    if (logLang !== SG.lang()) { log = []; logLang = SG.lang(); }   // old answers were in another language
    var input = h('input', { class: 'input', type: 'text', maxLength: 200, attrs: { placeholder: t('ai.placeholder'), 'aria-label': t('ai.placeholder'), enterkeyhint: 'send' } });
    function send() { var v = input.value.trim(); if (!v) return; input.value = ''; ask(v); }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    var age = SG.meta.fetchedAt ? SG.fmtAge(Math.max(60000, Date.now() - SG.meta.fetchedAt)) : '—';   // "1 min ago" reads better than "just now ago"
    UI.modal([
      h('h2', { text: '💬 ' + t('ai.title') }),
      h('p', { class: 'muted small', text: t('ai.note', { age: age }) }),
      h('div', { id: 'ai-log', class: 'ai-log' }),
      chips(),
      h('div', { class: 'ai-input' }, input, h('button', { class: 'btn primary', text: t('ai.ask'), onclick: send })),
      h('button', { class: 'btn ghost', text: t('common.close'), onclick: UI.closeModal })
    ], { cls: 'ai-modal' });
    input.focus();   // UI.modal focuses the first button; keep focus in the text box instead
    render();
    if (initial) ask(initial);
    setTimeout(function () { input.focus(); }, 50);
  }

  /** Small entry card on the Status screen. */
  function entry() {
    var input = h('input', { class: 'input', type: 'text', maxLength: 200, attrs: { placeholder: t('ai.placeholder'), 'aria-label': t('ai.title'), enterkeyhint: 'send' } });
    function go() { var v = input.value.trim(); input.value = ''; open(v || null); }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    return h('div', { class: 'card ai-entry' },
      h('div', { class: 'ai-entry-head' }, h('strong', { text: '💬 ' + t('ai.title') }), h('span', { class: 'badge open', text: '📴 ✓' })),
      h('div', { class: 'ai-input' }, input, h('button', { class: 'btn primary', text: t('ai.ask'), onclick: go })));
  }

  root.Assistant = { classify: classify, open: open, entry: entry, answer: answer, INTENTS: INTENTS };
})(typeof self !== 'undefined' ? self : this);
