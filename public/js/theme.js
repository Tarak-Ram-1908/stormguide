/*
 * Display mode: "normal" (follows the phone's light/dark setting) or "sun"
 * (pure black on white, bold, larger text, no grey: readable in direct sunlight
 * at low screen brightness, e.g. when the battery is low).
 * Loaded in <head> so the saved mode applies before the first paint.
 */
(function (root) {
  'use strict';
  var KEY = 'sg.theme', html = document.documentElement;
  function get() { try { return localStorage.getItem(KEY) === 'sun' ? 'sun' : 'normal'; } catch (e) { return 'normal'; } }
  function apply(mode) {
    if (mode === 'sun') html.setAttribute('data-theme', 'sun'); else html.removeAttribute('data-theme');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'sun' ? '#ffffff' : '#0c264a');
    var b = document.getElementById('sun-btn');
    if (b) b.setAttribute('aria-pressed', mode === 'sun' ? 'true' : 'false');
  }
  function set(mode) { try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode: still apply for this visit */ } apply(mode); return mode; }
  function toggle() { return set(get() === 'sun' ? 'normal' : 'sun'); }
  apply(get());
  document.addEventListener('DOMContentLoaded', function () { apply(get()); });
  root.SGTheme = { get: get, set: set, toggle: toggle };
})(this);
