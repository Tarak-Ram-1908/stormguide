/*
 * StormGuide i18n engine (UMD: browser + Node).
 *
 * Safety design: official alerts are never machine-translated. Authorities pick
 * instructions from a FIXED vocabulary (ins.*, ev.*, sev.* ...). Each entry is
 * pre-translated here, so a translation can never invent, drop or soften a
 * fact. The authority's own free text is always shown verbatim as "original".
 * Missing keys fall back to English, then to the key itself (never blank).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(true);
  else root.I18N = factory(false);
})(typeof self !== 'undefined' ? self : this, function (isNode) {
  'use strict';

  var LANGS = [
    { code: 'en', name: 'English', dir: 'ltr', tts: 'en-IN' },
    { code: 'ta', name: 'தமிழ்', dir: 'ltr', tts: 'ta-IN' },
    { code: 'hi', name: 'हिन्दी', dir: 'ltr', tts: 'hi-IN' },
    { code: 'te', name: 'తెలుగు', dir: 'ltr', tts: 'te-IN' },
    { code: 'fr', name: 'Français', dir: 'ltr', tts: 'fr-FR' },
    { code: 'de', name: 'Deutsch', dir: 'ltr', tts: 'de-DE' },
    { code: 'es', name: 'Español', dir: 'ltr', tts: 'es-ES' },
    { code: 'zh', name: '中文', dir: 'ltr', tts: 'zh-CN' },
    { code: 'ja', name: '日本語', dir: 'ltr', tts: 'ja-JP' },
    { code: 'ar', name: 'العربية', dir: 'rtl', tts: 'ar-SA' }
  ];

  // Fixed vocabularies. The server validates authority input against these.
  var VOCAB = {
    events: ['heavy_rain', 'flood', 'cyclone', 'storm_surge', 'heatwave', 'landslide'],
    severities: ['Minor', 'Moderate', 'Severe', 'Extreme'],
    msgTypes: ['Alert', 'Update', 'Cancel'],
    instructions: ['move_higher', 'avoid_water', 'stay_indoors', 'go_shelter', 'avoid_coast',
      'power_lines', 'charge_phone', 'keep_supplies', 'follow_officials', 'no_travel',
      'evacuate', 'boil_water', 'check_transport', 'heat_care', 'all_clear'],
    zoneKinds: ['flooded', 'unsafe', 'safe'],
    reportTypes: ['flooding', 'road_blocked', 'power_line', 'trapped', 'injury', 'building_damage', 'other'],
    reportStatus: ['unverified', 'verified', 'false', 'resolved'],
    situations: ['trapped', 'injured', 'water_rising', 'medical', 'other'],
    sosStatus: ['new', 'ack', 'dispatched', 'resolved'],
    shelterStatus: ['open', 'full', 'closed'],
    transportStatus: ['normal', 'delayed', 'suspended'],
    transportModes: ['metro', 'train', 'bus', 'airport'],
    rumorVerdicts: ['false', 'true', 'unverified'],
    rumorTopics: ['dam_burst', 'airport_closed', 'transport_stopped', 'water_unsafe', 'power_off',
      'shelter_full', 'evacuate_all', 'other'],
    phrases: ['help', 'shelter', 'flooded', 'injured', 'water', 'call112', 'nolang', 'hospital', 'charge', 'lost']
  };

  // Phrase cards in the local language (Tamil for the Chennai scenario).
  // The meaning line is translated into the traveller's language via ph.<id>.
  var PHRASES_LOCAL = {
    ta: {
      help: ['எனக்கு உதவி தேவை', 'Enakku udhavi thevai'],
      shelter: ['அருகிலுள்ள நிவாரண முகாம் எங்கே?', 'Arugilulla nivaarana mugaam enge?'],
      flooded: ['இந்த சாலையில் வெள்ளம் உள்ளதா?', 'Indha saalaiyil vellam ulladhaa?'],
      injured: ['எனக்கு காயம் ஏற்பட்டுள்ளது', 'Enakku kaayam erpattulladhu'],
      water: ['எனக்கு குடிநீர் வேண்டும்', 'Enakku kudineer vendum'],
      call112: ['தயவுசெய்து 112-ஐ அழைக்கவும்', 'Thayavuseydhu nooru-panniranda azhaikkavum'],
      nolang: ['எனக்கு தமிழ் தெரியாது', 'Enakku Tamizh theriyaadhu'],
      hospital: ['மருத்துவமனை எங்கே?', 'Maruthuvamanai enge?'],
      charge: ['என் கைபேசியை சார்ஜ் செய்யலாமா?', 'En kaipesiyai charge seyyalaamaa?'],
      lost: ['நான் வழி தவறிவிட்டேன்', 'Naan vazhi thavarivitten']
    }
  };

  var DICT = {};

  function add(code, dict) { DICT[code] = Object.assign(DICT[code] || {}, dict); }

  function lookup(lang, key) {
    var d = DICT[lang];
    if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    if (DICT.en && Object.prototype.hasOwnProperty.call(DICT.en, key)) return DICT.en[key];
    return null;
  }

  function t(lang, key, vars) {
    var s = lookup(lang, key);
    if (s == null) s = key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
      });
    }
    return s;
  }

  function has(lang, key) { return !!(DICT[lang] && Object.prototype.hasOwnProperty.call(DICT[lang], key)); }

  function langInfo(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return LANGS[0];
  }

  /** Pick the best supported language from a list like navigator.languages. */
  function detect(preferred) {
    var list = Array.isArray(preferred) ? preferred : [preferred];
    for (var i = 0; i < list.length; i++) {
      var c = String(list[i] || '').toLowerCase().split('-')[0];
      for (var j = 0; j < LANGS.length; j++) if (LANGS[j].code === c) return c;
    }
    return 'en';
  }

  /** Translate the structured part of an alert: never touches the official free text. */
  function translateAlert(alert, lang) {
    return {
      event: t(lang, 'ev.' + alert.event),
      severity: t(lang, 'sev.' + alert.severity),
      instructions: (alert.instructions || []).map(function (k) { return t(lang, 'ins.' + k); }),
      original: { headline: alert.headline || '', description: alert.description || '', lang: alert.originalLang || 'en' }
    };
  }

  var api = {
    LANGS: LANGS, VOCAB: VOCAB, PHRASES_LOCAL: PHRASES_LOCAL,
    add: add, t: t, has: has, langInfo: langInfo, detect: detect, translateAlert: translateAlert,
    _dict: DICT
  };

  if (isNode) {
    // Load all language packs so the server can reply to SMS in the sender's language.
    LANGS.forEach(function (l) { add(l.code, require('./i18n/' + l.code + '.js')); });
  }
  return api;
});
