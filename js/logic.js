// Pure logic for LocalSpit. No DOM, no storage, no network — easy to test.
//
// Design rule baked into this file: nothing here ever takes a "sponsored",
// "paid" or "verified" input. Ordering is distance only. Summaries are built
// only from neighbor reviews.

export const LIMITS = {
  name: 50,
  get: 40,
  avoid: 40,
  price: 12,
  vibe: 24,
  maxVibesPerReview: 3,
  hours: 60,
  special: 80,
  listName: 50,
  listDesc: 100,
  maxListSpots: 50,
};

export const PRESET_VIBES = [
  'Loud & Cramped',
  'Good for Solo Eating',
  'Cash Only',
  'Portions are Massive',
  'Quiet, Bring a Book',
  'Late Night',
  'Line Is Worth It',
  'Counter Seating',
  'Great for Groups',
  'Hidden Gem',
];

export const WALK_METERS_PER_MIN = 80;
export const SPECIAL_TTL_MS = 24 * 60 * 60 * 1000;

export function clean(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "$9" -> 9, "8-10" -> 9, "free" -> null */
export function parsePrice(text) {
  const nums = String(text ?? '').match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  const vals = nums.slice(0, 2).map(Number);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function formatPrice(n) {
  if (n == null) return '';
  return '$' + (Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, ''));
}

/**
 * Validate + normalise a one-line review.
 * Returns { ok, review, errors }.
 */
export function validateReview(input) {
  const errors = [];
  const skip = !!input.skip;
  const get = clean(input.get, LIMITS.get);
  const avoid = clean(input.avoid, LIMITS.avoid);
  const price = clean(input.price, LIMITS.price);

  if (!get && !skip) errors.push('Tell us what to get (or mark it Skip It).');
  if (price && parsePrice(price) == null) errors.push('Price should be a number, like $9 or 8-10.');

  const seen = new Set();
  const vibes = [];
  for (const v of input.vibes ?? []) {
    const t = clean(v, LIMITS.vibe);
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      vibes.push(t);
    }
  }
  if (vibes.length > LIMITS.maxVibesPerReview) {
    errors.push(`Pick up to ${LIMITS.maxVibesPerReview} vibes.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    review: { get, avoid, price, vibes: vibes.slice(0, LIMITS.maxVibesPerReview), skip },
  };
}

/** Grouping key so "Carnitas taco" and "carnitas tacos!" count as one dish. */
export function dishKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

function tally(strings, keyFn) {
  const groups = new Map();
  for (const s of strings) {
    if (!s) continue;
    const key = keyFn(s);
    if (!key) continue;
    const g = groups.get(key) ?? { count: 0, forms: new Map() };
    g.count++;
    g.forms.set(s, (g.forms.get(s) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      // show the most common spelling (ties: alphabetical, so it's deterministic)
      const [name] = [...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { name, count: g.count };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Turn a spot's reviews into what the pin card shows. */
export function summarize(reviews) {
  const total = reviews.length;
  const skipVotes = reviews.filter((r) => r.skip).length;
  const vibes = tally(reviews.flatMap((r) => r.vibes ?? []), (v) => v.toLowerCase()).map((v) => ({
    tag: v.name,
    count: v.count,
  }));
  return {
    total,
    dishes: tally(reviews.map((r) => r.get), dishKey).slice(0, 3),
    avoid: tally(reviews.map((r) => r.avoid), dishKey).slice(0, 2),
    price: median(reviews.map((r) => parsePrice(r.price)).filter((p) => p != null)),
    vibes: vibes.slice(0, 4),
    skipVotes,
    // A spot is flagged only when at least 2 neighbors say skip AND they are the majority.
    isSkip: skipVotes >= 2 && skipVotes / total > 0.5,
  };
}

/* ---------- geography ---------- */

export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m) {
  if (m < 2000) return `${Math.max(1, Math.round(m / WALK_METERS_PER_MIN))} min walk`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** The ONLY ordering LocalSpit uses: nearest first. Ties break by name, never by money. */
export function sortByDistance(spots, center) {
  return spots
    .map((s) => ({ spot: s, d: distanceMeters(center, s) }))
    .sort((a, b) => a.d - b.d || a.spot.name.localeCompare(b.spot.name));
}

export function walkingDirectionsUrl(spot, from) {
  const route = from ? `${from.lat},${from.lng};` : ';';
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${route}${spot.lat},${spot.lng}`;
}

/* ---------- filtering ---------- */

/**
 * @param entries [{ spot, summary }]
 * @param f { q: string, vibes: string[], skipMode: 'all' | 'hide' | 'only' }
 */
export function filterEntries(entries, f = {}) {
  const q = (f.q ?? '').trim().toLowerCase();
  const wanted = (f.vibes ?? []).map((v) => v.toLowerCase());
  return entries.filter(({ spot, summary }) => {
    if (f.skipMode === 'hide' && summary.isSkip) return false;
    if (f.skipMode === 'only' && !summary.isSkip) return false;
    if (wanted.length) {
      const have = summary.vibes.map((v) => v.tag.toLowerCase());
      if (!wanted.every((w) => have.includes(w))) return false;
    }
    if (q) {
      const hay = [spot.name, ...summary.dishes.map((d) => d.name), ...summary.vibes.map((v) => v.tag)]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- owner portal ---------- */

export function validateOwnerUpdate(input, now = Date.now()) {
  return {
    hours: clean(input.hours, LIMITS.hours),
    special: clean(input.special, LIMITS.special),
    specialAt: now,
  };
}

/** The blackboard special disappears after 24h so it can't go stale. */
export function freshSpecial(owner, now = Date.now()) {
  if (!owner?.special) return '';
  return now - (owner.specialAt ?? 0) <= SPECIAL_TTL_MS ? owner.special : '';
}

/* ---------- sharing lists via link (no server, no accounts) ---------- */

function toB64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeList(list, spotsById) {
  const spots = list.spotIds
    .map((id) => spotsById.get(id))
    .filter(Boolean)
    .map((s) => ({ i: s.id, n: s.name, y: +s.lat.toFixed(5), x: +s.lng.toFixed(5) }));
  return toB64Url(JSON.stringify({ v: 1, n: list.name, d: list.desc ?? '', s: spots }));
}

/** Returns { name, desc, spots:[{id,name,lat,lng}] } or null if the payload is junk. */
export function decodeList(payload) {
  try {
    const obj = JSON.parse(fromB64Url(payload));
    if (!obj || obj.v !== 1 || !Array.isArray(obj.s)) return null;
    const spots = [];
    for (const s of obj.s.slice(0, LIMITS.maxListSpots)) {
      const lat = Number(s.y);
      const lng = Number(s.x);
      const name = clean(s.n, LIMITS.name);
      const id = clean(s.i, 64);
      if (!name || !id || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) continue;
      spots.push({ id, name, lat, lng });
    }
    const name = clean(obj.n, LIMITS.listName);
    if (!name) return null;
    return { name, desc: clean(obj.d, LIMITS.listDesc), spots };
  } catch {
    return null;
  }
}
