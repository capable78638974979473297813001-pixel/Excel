// LocalSpit UI. All user-supplied text is rendered with textContent (via h()),
// never innerHTML — shared list links are untrusted input.

import { createStore } from './store.js';
import { DEFAULT_CENTER } from './seed.js';
import {
  LIMITS, PRESET_VIBES, summarize, filterEntries, sortByDistance, formatDistance, formatPrice,
  walkingDirectionsUrl, validateReview, freshSpecial, encodeList, decodeList, distanceMeters,
} from './logic.js';

const store = createStore();
const L = window.L;
const $ = (id) => document.getElementById(id);

const ui = {
  selectedId: null,
  q: '',
  vibes: new Set(),
  skipMode: 'all',
  adding: false,
  me: null,
  view: 'nearby', // 'nearby' | 'spot'
};

/* ---------- tiny DOM helper ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  return fill(el, ...kids);
}

/** Append children, skipping null/false and flattening nested arrays (so `cond && node` is safe). */
function fill(el, ...kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Replace an element's children (same null/false/array handling as h()). */
function refill(el, ...kids) {
  el.replaceChildren();
  return fill(el, ...kids);
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------- retro supporter perks ---------- */
const ICONS = {
  default: ['#e8590c', '#fff', 'Classic'],
  neon: ['#0b0b2b', '#ff4fd8', 'Neon'],
  diner: ['#1c7ed6', '#fff3bf', 'Diner'],
  matchbook: ['#c92a2a', '#fff', 'Matchbook'],
};
const PINS = { dot: 'Drop', sign: 'Diner sign', plate: 'Plate' };

function applyPerks() {
  const { supporter, icon, pin } = store.state.settings;
  const [bg, fg] = ICONS[supporter ? icon : 'default'] ?? ICONS.default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><path d="M32 12a14 14 0 0 0-14 14c0 11 14 26 14 26s14-15 14-26A14 14 0 0 0 32 12zm0 19a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" fill="${fg}"/></svg>`;
  $('favicon').href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  document.body.classList.remove('pin-sign', 'pin-plate');
  if (supporter && pin !== 'dot') document.body.classList.add('pin-' + pin);
}

/* ---------- map ---------- */
const startCenter = store.state.settings.lastCenter ?? DEFAULT_CENTER;
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([startCenter.lat, startCenter.lng], 16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const pinLayer = L.layerGroup().addTo(map);
let meMarker = null;
const markers = new Map();

function pinIcon(cls) {
  return L.divIcon({ className: 'pin ' + cls, html: '<i></i>', iconSize: [28, 28], iconAnchor: [14, 26] });
}

function entriesAll() {
  return store.state.spots.map((spot) => ({ spot, summary: summarize(store.reviewsFor(spot.id)) }));
}

function visibleEntries() {
  return filterEntries(entriesAll(), { q: ui.q, vibes: [...ui.vibes], skipMode: ui.skipMode });
}

function drawPins() {
  pinLayer.clearLayers();
  markers.clear();
  const shown = visibleEntries();
  const ids = new Set(shown.map((e) => e.spot.id));
  for (const { spot, summary } of entriesAll()) {
    if (!ids.has(spot.id) && spot.id !== ui.selectedId) continue;
    const cls = [summary.isSkip && 'skip', spot.demo && 'demo', spot.id === ui.selectedId && 'sel'].filter(Boolean).join(' ');
    const m = L.marker([spot.lat, spot.lng], { icon: pinIcon(cls), title: spot.name, keyboard: true });
    m.on('click', () => selectSpot(spot.id, false));
    m.addTo(pinLayer);
    markers.set(spot.id, m);
  }
}

function mapCenter() {
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng };
}

map.on('moveend', () => {
  store.setSetting('lastCenter', mapCenter(), { silent: true });
  if (ui.view === 'nearby') renderSheet(); // list is ordered by distance from the map center
});
map.on('click', (e) => {
  if (ui.adding) {
    setAdding(false);
    reviewDialog(null, { lat: e.latlng.lat, lng: e.latlng.lng });
  } else if (ui.view === 'spot') {
    showNearby();
  }
});

function locate(recenter = true) {
  if (!navigator.geolocation) return toast('Location isn’t available in this browser.');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      ui.me = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (meMarker) meMarker.setLatLng([ui.me.lat, ui.me.lng]);
      else meMarker = L.marker([ui.me.lat, ui.me.lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(map);
      if (recenter) map.setView([ui.me.lat, ui.me.lng], 16);
      render();
    },
    () => recenter && toast('Couldn’t get your location — pan the map instead.'),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
  );
}

/* ---------- selection / views ---------- */
function selectSpot(id, pan = true) {
  ui.selectedId = id;
  ui.view = 'spot';
  const s = store.spotById(id);
  if (s && pan) map.panTo([s.lat, s.lng]);
  render();
  $('sheet').scrollTop = 0;
}
function showNearby() {
  ui.selectedId = null;
  ui.view = 'nearby';
  render();
}

function setAdding(on) {
  ui.adding = on;
  document.body.classList.toggle('adding', on);
  const b = $('banner');
  b.hidden = !on;
  if (on) b.replaceChildren('Tap the map to drop a pin', h('button', { onclick: () => setAdding(false) }, 'Cancel'));
}

/* ---------- sheet rendering ---------- */
function distLabel(spot) {
  const from = ui.me ?? mapCenter();
  return formatDistance(distanceMeters(from, spot)) + (ui.me ? '' : ' from map center');
}

function renderNearby() {
  const entries = visibleEntries();
  const byId = new Map(entries.map((e) => [e.spot.id, e]));
  const sorted = sortByDistance(entries.map((e) => e.spot), mapCenter()).slice(0, 30);
  const hasDemo = store.state.spots.some((s) => s.demo);

  return h('div', {},
    h('div', { class: 'row' }, h('h2', {}, 'Nearby'), h('span', { class: 'sub' }, 'Nearest first. Nothing else.')),
    hasDemo && h('p', { class: 'sub' }, 'Pins marked DEMO are made-up examples. ',
      h('button', { class: 'back', onclick: () => { store.clearDemo(); toast('Demo data cleared'); } }, 'Clear them')),
    sorted.length === 0 && h('p', { class: 'empty' }, entriesAll().length ? 'No spots match your filters.' : 'No neighbors have posted here yet. Tap ＋ and be the first.'),
    sorted.map(({ spot, d }) => {
      const { summary } = byId.get(spot.id);
      const top = summary.dishes[0];
      return h('button', { class: 'spot-row', onclick: () => selectSpot(spot.id) },
        h('div', { class: 'name' }, spot.name,
          summary.isSkip && h('span', { class: 'badge skip' }, 'Skip it'),
          spot.demo && h('span', { class: 'badge demo' }, 'Demo')),
        h('div', { class: 'meta' }, [
          formatDistance(d) + ' from map center',
          top ? `Get: ${top.name}` : summary.isSkip ? 'Neighbors say skip' : 'No dish yet',
          summary.price != null ? `~${formatPrice(summary.price)}` : null,
        ].filter(Boolean).join(' · ')));
    }));
}

function renderSpot() {
  const spot = store.spotById(ui.selectedId);
  if (!spot) return renderNearby();
  const reviews = store.reviewsFor(spot.id);
  const s = summarize(reviews);
  const mine = store.myReview(spot.id);
  const special = freshSpecial(spot.owner);
  const recent = [...reviews].sort((a, b) => b.at - a.at).slice(0, 5);

  return h('div', {},
    h('button', { class: 'back', onclick: showNearby }, '← Nearby'),
    h('h2', {}, spot.name,
      spot.demo && h('span', { class: 'badge demo' }, 'Demo'),
      h('span', { class: 'badge' }, spot.chain ? 'Chain' : 'Independent')),
    h('div', { class: 'sub' }, distLabel(spot) + ` · ${s.total} neighbor${s.total === 1 ? '' : 's'} weighed in`),

    s.isSkip && h('div', { class: 'skip-box' }, `🚫 ${s.skipVotes} of ${s.total} neighbors say skip it.`),

    h('h3', {}, 'Get this'),
    s.dishes.length
      ? s.dishes.map((d, i) => h('div', { class: 'dish' }, h('b', {}, `${i + 1}. ${d.name}`), h('small', {}, d.count > 1 ? `${d.count} neighbors` : '1 neighbor')))
      : h('div', { class: 'empty' }, 'Nobody has named a dish yet.'),

    s.avoid.length > 0 && [
      h('h3', {}, 'Avoid this'),
      s.avoid.map((a) => h('div', { class: 'dish avoid' }, h('b', {}, a.name), h('small', {}, a.count > 1 ? `${a.count} neighbors` : ''))),
    ],

    s.price != null && [h('h3', {}, 'The real price'), h('div', { class: 'dish' }, h('b', {}, `~${formatPrice(s.price)}`), h('small', {}, 'typical, per neighbors'))],

    s.vibes.length > 0 && [h('h3', {}, 'Vibe'), h('div', {}, s.vibes.map((v) => h('span', { class: 'tag' }, v.count > 1 ? `${v.tag} ×${v.count}` : v.tag)))],

    (spot.owner?.hours || special) && h('div', { class: 'owner-box' },
      spot.owner.hours && h('div', {}, '🕒 ', spot.owner.hours),
      special && h('div', {}, '🪧 Today: ', special),
      h('small', {}, 'From the owner. Owners can post hours & specials — they can’t touch reviews or ranking.')),

    recent.length > 0 && [
      h('h3', {}, 'Latest one-liners'),
      recent.map((r) => h('div', { class: 'oneliner' },
        r.skip && h('b', {}, '🚫 Skip it. '),
        r.get && ['Get ', h('b', {}, r.get), '. '],
        r.avoid && [h('span', {}, 'Avoid '), r.avoid, '. '],
        r.price && [h('span', {}, 'Paid '), r.price, '.'])),
    ],

    h('div', { class: 'actions' },
      h('a', { class: 'btn primary', href: walkingDirectionsUrl(spot, ui.me), target: '_blank', rel: 'noopener' }, '🚶 Walk there'),
      h('button', { class: 'btn', onclick: () => reviewDialog(spot) }, mine ? 'Edit my one-liner' : 'Add my one-liner'),
      h('button', { class: 'btn', onclick: () => listPickerDialog(spot) }, '＋ List'),
      !spot.chain && h('button', { class: 'btn', onclick: () => ownerDialog(spot) }, 'I run this place')));
}

function renderSheet() {
  refill($('sheet'), ui.view === 'spot' ? renderSpot() : renderNearby());
}

function renderChips() {
  const counts = new Map();
  for (const { summary } of entriesAll()) for (const v of summary.vibes) counts.set(v.tag, (counts.get(v.tag) ?? 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 14);
  const list = tags.length ? tags : PRESET_VIBES;
  $('vibe-chips').replaceChildren(...list.map((t) =>
    h('button', {
      class: 'chip', 'aria-pressed': String(ui.vibes.has(t)),
      onclick: () => { ui.vibes.has(t) ? ui.vibes.delete(t) : ui.vibes.add(t); render(); },
    }, t)));
}

function render() {
  drawPins();
  renderSheet();
  renderChips();
  document.querySelectorAll('#skip-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ui.skipMode)));
}

/* ---------- dialogs ---------- */
const dlg = $('dlg');
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
function openDialog(...nodes) {
  dlg.replaceChildren(h('div', { class: 'dlg-body' }, nodes));
  if (!dlg.open) dlg.showModal();
}
const closeDialog = () => dlg.close();

function counted(label, input, max) {
  const count = h('span', { class: 'count' }, `0/${max}`);
  const sync = () => (count.textContent = `${input.value.length}/${max}`);
  input.addEventListener('input', sync);
  sync();
  return h('label', {}, label, count, input);
}

/** Review dialog. spot === null means "new spot at `at`". */
function reviewDialog(spot, at) {
  const mine = spot ? store.myReview(spot.id) : null;
  const picked = new Set(mine?.vibes ?? []);
  const err = h('p', { class: 'err', role: 'alert' });

  const name = h('input', { type: 'text', maxlength: LIMITS.name, placeholder: 'Spot name', required: true, autocomplete: 'off' });
  const chain = h('input', { type: 'checkbox' });
  const get = h('input', { type: 'text', maxlength: LIMITS.get, placeholder: 'e.g. carnitas tacos', value: mine?.get ?? '', autocomplete: 'off' });
  const avoid = h('input', { type: 'text', maxlength: LIMITS.avoid, placeholder: 'e.g. the cold brew', value: mine?.avoid ?? '', autocomplete: 'off' });
  const price = h('input', { type: 'text', maxlength: LIMITS.price, placeholder: '$9', value: mine?.price ?? '', inputmode: 'decimal', autocomplete: 'off' });
  const skip = h('input', { type: 'checkbox' });
  skip.checked = !!mine?.skip;
  const custom = h('input', { type: 'text', maxlength: LIMITS.vibe, placeholder: 'Add your own vibe', autocomplete: 'off' });

  const vibeBox = h('div', { class: 'vibe-picker' });
  const drawVibes = () => {
    const all = [...new Set([...PRESET_VIBES, ...picked])];
    vibeBox.replaceChildren(...all.map((v) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(picked.has(v)),
      onclick: () => {
        if (picked.has(v)) picked.delete(v);
        else if (picked.size < LIMITS.maxVibesPerReview) picked.add(v);
        else err.textContent = `Pick up to ${LIMITS.maxVibesPerReview} vibes.`;
        drawVibes();
      },
    }, v)));
  };
  drawVibes();
  custom.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = custom.value.trim();
    if (v && picked.size < LIMITS.maxVibesPerReview) { picked.add(v); custom.value = ''; drawVibes(); }
  });

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const draft = { get: get.value, avoid: avoid.value, price: price.value, vibes: [...picked], skip: skip.checked };
      const v = validateReview(draft);
      if (!v.ok) { err.textContent = v.errors[0]; return; }
      try {
        let target = spot;
        if (!target) target = store.addSpot({ name: name.value, lat: at.lat, lng: at.lng, chain: chain.checked });
        store.saveReview(target.id, draft);
        closeDialog();
        selectSpot(target.id);
        toast(mine ? 'Updated' : 'Thanks, neighbor');
      } catch (ex) { err.textContent = ex.message; }
    },
  },
    spot ? h('h2', {}, spot.name) : h('h2', {}, 'New spot'),
    h('p', { class: 'sub' }, 'One line each. No essays, no stars.'),
    !spot && [h('label', {}, 'Name', name), h('label', { class: 'check' }, chain, 'It’s a chain / franchise')],
    counted('What to get', get, LIMITS.get),
    counted('What to avoid', avoid, LIMITS.avoid),
    counted('The real price', price, LIMITS.price),
    h('label', {}, 'Vibe (pick up to 3)'), vibeBox, h('label', {}, custom),
    h('label', { class: 'check' }, skip, 'Skip It — shrinkflation, bad service, or overhyped line'),
    err,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, mine ? 'Save' : 'Post'),
      h('button', { class: 'btn', type: 'button', onclick: closeDialog }, 'Cancel'),
      mine && h('button', { class: 'btn danger', type: 'button', onclick: () => { store.deleteMyReview(spot.id); closeDialog(); toast('Removed'); } }, 'Delete mine')),
    h('p', { class: 'fine' }, 'One review per person per spot — posting again edits yours. No account needed.'));
  openDialog(form);
  (spot ? get : name).focus();
}

function ownerDialog(spot) {
  const err = h('p', { class: 'err', role: 'alert' });
  const hours = h('input', { type: 'text', maxlength: LIMITS.hours, value: spot.owner?.hours ?? '', placeholder: 'Tue–Sat 11–9' });
  const special = h('input', { type: 'text', maxlength: LIMITS.special, value: freshSpecial(spot.owner), placeholder: 'Soup of the day: split pea' });
  openDialog(h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      try { store.updateOwnerInfo(spot.id, { hours: hours.value, special: special.value }); closeDialog(); toast('Posted'); }
      catch (ex) { err.textContent = ex.message; }
    },
  },
    h('h2', {}, 'Owner portal'),
    h('p', { class: 'sub' }, spot.name),
    h('p', { class: 'fine' }, 'Free, forever. You can post hours and a daily blackboard special. You can’t pay to rank higher, hide or edit reviews, or buy a badge — those features don’t exist.'),
    counted('Hours', hours, LIMITS.hours),
    counted('Today’s special (clears after 24h)', special, LIMITS.special),
    err,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Post'),
      h('button', { class: 'btn', type: 'button', onclick: closeDialog }, 'Cancel')),
    h('p', { class: 'fine' }, 'Preview build: owner verification arrives with the shared database. Until then this is stored on this device only.')));
}

function listPickerDialog(spot) {
  const newName = h('input', { type: 'text', maxlength: LIMITS.listName, placeholder: 'New list, e.g. Late-night tacos under $10' });
  const body = h('div', {});
  const draw = () => {
    refill(body,
      store.state.lists.length === 0 && h('p', { class: 'empty' }, 'No lists yet — make your first below.'),
      store.state.lists.map((l) => {
        const cb = h('input', { type: 'checkbox', onchange: () => store.toggleInList(l.id, spot.id) });
        cb.checked = l.spotIds.includes(spot.id);
        return h('label', { class: 'check' }, cb, l.name);
      }));
  };
  draw();
  openDialog(h('h2', {}, 'Add to a list'), h('p', { class: 'sub' }, spot.name), body,
    h('label', {}, newName),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => {
        try { const l = store.createList(newName.value); store.toggleInList(l.id, spot.id); newName.value = ''; draw(); } catch (ex) { toast(ex.message); }
      } }, 'Create & add'),
      h('button', { class: 'btn primary', onclick: closeDialog }, 'Done')));
}

function listsDialog() {
  const name = h('input', { type: 'text', maxlength: LIMITS.listName, placeholder: 'List name' });
  const desc = h('input', { type: 'text', maxlength: LIMITS.listDesc, placeholder: 'One line about it (optional)' });
  const body = h('div', {});
  const draw = () => {
    const byId = new Map(store.state.spots.map((s) => [s.id, s]));
    refill(body,
      store.state.lists.length === 0 && h('p', { class: 'empty' }, 'Make a mini-curation and share it with a link. No followers, no feed.'),
      store.state.lists.map((l) => h('div', { class: 'list-card' },
        h('b', {}, l.name), l.desc && h('div', { class: 'sub' }, l.desc),
        h('div', {}, l.spotIds.map((id) => byId.get(id)).filter(Boolean).map((s) =>
          h('button', { class: 'chip', onclick: () => { closeDialog(); map.setView([s.lat, s.lng], 17); selectSpot(s.id); } }, s.name))),
        l.spotIds.length === 0 && h('div', { class: 'sub' }, 'Empty — open a spot and tap ＋ List.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', onclick: () => shareList(l, byId) }, 'Copy share link'),
          h('button', { class: 'btn small danger', onclick: () => { store.deleteList(l.id); draw(); } }, 'Delete')))));
  };
  draw();
  openDialog(h('h2', {}, 'Local lists'), body,
    h('label', {}, 'New list'), name, h('div', { style: 'height:6px' }), desc,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => {
        try { store.createList(name.value, desc.value); name.value = desc.value = ''; draw(); } catch (ex) { toast(ex.message); }
      } }, 'Create'),
      h('button', { class: 'btn', onclick: closeDialog }, 'Close')));
}

async function shareList(list, byId) {
  const url = `${location.origin}${location.pathname}#list=${encodeList(list, byId)}`;
  try { await navigator.clipboard.writeText(url); toast('Link copied'); }
  catch { window.prompt('Copy this link:', url); }
}

function supportDialog() {
  const body = h('div', {});
  const draw = () => {
    const st = store.state.settings;
    refill(body,
      h('div', { class: 'list-card' },
        h('b', {}, 'Community Member — free'),
        h('div', { class: 'sub' }, 'Ad-free map, unlimited one-liners, saved lists. Always.')),
      h('div', { class: 'list-card' },
        h('b', {}, 'Local Support — $1/month tip jar'),
        h('div', { class: 'sub' }, 'Pays for the servers so the map stays ad-free. Unlocks retro app icons and custom pins. Never unlocks ranking, badges, or anything on the map’s content.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn' + (st.supporter ? '' : ' primary'), onclick: () => { store.setSetting('supporter', !st.supporter); draw(); applyPerks(); render(); } },
            st.supporter ? 'Turn off perks preview' : 'Preview the perks')),
        h('p', { class: 'fine' }, 'Payments aren’t connected in this build — the toggle just lets you try the perks on this device.'),
        st.supporter && [
          h('h3', {}, 'Retro icon'),
          h('div', { class: 'perk' }, Object.entries(ICONS).map(([k, [, , label]]) =>
            h('button', { class: 'btn small', 'aria-pressed': String(st.icon === k), onclick: () => { store.setSetting('icon', k); applyPerks(); draw(); } }, label))),
          h('h3', {}, 'Map pin'),
          h('div', { class: 'perk' }, Object.entries(PINS).map(([k, label]) =>
            h('button', { class: 'btn small', 'aria-pressed': String(st.pin === k), onclick: () => { store.setSetting('pin', k); applyPerks(); draw(); } }, label))),
        ]),
      h('div', { class: 'list-card' },
        h('b', {}, 'Mom-and-Pop Core — free'),
        h('div', { class: 'sub' }, 'Independent spots post hours and a daily special. Open any independent spot and tap “I run this place.” Chains can’t.')),
      h('p', { class: 'fine' }, 'Privacy: no account, no ads, no trackers. Your reviews and lists live in this browser. Map tiles come from OpenStreetMap.'));
  };
  draw();
  openDialog(h('h2', {}, 'Keep it ad-free'), body, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeDialog }, 'Close')));
}

