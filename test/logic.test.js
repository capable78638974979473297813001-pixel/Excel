import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, validateReview, summarize, parsePrice, formatPrice, dishKey, sortByDistance,
  distanceMeters, filterEntries, freshSpecial, SPECIAL_TTL_MS, encodeList, decodeList, formatDistance,
} from '../js/logic.js';

test('parsePrice handles $, ranges, junk', () => {
  assert.equal(parsePrice('$9'), 9);
  assert.equal(parsePrice('8-10'), 9);
  assert.equal(parsePrice('$4.50'), 4.5);
  assert.equal(parsePrice('free'), null);
  assert.equal(formatPrice(9), '$9');
  assert.equal(formatPrice(4.5), '$4.5');
});

test('review limits are strict', () => {
  const v = validateReview({ get: 'x'.repeat(200), avoid: 'y'.repeat(200), price: '$9' });
  assert.equal(v.review.get.length, LIMITS.get);
  assert.equal(v.review.avoid.length, LIMITS.avoid);
});

test('review needs a dish unless it is a skip', () => {
  assert.equal(validateReview({ get: '', price: '$5' }).ok, false);
  assert.equal(validateReview({ get: '', skip: true }).ok, true);
});

test('review rejects non-numeric price and >3 vibes', () => {
  assert.equal(validateReview({ get: 'a', price: 'cheap' }).ok, false);
  assert.equal(validateReview({ get: 'a', vibes: ['a', 'b', 'c', 'd'] }).ok, false);
  assert.deepEqual(validateReview({ get: 'a', vibes: ['Loud', 'loud'] }).review.vibes, ['Loud']);
});

test('dishKey merges plurals and punctuation', () => {
  assert.equal(dishKey('Carnitas tacos!'), dishKey('carnitas taco'));
});

test('summarize: top 3 dishes, median price, vibes', () => {
  const rs = [
    { get: 'carnitas taco', price: '$8', vibes: ['Cash Only'] },
    { get: 'carnitas tacos', price: '$10', vibes: ['Cash Only'] },
    { get: 'al pastor', price: '$9', vibes: [] },
    { get: 'horchata', price: '', vibes: [] },
    { get: 'flan', price: '', vibes: [] },
  ];
  const s = summarize(rs);
  assert.equal(s.dishes.length, 3);
  assert.equal(s.dishes[0].count, 2);
  assert.equal(s.price, 9);
  assert.equal(s.vibes[0].tag, 'Cash Only');
});

test('skip flag needs 2+ votes AND a majority', () => {
  assert.equal(summarize([{ get: '', skip: true }]).isSkip, false);
  assert.equal(summarize([{ get: '', skip: true }, { get: '', skip: true }]).isSkip, true);
  assert.equal(summarize([{ skip: true }, { skip: true }, { get: 'a' }, { get: 'b' }]).isSkip, false);
});

test('ordering is distance only, with a stable name tiebreak', () => {
  const center = { lat: 0, lng: 0 };
  const spots = [
    { id: 'b', name: 'B', lat: 0, lng: 0.01 },
    { id: 'a', name: 'A', lat: 0, lng: 0.001 },
    { id: 'c', name: 'C', lat: 0, lng: 0.001 },
    { id: 'z', name: 'Z', lat: 0, lng: 0.01, sponsored: true, owner: { paid: true } },
  ];
  assert.deepEqual(sortByDistance(spots, center).map((x) => x.spot.id), ['a', 'c', 'b', 'z']);
});

test('distance and walking label', () => {
  const d = distanceMeters({ lat: 45.5, lng: -122.6 }, { lat: 45.5, lng: -122.599 });
  assert.ok(d > 70 && d < 90);
  assert.equal(formatDistance(160), '2 min walk');
  assert.equal(formatDistance(3500), '3.5 km');
});

test('filters: skip modes, vibes, search', () => {
  const mk = (name, rs) => ({ spot: { name }, summary: summarize(rs) });
  const entries = [
    mk('Taco Spot', [{ get: 'carnitas', vibes: ['Cash Only'] }]),
    mk('Bad Place', [{ get: '', skip: true }, { get: '', skip: true }]),
  ];
  assert.equal(filterEntries(entries, { skipMode: 'hide' }).length, 1);
  assert.equal(filterEntries(entries, { skipMode: 'only' })[0].spot.name, 'Bad Place');
  assert.equal(filterEntries(entries, { vibes: ['cash only'] }).length, 1);
  assert.equal(filterEntries(entries, { q: 'carnit' })[0].spot.name, 'Taco Spot');
  assert.equal(filterEntries(entries, { q: 'nothing' }).length, 0);
});

test('blackboard special expires after 24h', () => {
  const now = 1_000_000_000;
  assert.equal(freshSpecial({ special: 'Soup', specialAt: now - 1000 }, now), 'Soup');
  assert.equal(freshSpecial({ special: 'Soup', specialAt: now - SPECIAL_TTL_MS - 1 }, now), '');
  assert.equal(freshSpecial(null, now), '');
});

test('shared list round-trips, including unicode', () => {
  const spots = new Map([['s1', { id: 's1', name: 'Tía Lupe’s', lat: 45.52345, lng: -122.67654 }]]);
  const code = encodeList({ name: 'Late-night tacos < $10', desc: 'ñ', spotIds: ['s1', 'missing'] }, spots);
  const back = decodeList(code);
  assert.equal(back.name, 'Late-night tacos < $10');
  assert.equal(back.spots.length, 1);
  assert.equal(back.spots[0].name, 'Tía Lupe’s');
});

test('decodeList rejects junk and bad coordinates', () => {
  assert.equal(decodeList('not-base64!!'), null);
  const bad = btoa(JSON.stringify({ v: 1, n: 'x', s: [{ i: 'a', n: 'A', y: 999, x: 0 }] }));
  assert.deepEqual(decodeList(bad).spots, []);
});
