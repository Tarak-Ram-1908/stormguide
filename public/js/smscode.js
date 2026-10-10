/*
 * Builds the coded SMS used when there is mobile signal but no internet.
 * Shared by the browser app and the server tests (UMD) so both sides agree.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmsCode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TYPE_TO_CODE = { flooding: 'FLOOD', road_blocked: 'ROAD', power_line: 'POWER', trapped: 'TRAP', injury: 'INJ', building_damage: 'BLDG', other: 'OTHER' };
  var SIT_TO_CODE = { trapped: 'TRAP', injured: 'INJ', water_rising: 'WATER', medical: 'MED', other: 'OTHER' };

  function build(kind, d) {
    var coords = (d.lat != null && d.lng != null) ? Number(d.lat).toFixed(5) + ',' + Number(d.lng).toFixed(5) : '';
    var note = String(d.note || '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    var parts = kind === 'sos'
      ? ['SOS', coords, d.people ? 'P:' + d.people : '', d.situation ? 'S:' + (SIT_TO_CODE[d.situation] || 'OTHER') : '', d.lang ? 'L:' + d.lang : '', d.id ? 'ID:' + d.id : '', note]
      : ['RPT', TYPE_TO_CODE[d.type] || 'OTHER', coords, d.lang ? 'L:' + d.lang : '', d.id ? 'ID:' + d.id : '', note];
    return parts.filter(Boolean).join(' ');
  }

  /** sms: URI. iOS uses '&body=', Android accepts '?body='. '?&body=' is understood by both. */
  function uri(number, body) {
    return 'sms:' + encodeURIComponent(number || '') + '?&body=' + encodeURIComponent(body);
  }

  return { build: build, uri: uri, TYPE_TO_CODE: TYPE_TO_CODE, SIT_TO_CODE: SIT_TO_CODE };
});
