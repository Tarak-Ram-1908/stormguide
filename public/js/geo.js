/*
 * StormGuide geometry helpers. Shared by the browser app, the service worker
 * and the Node server (UMD). Points are [lat, lng]. All maths is local and
 * works offline. Accuracy is ample for city-scale distances (< 100 km).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 6371.0088; // mean Earth radius, km
  var toRad = function (d) { return d * Math.PI / 180; };
  var toDeg = function (r) { return r * 180 / Math.PI; };

  function isLatLng(p) {
    return Array.isArray(p) && p.length >= 2 &&
      typeof p[0] === 'number' && typeof p[1] === 'number' &&
      isFinite(p[0]) && isFinite(p[1]) &&
      p[0] >= -90 && p[0] <= 90 && p[1] >= -180 && p[1] <= 180;
  }

  /** Great-circle distance in km (haversine). */
  function distanceKm(a, b) {
    var dLat = toRad(b[0] - a[0]);
    var dLng = toRad(b[1] - a[1]);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  /** Initial bearing from a to b, degrees clockwise from true north (0..360). */
  function bearingDeg(a, b) {
    var f1 = toRad(a[0]), f2 = toRad(b[0]), dl = toRad(b[1] - a[1]);
    var y = Math.sin(dl) * Math.cos(f2);
    var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  var CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function cardinal(deg) {
    return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }

  /** Ray casting. lat is treated as y and lng as x. Boundary counts as inside-ish (either). */
  function pointInPolygon(pt, poly) {
    if (!Array.isArray(poly) || poly.length < 3) return false;
    var x = pt[1], y = pt[0], inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][1], yi = poly[i][0], xj = poly[j][1], yj = poly[j][0];
      var intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Equirectangular projection around a reference latitude -> km plane.
  function project(p, refLat) {
    var k = Math.cos(toRad(refLat));
    return [toRad(p[1]) * R * k, toRad(p[0]) * R];
  }

  function pointSegDistKm(p, a, b, refLat) {
    var P = project(p, refLat), A = project(a, refLat), B = project(b, refLat);
    var dx = B[0] - A[0], dy = B[1] - A[1];
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    var cx = A[0] + t * dx, cy = A[1] + t * dy;
    return Math.sqrt((P[0] - cx) * (P[0] - cx) + (P[1] - cy) * (P[1] - cy));
  }

  /** 0 if inside, otherwise distance (km) to the nearest polygon edge. */
  function distanceToPolygonKm(pt, poly) {
    if (!Array.isArray(poly) || poly.length < 3) return Infinity;
    if (pointInPolygon(pt, poly)) return 0;
    var best = Infinity;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var d = pointSegDistKm(pt, poly[j], poly[i], pt[0]);
      if (d < best) best = d;
    }
    return best;
  }

  /** Distance (km) from a point to a polyline. */
  function distanceToPolylineKm(pt, line) {
    if (!Array.isArray(line) || line.length === 0) return Infinity;
    if (line.length === 1) return distanceKm(pt, line[0]);
    var best = Infinity;
    for (var i = 1; i < line.length; i++) {
      var d = pointSegDistKm(pt, line[i - 1], line[i], pt[0]);
      if (d < best) best = d;
    }
    return best;
  }

  function orient(a, b, c) {
    var v = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    return Math.abs(v) < 1e-15 ? 0 : (v > 0 ? 1 : -1);
  }
  function onSeg(a, b, c) { // c on segment ab, given collinear
    return Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]) &&
      Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]);
  }

  /** True if segment p1-p2 intersects segment q1-q2 (including touching). */
  function segmentsIntersect(p1, p2, q1, q2) {
    var o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2);
    var o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSeg(p1, p2, q1)) return true;
    if (o2 === 0 && onSeg(p1, p2, q2)) return true;
    if (o3 === 0 && onSeg(q1, q2, p1)) return true;
    if (o4 === 0 && onSeg(q1, q2, p2)) return true;
    return false;
  }

  /** Does the straight segment a-b pass through (or end inside) the polygon? */
  function segmentCrossesPolygon(a, b, poly) {
    if (!Array.isArray(poly) || poly.length < 3) return false;
    if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (segmentsIntersect(a, b, poly[j], poly[i])) return true;
    }
    return false;
  }

  /** Does segment a-b cross a polyline (e.g. a closed road)? */
  function segmentCrossesPolyline(a, b, line) {
    if (!Array.isArray(line)) return false;
    for (var i = 1; i < line.length; i++) {
      if (segmentsIntersect(a, b, line[i - 1], line[i])) return true;
    }
    return false;
  }

  /** Approximate circle as polygon (n vertices). */
  function circlePolygon(center, radiusKm, n) {
    n = n || 32;
    var out = [];
    var dLat = toDeg(radiusKm / R);
    var dLng = dLat / Math.max(Math.cos(toRad(center[0])), 1e-6);
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * i / n;
      out.push([+(center[0] + dLat * Math.sin(a)).toFixed(6), +(center[1] + dLng * Math.cos(a)).toFixed(6)]);
    }
    return out;
  }

  function polygonCentroid(poly) {
    var lat = 0, lng = 0;
    for (var i = 0; i < poly.length; i++) { lat += poly[i][0]; lng += poly[i][1]; }
    return [lat / poly.length, lng / poly.length];
  }

  /** Slippy-map tile x/y for a lat/lng at zoom z. */
  function tileXY(lat, lng, z) {
    var n = Math.pow(2, z);
    var latR = toRad(Math.max(-85.05112878, Math.min(85.05112878, lat)));
    var x = Math.floor((lng + 180) / 360 * n);
    var y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)), z: z };
  }

  /** All tiles covering a square of radiusKm around center, for each zoom in [zMin..zMax]. */
  function tilesAround(center, radiusKm, zMin, zMax) {
    var dLat = toDeg(radiusKm / R);
    var dLng = dLat / Math.max(Math.cos(toRad(center[0])), 1e-6);
    var out = [];
    for (var z = zMin; z <= zMax; z++) {
      var a = tileXY(center[0] + dLat, center[1] - dLng, z);
      var b = tileXY(center[0] - dLat, center[1] + dLng, z);
      for (var x = a.x; x <= b.x; x++) for (var y = a.y; y <= b.y; y++) out.push({ z: z, x: x, y: y });
    }
    return out;
  }

  function formatDistance(km) {
    if (!isFinite(km)) return '–';
    if (km < 1) return (Math.round(km * 1000 / 10) * 10) + ' m';
    if (km < 10) return km.toFixed(1) + ' km';
    return Math.round(km) + ' km';
  }

  var SEVERITY_RANK = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };

  return {
    isLatLng: isLatLng,
    distanceKm: distanceKm,
    bearingDeg: bearingDeg,
    cardinal: cardinal,
    pointInPolygon: pointInPolygon,
    distanceToPolygonKm: distanceToPolygonKm,
    distanceToPolylineKm: distanceToPolylineKm,
    segmentsIntersect: segmentsIntersect,
    segmentCrossesPolygon: segmentCrossesPolygon,
    segmentCrossesPolyline: segmentCrossesPolyline,
    circlePolygon: circlePolygon,
    polygonCentroid: polygonCentroid,
    tileXY: tileXY,
    tilesAround: tilesAround,
    formatDistance: formatDistance,
    SEVERITY_RANK: SEVERITY_RANK
  };
});
