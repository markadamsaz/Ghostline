// Ghostline geometry helpers. Points are [lat, lng]. Distances in meters.
export const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function dist(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Local flat projection around an origin, good for areas a few km wide.
export function toXY(p, o) {
  return [rad(p[1] - o[1]) * R * Math.cos(rad(o[0])), rad(p[0] - o[0]) * R];
}
export function fromXY(xy, o) {
  return [o[0] + (xy[1] / R) * (180 / Math.PI), o[1] + (xy[0] / (R * Math.cos(rad(o[0])))) * (180 / Math.PI)];
}

export function centroid(pts) {
  let a = 0, b = 0;
  for (const p of pts) { a += p[0]; b += p[1]; }
  return [a / pts.length, b / pts.length];
}

export function zoneCenter(z) {
  return z.type === 'circle' ? z.c : centroid(z.pts);
}

export function scaleZone(z, s) {
  if (!z) return z;
  if (s >= 0.999) return z;
  if (z.type === 'circle') return { ...z, r: z.r * s };
  const o = centroid(z.pts);
  return { ...z, pts: z.pts.map((p) => { const [x, y] = toXY(p, o); return fromXY([x * s, y * s], o); }) };
}

function pointInPoly(xy, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > xy[1]) !== (yj > xy[1]) && xy[0] < ((xj - xi) * (xy[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Signed distance to the zone edge: positive inside, negative outside.
export function edgeDistance(p, z) {
  if (!z) return Infinity;
  if (z.type === 'circle') return z.r - dist(p, z.c);
  const o = centroid(z.pts);
  const poly = z.pts.map((q) => toXY(q, o));
  const xy = toXY(p, o);
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) m = Math.min(m, segDist(xy, poly[j], poly[i]));
  return pointInPoly(xy, poly) ? m : -m;
}

// The closest point on the zone edge to p (the quickest way back in when you're outside).
export function nearestEdgePoint(p, z) {
  if (!z) return null;
  if (z.type === 'circle') {
    const d = dist(p, z.c);
    if (!d) return z.c;
    const [x, y] = toXY(p, z.c), k = z.r / d;
    return fromXY([x * k, y * k], z.c);
  }
  const o = centroid(z.pts);
  const poly = z.pts.map((q) => toXY(q, o));
  const [px, py] = toXY(p, o);
  let best = null, bd = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
    const q = [a[0] + t * dx, a[1] + t * dy], dd = Math.hypot(px - q[0], py - q[1]);
    if (dd < bd) { bd = dd; best = q; }
  }
  return fromXY(best, o);
}

export function inZone(p, z) {
  return edgeDistance(p, z) >= 0;
}

export function randomInDisk(p, r) {
  if (!r) return p.slice();
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r;
  return fromXY([Math.cos(a) * d, Math.sin(a) * d], p);
}

export function zoneArea(z) {
  if (!z) return 0;
  if (z.type === 'circle') return Math.PI * z.r * z.r;
  const o = centroid(z.pts);
  const poly = z.pts.map((q) => toXY(q, o));
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a / 2);
}

export function fmtDist(m) {
  if (!isFinite(m)) return '';
  m = Math.abs(m);
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
}
