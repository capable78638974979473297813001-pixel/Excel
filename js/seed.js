// Demo data so a first-time visitor sees a living map instead of an empty one.
// Every business here is FICTIONAL and flagged `demo: true`; the UI labels it
// and offers a one-tap "clear demo data". Nothing here refers to a real business.

export const DEFAULT_CENTER = { lat: 45.5231, lng: -122.6765 };

const R = (get, avoid, price, vibes = [], skip = false) => ({ get, avoid, price, vibes, skip });

const SPOTS = [
  {
    name: 'Tía Lupe’s Window',
    dlat: 0.0012, dlng: -0.0021,
    reviews: [
      R('carnitas tacos', 'the horchata, it’s syrup', '$9', ['Cash Only', 'Line Is Worth It']),
      R('Carnitas taco', '', '$8', ['Cash Only']),
      R('carnitas tacos + lime', 'bottled salsa', '$10', ['Hidden Gem', 'Cash Only']),
      R('al pastor', '', '$9', []),
    ],
    owner: { hours: 'Tue–Sat 11–9', special: 'Tamales 3 for $8 until they’re gone' },
  },
  {
    name: 'Brindle & Rye',
    dlat: -0.0009, dlng: 0.0018,
    reviews: [
      R('rye toast with butter', 'the $7 cold brew', '$6', ['Quiet, Bring a Book', 'Good for Solo Eating']),
      R('rye toast', 'cold brew', '$6', ['Quiet, Bring a Book']),
      R('egg sandwich', '', '$9', ['Good for Solo Eating']),
    ],
  },
  {
    name: 'Noodle Basement',
    dlat: 0.0021, dlng: 0.0009,
    reviews: [
      R('spicy beef noodle', 'dumplings, frozen', '$14', ['Loud & Cramped', 'Portions are Massive']),
      R('beef noodle soup', 'dumplings', '$13', ['Loud & Cramped', 'Late Night']),
      R('spicy beef noodles', '', '$14', ['Portions are Massive']),
    ],
  },
  {
    name: 'The Velvet Fork',
    dlat: -0.0022, dlng: -0.0008,
    reviews: [
      R('', 'the $26 “small plates”', '$26', ['Line Is Worth It'], true),
      R('the burger', 'literally everything else', '$22', [], true),
      R('fries', '', '$12', [], true),
    ],
  },
  {
    name: 'Sal’s Slice',
    dlat: 0.0004, dlng: 0.0031,
    reviews: [
      R('plain cheese slice', 'garlic knots', '$4', ['Late Night', 'Counter Seating']),
      R('cheese slice', '', '$4.50', ['Late Night']),
    ],
    owner: { hours: 'Daily 11am–3am', special: '' },
  },
  {
    name: 'Corner Pho 88',
    dlat: -0.0031, dlng: 0.0022,
    reviews: [
      R('#12 pho tai', 'spring rolls', '$13', ['Good for Solo Eating', 'Portions are Massive']),
      R('pho tai', '', '$13', ['Good for Solo Eating']),
    ],
  },
  {
    name: 'GlobalBurger Express',
    chain: true,
    dlat: 0.0033, dlng: -0.0029,
    reviews: [
      R('', 'the “new” smaller combo', '$15', [], true),
      R('', 'everything, shrinkflation city', '$14', [], true),
    ],
  },
];

/** Build demo spots + reviews around DEFAULT_CENTER. */
export function buildSeed(now = Date.now()) {
  const spots = [];
  const reviews = [];
  SPOTS.forEach((s, i) => {
    const id = `demo-${i}`;
    spots.push({
      id,
      name: s.name,
      lat: DEFAULT_CENTER.lat + s.dlat,
      lng: DEFAULT_CENTER.lng + s.dlng,
      chain: !!s.chain,
      demo: true,
      owner: s.owner ? { ...s.owner, specialAt: now } : null,
      createdAt: now,
    });
    s.reviews.forEach((r, j) =>
      reviews.push({ id: `${id}-r${j}`, spotId: id, deviceId: `demo-device-${j}`, at: now - j * 3600_000, ...r }),
    );
  });
  return { spots, reviews };
}