/* ---------- shared-list links ---------- */
function handleHash() {
  const m = location.hash.match(/^#list=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const list = decodeList(m[1]);
  if (!list) return toast('That list link looks broken.');
  openDialog(
    h('h2', {}, list.name), list.desc && h('p', { class: 'sub' }, list.desc),
    h('p', {}, `${list.spots.length} spot${list.spots.length === 1 ? '' : 's'}:`),
    h('ul', {}, list.spots.map((s) => h('li', {}, s.name))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => {
        store.importList(list); closeDialog(); toast('Saved to your lists');
        if (list.spots[0]) map.setView([list.spots[0].lat, list.spots[0].lng], 16);
      } }, 'Save list'),
      h('button', { class: 'btn', onclick: closeDialog }, 'No thanks')));
}

/* ---------- wire up ---------- */
$('search').addEventListener('input', (e) => { ui.q = e.target.value; render(); });
$('skip-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) { ui.skipMode = b.dataset.mode; render(); }
});
$('btn-add').addEventListener('click', () => setAdding(!ui.adding));
$('btn-locate').addEventListener('click', () => locate(true));
$('btn-lists').addEventListener('click', listsDialog);
$('btn-support').addEventListener('click', supportDialog);
store.subscribe(render);
window.addEventListener('hashchange', handleHash);

applyPerks();
render();
handleHash();
locate(!store.state.settings.lastCenter);
