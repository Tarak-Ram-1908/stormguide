/*
 * Small DOM helpers shared by all pages. Text is always set with textContent
 * (never innerHTML) so user- or authority-supplied text cannot inject markup.
 */
/* global qrcode */
(function (root) {
  'use strict';
  var UI = root.UI = {};

  /** h('div', { class: 'x', onclick: fn, text: 'hi', attrs: { href: '#' } }, child, 'text', [more]) */
  UI.h = function (tag, props) {
    var e = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'attrs') Object.keys(v).forEach(function (a) { if (v[a] != null && v[a] !== false) e.setAttribute(a, v[a]); });
      else e[k] = v;
    });
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  };
  function append(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(e, x); }); return; }
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }

  UI.clear = function (e) { while (e && e.firstChild) e.removeChild(e.firstChild); return e; };
  UI.mount = function (id) { var e = typeof id === 'string' ? document.getElementById(id) : id; UI.clear(e); for (var i = 1; i < arguments.length; i++) append(e, arguments[i]); return e; };

  var toastTimer = null;
  UI.toast = function (msg, kind, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (kind || '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3500);
  };

  var lastFocus = null;
  UI.modal = function (content, opts) {
    var m = document.getElementById('modal'), box = document.getElementById('modal-box');
    opts = opts || {};
    lastFocus = document.activeElement;
    UI.mount(box, content);
    box.className = 'modal-box ' + (opts.cls || '');
    m.hidden = false;
    m.onclick = function (e) { if (e.target === m && !opts.sticky) UI.closeModal(); };
    var f = box.querySelector('button, a, input, select, textarea');
    if (f) f.focus();
  };
  UI.closeModal = function () {
    var m = document.getElementById('modal');
    if (!m || m.hidden) return;
    m.hidden = true;
    UI.clear(document.getElementById('modal-box'));
    if (UI.onModalClose) { var f = UI.onModalClose; UI.onModalClose = null; f(); }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') UI.closeModal(); });

  /** QR code as an <svg> element (generated locally; works offline). */
  UI.qr = function (text) {
    var wrap = document.createElement('div');
    wrap.className = 'qr';
    try {
      var q = qrcode(0, text.length > 600 ? 'L' : 'M');
      q.addData(text);
      q.make();
      // createSvgTag output contains only generated geometry (no user text).
      wrap.innerHTML = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
    } catch (e) {
      wrap.textContent = 'QR too large';
    }
    return wrap;
  };

  /** base64url for UTF-8 JSON (used in QR relay links). */
  UI.b64encode = function (obj) {
    var s = unescape(encodeURIComponent(JSON.stringify(obj)));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  UI.b64decode = function (str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  };
})(typeof self !== 'undefined' ? self : this);
