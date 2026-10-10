'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../public/js/geo.js');

const square = [[13.00, 80.20], [13.00, 80.22], [12.98, 80.22], [12.98, 80.20]];

test('distanceKm: Chennai Central to Chennai airport is about 15 km', () => {
  const d = Geo.distanceKm([13.0827, 80.2707], [12.9941, 80.1709]);
  assert.ok(d > 14 && d < 16, String(d));
});

test('pointInPolygon inside / outside', () => {
  assert.equal(Geo.pointInPolygon([12.99, 80.21], square), true);
  assert.equal(Geo.pointInPolygon([13.01, 80.21], square), false);
  assert.equal(Geo.pointInPolygon([12.99, 80.21], [[1, 1], [2, 2]]), false, 'degenerate polygon');
});

test('distanceToPolygonKm is 0 inside and ~1.1 km for 0.01 deg north', () => {
  assert.equal(Geo.distanceToPolygonKm([12.99, 80.21], square), 0);
  const d = Geo.distanceToPolygonKm([13.01, 80.21], square);
  assert.ok(d > 1.0 && d < 1.2, String(d));
});

test('segmentCrossesPolygon detects a straight line through a flood zone', () => {
  assert.equal(Geo.segmentCrossesPolygon([12.99, 80.19], [12.99, 80.23], square), true);
  assert.equal(Geo.segmentCrossesPolygon([13.01, 80.19], [13.01, 80.23], square), false);
  assert.equal(Geo.segmentCrossesPolygon([12.99, 80.21], [13.05, 80.30], square), true, 'starting inside counts');
});

test('segmentCrossesPolyline detects a closed road', () => {
  const road = [[12.99, 80.20], [12.99, 80.25]];
  assert.equal(Geo.segmentCrossesPolyline([12.98, 80.22], [13.00, 80.22], road), true);
  assert.equal(Geo.segmentCrossesPolyline([13.00, 80.22], [13.01, 80.22], road), false);
});

test('bearing and cardinal direction', () => {
  assert.equal(Geo.cardinal(Geo.bearingDeg([13, 80], [13.1, 80])), 'N');
  assert.equal(Geo.cardinal(Geo.bearingDeg([13, 80], [13, 80.1])), 'E');
  assert.equal(Geo.cardinal(Geo.bearingDeg([13, 80], [12.9, 79.9])), 'SW');
  assert.equal(Geo.cardinal(359), 'N');
});

test('circlePolygon radius is respected', () => {
  const c = [13.04, 80.23];
  const poly = Geo.circlePolygon(c, 0.5, 24);
  assert.equal(poly.length, 24);
  poly.forEach((p) => { const d = Geo.distanceKm(c, p); assert.ok(Math.abs(d - 0.5) < 0.01, String(d)); });
  assert.equal(Geo.pointInPolygon(c, poly), true);
});

test('tilesAround covers the centre tile and stays small', () => {
  const tiles = Geo.tilesAround([13.04, 80.23], 2, 13, 16);
  const centre = Geo.tileXY(13.04, 80.23, 16);
  assert.ok(tiles.some(t => t.z === 16 && t.x === centre.x && t.y === centre.y));
  assert.ok(tiles.length < 450, String(tiles.length));
});

test('formatDistance', () => {
  assert.equal(Geo.formatDistance(0.234), '230 m');
  assert.equal(Geo.formatDistance(2.345), '2.3 km');
  assert.equal(Geo.formatDistance(23.4), '23 km');
  assert.equal(Geo.formatDistance(Infinity), '–');
});
