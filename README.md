# LocalSpit

The direct, no-BS neighborhood food map. No sponsored pins, no star ratings, no login wall:
just neighbors saying **what to get, what to avoid, and what it really costs**.

## Run it

```sh
npm start        # serves the folder at http://localhost:8080 (needs python3)
npm test         # unit tests, Node 20+, no dependencies
```

It's a static site (ES modules + [Leaflet](https://leafletjs.com) from unpkg, pinned with SRI).
Any static host works. Map tiles are OpenStreetMap's.

## What's in this build

| Concept | How it works |
| --- | --- |
| **Instant map** | Opens straight to the map at your location (or last-viewed spot). No onboarding, no account. |
| **Zero sponsored pins** | `sortByDistance` is the only ordering and takes no money-related input. There's a test for it. |
| **One-line review** | Three fields with hard limits: *get* (40), *avoid* (40), *price* (12, must be a number). |
| **Pin card** | Top 3 dishes (plural/punctuation-insensitive grouping), what to avoid, median real price, vibes, walking directions (OpenStreetMap). |
| **Vibe tags** | Presets + free-form; up to 3 per review; filter chips are built from tags neighbors actually used. |
| **Skip It** | Flag on a review. A spot is marked once 2+ neighbors say skip *and* they're the majority. Filter: All / Hide Skips / Only Skips. |
| **Local Lists** | Create lists, add spots, share via a self-contained link (`#list=...`, no server). Imports are validated and rendered as plain text. |
| **Mom-and-Pop portal** | Independent (non-chain) spots can post hours + a daily special that expires after 24h. The store has no method that can edit/hide reviews or affect ordering. |
| **Local Support ($1/mo)** | Retro icons + custom pins. **Payments are not wired up**: the toggle is a preview. Perks are cosmetic only. |
| **Anti-stuffing** | One review per device per spot; posting again edits yours. |

## Honest limitations (next steps)

- **Data is local to each browser** (`localStorage`). `js/store.js` is the only persistence layer;
  swap it for a shared backend to make reviews truly crowdsourced.
  Until then, **demo spots are fictional** and clearly badged `DEMO` (one tap to clear).
- **Owner verification** doesn't exist yet. It needs the backend (e.g. verifying the business by phone or mail).
- **Anti-abuse** beyond one-review-per-device (rate limits, Skip It brigading) needs a server.
- **Payments** for the Local Support tier need a processor.
- Search is by name/dish/vibe; no address geocoding (avoids sending queries to a third party).

## Layout

```
index.html        shell
css/style.css     mobile-first, light/dark, side panel on wide screens
js/logic.js       pure rules: limits, summaries, filters, sharing codec
js/store.js       local-first store (swap for a backend later)
js/seed.js        fictional demo data
js/app.js         map + UI
test/             node:test unit tests
```
