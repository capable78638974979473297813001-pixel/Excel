import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryStorage } from '../js/store.js';

const spotInput = { name: 'Test Diner', lat: 45.5, lng: -122.6 };

test('one review per device per spot — posting again edits', () => {
  const s = createStore(memoryStorage());
  const spot = s.addSpot(spotInput);
  s.saveReview(spot.id, { get: 'pancakes', price: '$8' });
  s.saveReview(spot.id, { get: 'waffles', price: '$9' });
  const mine = s.reviewsFor(spot.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].get, 'waffles');
});

test('bad review is rejected', () => {
  const s = createStore(memoryStorage());
  const spot = s.addSpot(spotInput);
  assert.throws(() => s.saveReview(spot.id, { get: '' }));
  assert.throws(() => s.saveReview(spot.id, { get: 'x', price: 'cheap' }));
});

test('persists across reloads', () => {
  const storage = memoryStorage();
  const a = createStore(storage);
  const spot = a.addSpot(spotInput);
  a.saveReview(spot.id, { get: 'pancakes' });
  const b = createStore(storage);
  assert.equal(b.state.deviceId, a.state.deviceId);
  assert.equal(b.reviewsFor(spot.id).length, 1);
});

test('corrupt storage falls back to a fresh state', () => {
  const storage = memoryStorage();
  storage.setItem('localspit.v1', '{not json');
  assert.ok(createStore(storage).state.spots.length > 0);
});

test('owner portal edits hours/special only, never reviews; chains excluded', () => {
  const s = createStore(memoryStorage());
  const spot = s.addSpot(spotInput);
  s.saveReview(spot.id, { get: 'x', skip: true });
  s.updateOwnerInfo(spot.id, { hours: '9-5', special: 'Soup', reviews: [], hidden: true, sponsored: true });
  assert.equal(s.reviewsFor(spot.id).length, 1);
  assert.deepEqual(Object.keys(s.spotById(spot.id).owner).sort(), ['hours', 'special', 'specialAt']);
  const chain = s.addSpot({ ...spotInput, chain: true });
  assert.throws(() => s.updateOwnerInfo(chain.id, { hours: '9-5' }));
});

test('lists: create, toggle, import creates missing spots', () => {
  const s = createStore(memoryStorage());
  const spot = s.addSpot(spotInput);
  const list = s.createList('Best tacos');
  s.toggleInList(list.id, spot.id);
  assert.deepEqual(s.state.lists[0].spotIds, [spot.id]);
  s.toggleInList(list.id, spot.id);
  assert.deepEqual(s.state.lists[0].spotIds, []);
  const before = s.state.spots.length;
  s.importList({ name: 'Shared', desc: '', spots: [{ id: 'x1', name: 'Far Away', lat: 1, lng: 2 }] });
  assert.equal(s.state.spots.length, before + 1);
});

test('clearDemo removes demo spots and their reviews only', () => {
  const s = createStore(memoryStorage());
  const mine = s.addSpot(spotInput);
  s.saveReview(mine.id, { get: 'a' });
  s.clearDemo();
  assert.deepEqual(s.state.spots.map((x) => x.id), [mine.id]);
  assert.equal(s.state.reviews.length, 1);
});
