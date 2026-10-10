// Local-first store. Everything lives in this browser's localStorage — no
// account, no server, no tracking. The public API is deliberately small so a
// sync backend can replace the persistence layer later without touching the UI.

import { buildSeed } from './seed.js';
import { LIMITS, clean, validateReview, validateOwnerUpdate } from './logic.js';

const KEY = 'localspit.v1';

function uid(prefix) {
  const r = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${r}`;
}

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function freshState() {
  const seed = buildSeed();
  return {
    version: 1,
    deviceId: uid('dev'), // anonymous; used only so one device = one review per spot
    spots: seed.spots,
    reviews: seed.reviews,
    lists: [],
    settings: { supporter: false, icon: 'default', pin: 'dot', lastCenter: null },
  };
}

export function createStore(storage = globalThis.localStorage ?? memoryStorage()) {
  let state;
  const listeners = new Set();

  try {
    const raw = storage.getItem(KEY);
    state = raw ? JSON.parse(raw) : null;
    if (state?.version !== 1) state = null;
  } catch {
    state = null;
  }
  state ??= freshState();

  function commit() {
    try {
      storage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private mode / quota: keep working in memory */
    }
    listeners.forEach((fn) => fn(state));
  }

  const spotById = (id) => state.spots.find((s) => s.id === id);

  return {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    spotById,
    reviewsFor: (spotId) => state.reviews.filter((r) => r.spotId === spotId),
    myReview: (spotId) => state.reviews.find((r) => r.spotId === spotId && r.deviceId === state.deviceId),

    addSpot({ name, lat, lng, chain = false }) {
      const n = clean(name, LIMITS.name);
      if (!n) throw new Error('Give the spot a name.');
      if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) throw new Error('Bad location.');
      const spot = { id: uid('spot'), name: n, lat, lng, chain: !!chain, demo: false, owner: null, createdAt: Date.now() };
      state.spots.push(spot);
      commit();
      return spot;
    },

    /** One review per device per spot: posting again edits yours, so nobody can stuff the box. */
    saveReview(spotId, input) {
      if (!spotById(spotId)) throw new Error('Unknown spot.');
      const v = validateReview(input);
      if (!v.ok) throw new Error(v.errors[0]);
      const existing = this.myReview(spotId);
      if (existing) Object.assign(existing, v.review, { at: Date.now() });
      else state.reviews.push({ id: uid('rev'), spotId, deviceId: state.deviceId, at: Date.now(), ...v.review });
      commit();
    },

    deleteMyReview(spotId) {
      state.reviews = state.reviews.filter((r) => !(r.spotId === spotId && r.deviceId === state.deviceId));
      commit();
    },

    /**
     * Owner portal: hours + daily special ONLY. By construction there is no
     * method here that can edit, hide or remove a review, or change ordering.
     */
    updateOwnerInfo(spotId, input) {
      const spot = spotById(spotId);
      if (!spot) throw new Error('Unknown spot.');
      if (spot.chain) throw new Error('The owner portal is for independent spots only.');
      spot.owner = validateOwnerUpdate(input);
      commit();
    },

    createList(name, desc = '') {
      const n = clean(name, LIMITS.listName);
      if (!n) throw new Error('Name your list.');
      const list = { id: uid('list'), name: n, desc: clean(desc, LIMITS.listDesc), spotIds: [] };
      state.lists.push(list);
      commit();
      return list;
    },

    deleteList(id) {
      state.lists = state.lists.filter((l) => l.id !== id);
      commit();
    },

    toggleInList(listId, spotId) {
      const list = state.lists.find((l) => l.id === listId);
      if (!list || !spotById(spotId)) return;
      const i = list.spotIds.indexOf(spotId);
      if (i >= 0) list.spotIds.splice(i, 1);
      else if (list.spotIds.length < LIMITS.maxListSpots) list.spotIds.push(spotId);
      commit();
    },

    /** Import a decoded shared list; unknown spots are added (without reviews). */
    importList({ name, desc, spots }) {
      const ids = [];
      for (const s of spots) {
        if (!spotById(s.id)) {
          state.spots.push({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, chain: false, demo: false, owner: null, createdAt: Date.now() });
        }
        ids.push(s.id);
      }
      const list = { id: uid('list'), name, desc, spotIds: ids };
      state.lists.push(list);
      commit();
      return list;
    },

    /** `silent` persists without notifying subscribers (used for map-pan bookkeeping). */
    setSetting(key, value, { silent = false } = {}) {
      state.settings[key] = value;
      if (silent) {
        try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
      } else commit();
    },

    clearDemo() {
      const demoIds = new Set(state.spots.filter((s) => s.demo).map((s) => s.id));
      state.spots = state.spots.filter((s) => !s.demo);
      state.reviews = state.reviews.filter((r) => !demoIds.has(r.spotId));
      state.lists.forEach((l) => (l.spotIds = l.spotIds.filter((id) => !demoIds.has(id))));
      commit();
    },
  };
}
