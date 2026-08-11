// ============================================================================
// The word system — the heart of HumanConnect's safety model.
//
// Names are NEVER free text. A pin's name is a combination of three slots:
//   [first?] + [main] + [last?]
// stored in Firestore as integer indices {a, b, c} (-1 = not used), plus the
// KIND of pin (`k`) that says which word lists those indices point into:
//
//   kind 0 — a plan:  [vibe?]    + [activity] + [format?]  →  "Evening Cricket Match"
//   kind 1 — a help request: [urgency?] + [need] + [wording?] → "Urgent O Positive Blood Needed"
//
// api/_lib/validate.js imports this file, so the API and the UI can never
// disagree about which indices exist. Arbitrary text cannot enter the database
// through either one.
//
// Only APPEND new words to any list — never reorder or delete, or existing
// pins would silently change meaning. The same goes for the kind numbers.
// A word that turns out to be wrong is RETIRED instead (`r: true`): its index
// stays valid forever so existing pins keep their name, but the composer stops
// offering it and /api/create refuses it — see isRetiredWord().
// ============================================================================

// The kinds. `k` is absent on every event written before help requests
// existed, so 0 must stay the meaning of "not set" (see kindOf() in
// api/_lib/validate.js and sanitize() in js/store.js).
export const KIND_EVENT = 0;
export const KIND_HELP = 1;

export const VIBES = [
  'Morning', 'Evening', 'Sunrise', 'Sunset', 'Night', 'Weekend',
  'Community', 'Neighborhood', 'Beginners', 'Casual', 'Silent', 'Free',
  'Open', 'Friendly', 'Weekly', 'Daily', 'Family', 'Youth',
  'Seniors', 'Ladies', 'Kids', 'Pet', 'Monsoon', 'Winter',
  'Summer', 'Festive', 'Slow', 'Mega', 'Mini', 'Fun',
];

// w: word, e: emoji (shown on the map pin), c: category (ring colour)
export const ACTIVITIES = [
  { w: 'Walk', e: '🚶', c: 'move' },
  { w: 'Run', e: '🏃', c: 'move' },
  { w: 'Cycling', e: '🚴', c: 'move' },
  { w: 'Yoga', e: '🧘', c: 'move' },
  { w: 'Meditation', e: '🧘', c: 'move' },
  { w: 'Zumba', e: '💃', c: 'move' },
  { w: 'Workout', e: '💪', c: 'move' },
  { w: 'Stretching', e: '🤸', c: 'move' },
  { w: 'Aerobics', e: '🤸', c: 'move' },
  { w: 'Cricket', e: '🏏', c: 'sport' },
  { w: 'Football', e: '⚽', c: 'sport' },
  { w: 'Badminton', e: '🏸', c: 'sport' },
  { w: 'Basketball', e: '🏀', c: 'sport' },
  { w: 'Volleyball', e: '🏐', c: 'sport' },
  { w: 'Tennis', e: '🎾', c: 'sport' },
  { w: 'Table-Tennis', e: '🏓', c: 'sport' },
  { w: 'Kabaddi', e: '🤼', c: 'sport' },
  { w: 'Chess', e: '♟️', c: 'social' },
  { w: 'Carrom', e: '🎯', c: 'social' },
  { w: 'Ludo', e: '🎲', c: 'social' },
  { w: 'Skating', e: '🛼', c: 'sport' },
  { w: 'Swimming', e: '🏊', c: 'sport' },
  { w: 'Trekking', e: '🥾', c: 'outdoor' },
  { w: 'Climbing', e: '🧗', c: 'outdoor' },
  { w: 'Picnic', e: '🧺', c: 'outdoor' },
  { w: 'Camping', e: '⛺', c: 'outdoor' },
  { w: 'Stargazing', e: '🔭', c: 'outdoor' },
  { w: 'Birdwatching', e: '🦜', c: 'outdoor' },
  { w: 'Kite', e: '🪁', c: 'outdoor' },
  { w: 'Fishing', e: '🎣', c: 'outdoor' },
  { w: 'Coffee', e: '☕', c: 'food' },
  { w: 'Chai', e: '🫖', c: 'food' },
  { w: 'Breakfast', e: '🍳', c: 'food' },
  { w: 'Brunch', e: '🥞', c: 'food' },
  { w: 'Lunch', e: '🍱', c: 'food' },
  { w: 'Dinner', e: '🍽️', c: 'food' },
  { w: 'Potluck', e: '🥘', c: 'food' },
  { w: 'Ice-Cream', e: '🍦', c: 'food' },
  { w: 'Street-Food', e: '🍢', c: 'food' },
  { w: 'Cooking', e: '🧑‍🍳', c: 'food' },
  { w: 'Baking', e: '🧁', c: 'food' },
  { w: 'Music', e: '🎵', c: 'music' },
  { w: 'Singing', e: '🎤', c: 'music' },
  { w: 'Karaoke', e: '🎙️', c: 'music' },
  { w: 'Guitar', e: '🎸', c: 'music' },
  { w: 'Drumming', e: '🥁', c: 'music' },
  { w: 'Flute', e: '🪈', c: 'music' },
  { w: 'Dance', e: '🕺', c: 'music' },
  { w: 'Garba', e: '🪩', c: 'music' },
  { w: 'Art', e: '🎨', c: 'arts' },
  { w: 'Sketching', e: '✏️', c: 'arts' },
  { w: 'Painting', e: '🖌️', c: 'arts' },
  { w: 'Craft', e: '🧵', c: 'arts' },
  { w: 'Origami', e: '🎏', c: 'arts' },
  { w: 'Pottery', e: '🏺', c: 'arts' },
  { w: 'Photography', e: '📸', c: 'arts' },
  { w: 'Reading', e: '📖', c: 'learn' },
  { w: 'Books', e: '📚', c: 'learn' },
  { w: 'Poetry', e: '📜', c: 'arts' },
  { w: 'Storytelling', e: '🗣️', c: 'arts' },
  { w: 'Writing', e: '✍️', c: 'arts' },
  { w: 'Journaling', e: '📓', c: 'arts' },
  { w: 'Study', e: '📝', c: 'learn' },
  { w: 'Coding', e: '💻', c: 'learn' },
  { w: 'Robotics', e: '🤖', c: 'learn' },
  { w: 'Science', e: '🔬', c: 'learn' },
  { w: 'Math', e: '➗', c: 'learn' },
  { w: 'Language', e: '💬', c: 'learn' },
  { w: 'Quiz', e: '❓', c: 'learn' },
  { w: 'Debate', e: '🗨️', c: 'learn' },
  { w: 'Public-Speaking', e: '🎤', c: 'learn' },
  { w: 'Gardening', e: '🌱', c: 'service' },
  { w: 'Plantation', e: '🌳', c: 'service' },
  { w: 'Cleanup', e: '🧹', c: 'service' },
  { w: 'Recycling', e: '♻️', c: 'service' },
  { w: 'Donation', e: '🎁', c: 'service' },
  { w: 'Charity', e: '❤️', c: 'service' },
  { w: 'Volunteering', e: '🙌', c: 'service' },
  { w: 'Laughter', e: '😂', c: 'social' },
  { w: 'Comedy', e: '🎭', c: 'social' },
  { w: 'Magic', e: '🪄', c: 'social' },
  { w: 'Board-Games', e: '🎲', c: 'social' },
  { w: 'Gaming', e: '🎮', c: 'social' },
  { w: 'Movies', e: '🎬', c: 'social' },
  { w: 'Astronomy', e: '🌌', c: 'learn' },
  { w: 'Heritage', e: '🏛️', c: 'learn' },
];

export const FORMATS = [
  'Meetup', 'Session', 'Match', 'Game', 'Club', 'Circle',
  'Group', 'Gathering', 'Drive', 'Class', 'Workshop', 'Practice',
  'Tournament', 'Hangout', 'Marathon', 'Camp', 'Fest', 'Jam',
  'Walkathon', 'Party', 'Ride', 'Race', 'Swap', 'Show',
  'Night', 'Trail',
];

export const CAT_COLORS = {
  move:    '#e5484d',
  sport:   '#30a46c',
  outdoor: '#0d9488',
  food:    '#f97316',
  arts:    '#8b5cf6',
  music:   '#ec4899',
  learn:   '#3b82f6',
  service: '#eab308',
  social:  '#06b6d4',
};

// ============================================================================
// Help requests (kind 1)
//
// Same three slots, different words: a request asks people FOR something
// instead of inviting them TO something. "Urgent Blood Needed", "Roadside
// Flat-Tyre Help", "Elderly Groceries Delivery".
//
// The lists stay deliberately practical and bounded. A fixed vocabulary is the
// whole legal-safety model — someone in genuine trouble can say what they need
// and where, and nobody can turn the map into a message board.
// ============================================================================

/** First word: who is asking, or how soon. 'Women-Only' lets a woman ask for
 *  a woman — "Women-Only Walk-Home Needed", "Women-Only Ride Wanted". */
export const URGENCY = [
  'Urgent', 'Emergency', 'Immediate', 'Today', 'Tonight', 'Tomorrow',
  'Weekend', 'Ongoing', 'Quick', 'Small', 'Roadside', 'Stranded',
  'Injured', 'Elderly', 'Family', 'Student', 'Neighborhood', 'Community',
  'Monsoon', 'Flood', 'Heatwave', 'Night', 'Morning', 'Evening',
  'Hospital', 'Temporary', 'Long-Term', 'Nearby', 'Women-Only',
];

// w: word, e: emoji (shown on the map pin). No category here on purpose —
// every help pin shares ONE ring colour (HELP_COLOR). Nine activity categories
// already colour the plan pins; a second, different meaning for the same hues
// would turn the map into soup. The SHAPE says "someone needs help" (a rounded
// callout instead of a circle — see .hc-pin.help), the emoji says what for.
export const NEEDS = [
  // Medical
  //
  // 'Blood' is RETIRED (r) in favour of the typed groups at the end of this
  // list: the group decides WHO can donate, so an untyped appeal brings people
  // who cannot help. That is the rule for retiring a generic in favour of
  // typed variants — the missing detail filters who should come (blood group,
  // fuel type). A detail any willing helper can absorb on arrival (which
  // medicine, where the ride goes) stays generic: the pin's job is to get a
  // helper there, and free text is never an option.
  { w: 'Blood', e: '🩸', r: true },
  { w: 'Medicine', e: '💊' },
  { w: 'First-Aid', e: '🩹' },
  { w: 'Medical-Help', e: '🚑' },
  { w: 'Hospital-Visit', e: '🏥' },
  { w: 'Wheelchair', e: '♿' },
  { w: 'Patient-Care', e: '🛏️' },
  // Essentials
  { w: 'Food', e: '🍲' },
  { w: 'Water', e: '💧' },
  { w: 'Groceries', e: '🛒' },
  { w: 'Cooked-Meal', e: '🍱' },
  { w: 'Clothes', e: '👕' },
  { w: 'Blankets', e: '🧣' },
  { w: 'Shelter', e: '🏠' },
  { w: 'Hygiene-Kit', e: '🧼' },
  { w: 'Baby-Care', e: '🍼' },
  // Getting there
  { w: 'Ride', e: '🚗' },
  // Retired like 'Blood': petrol in a diesel tank is worse than no help.
  { w: 'Fuel', e: '⛽', r: true },
  { w: 'Breakdown', e: '🛠️' },
  { w: 'Flat-Tyre', e: '🛞' },
  { w: 'Jump-Start', e: '🔋' },
  { w: 'Directions', e: '🧭' },
  { w: 'Luggage', e: '🧳' },
  { w: 'Moving', e: '🚚' },
  // Hands
  { w: 'Repair', e: '🔧' },
  { w: 'Plumbing', e: '🚰' },
  { w: 'Electrical', e: '💡' },
  { w: 'Carpentry', e: '🪚' },
  { w: 'Painting', e: '🖌️' },
  { w: 'Cleanup', e: '🧹' },
  { w: 'Gardening', e: '🌱' },
  { w: 'Heavy-Lifting', e: '💪' },
  { w: 'Tools', e: '🧰' },
  { w: 'Ladder', e: '🪜' },
  // Know-how
  { w: 'Tutoring', e: '📘' },
  { w: 'Homework', e: '📓' },
  { w: 'Exam-Prep', e: '📚' },
  { w: 'Computer-Help', e: '💻' },
  { w: 'Phone-Help', e: '📱' },
  { w: 'Internet', e: '📶' },
  { w: 'Form-Filling', e: '📝' },
  { w: 'Paperwork', e: '🗂️' },
  { w: 'Translation', e: '💬' },
  { w: 'Reading-Help', e: '📖' },
  { w: 'Job-Advice', e: '💼' },
  { w: 'Resume-Help', e: '📄' },
  { w: 'Legal-Advice', e: '⚖️' },
  { w: 'Printout', e: '🖨️' },
  // Looking for
  { w: 'Lost-Pet', e: '🐾' },
  { w: 'Lost-Item', e: '🔎' },
  { w: 'Missing-Person', e: '🧍' },
  { w: 'Search-Party', e: '🔦' },
  // Animals
  { w: 'Stray-Animal', e: '🐕' },
  { w: 'Animal-Rescue', e: '🐈' },
  { w: 'Bird-Rescue', e: '🕊️' },
  { w: 'Pet-Care', e: '🐶' },
  { w: 'Animal-Feed', e: '🥣' },
  // Company, care & personal safety
  //
  // The safety words are deliberately the BEFORE and AFTER of danger — an
  // accompanied walk, a safe place to wait, a borrowed phone call — never the
  // danger itself. A map pin is the wrong tool for an emergency in progress:
  // it waits for passersby, and it publishes a frightened person's exact
  // location to strangers. Both help notes point at 112 and 1091 instead.
  { w: 'Elder-Care', e: '🧓' },
  { w: 'Child-Care', e: '🧒' },
  { w: 'Friendly-Visit', e: '🤝' },
  { w: 'Listener', e: '👂' },
  { w: 'Safe-Walk', e: '🚶' },
  { w: 'Walk-Home', e: '🚶‍♀️' },
  { w: 'Safe-Place', e: '🛡️' },
  { w: 'Phone-Call', e: '📞' },
  // Things
  { w: 'Books', e: '📗' },
  { w: 'School-Supplies', e: '🎒' },
  { w: 'Stationery', e: '✏️' },
  { w: 'Furniture', e: '🪑' },
  { w: 'Toys', e: '🧸' },
  { w: 'Donations', e: '🎁' },
  { w: 'Volunteers', e: '🙌' },
  { w: 'Charging', e: '🔌' },
  { w: 'Umbrella', e: '☂️' },
  // When things go wrong
  { w: 'Flood-Relief', e: '🌊' },
  { w: 'Relief-Supplies', e: '📦' },
  { w: 'Rescue', e: '🛟' },
  { w: 'Sandbags', e: '🧱' },
  // Typed variants — APPENDED here, not slotted beside their generic word,
  // because stored indices make every list append-only. They exist where the
  // type IS the request: a B− donor cannot answer an A+ appeal, and petrol in
  // a diesel tank is worse than no help at all — which is also why their
  // generics above are retired, not merely accompanied. Worded type-first
  // ("O Positive Blood") so the title reads like the appeal it is:
  // "Emergency O Negative Blood Donors".
  { w: 'A-Positive-Blood', e: '🩸' },
  { w: 'A-Negative-Blood', e: '🩸' },
  { w: 'B-Positive-Blood', e: '🩸' },
  { w: 'B-Negative-Blood', e: '🩸' },
  { w: 'O-Positive-Blood', e: '🩸' },
  { w: 'O-Negative-Blood', e: '🩸' },
  { w: 'AB-Positive-Blood', e: '🩸' },
  { w: 'AB-Negative-Blood', e: '🩸' },
  { w: 'Plasma', e: '💉' },
  { w: 'Platelets', e: '🩸' },
  { w: 'Petrol', e: '⛽' },
  { w: 'Diesel', e: '⛽' },
  { w: 'Math-Tutoring', e: '➗' },
  { w: 'English-Tutoring', e: '🔤' },
  { w: 'Science-Tutoring', e: '🔬' },
];

// Last word: how the ask is phrased.
//
// Chosen for what they CANNOT combine into as much as for what they say. The
// middle slot is always a concrete need, so the pair is read together — which
// rules out 'Escort' and 'Company' here (and 'Company' as a need), because
// "Tonight Company Wanted" is a solicitation, not a request for help, and a
// fixed vocabulary that can spell one out has failed at its only job.
export const HELP_FORMATS = [
  'Needed', 'Wanted', 'Request', 'Appeal', 'Help', 'Support',
  'Assistance', 'Volunteers', 'Donors', 'Drive', 'Search', 'Rescue',
  'Delivery', 'Pickup', 'Lift', 'Buddy', 'Advice', 'Lessons',
  'Team', 'Hands',
];

// One colour for every help pin. Mirrors --sos in css/style.css and is drawn
// straight onto the share card, so the three must be changed together. Chosen
// to clear 3:1 against BOTH paper tones (light #faf9f6, dark #1a1917), since
// it is only ever a ring or an outline, never text.
export const HELP_COLOR = '#ea580c';

// ============================================================================
// Kinds, resolved
// ============================================================================

const TAXONOMIES = {
  [KIND_EVENT]: { first: VIBES,   main: ACTIVITIES, last: FORMATS,      fallbackEmoji: '📍' },
  [KIND_HELP]:  { first: URGENCY, main: NEEDS,      last: HELP_FORMATS, fallbackEmoji: '🆘' },
};

/** Strict: only the kinds this build knows how to render. */
export const isKind = (k) => k === KIND_EVENT || k === KIND_HELP;

/** For display paths, where an unknown kind must not throw. */
export const normalizeKind = (k) => (isKind(k) ? k : KIND_EVENT);

/** The three word lists a kind draws its name from. */
export const taxonomy = (kind) => TAXONOMIES[normalizeKind(kind)];

/** True when {a,b,c} form a valid 2–3 word name for `kind`. */
export function isValidCombo(kind, a, b, c) {
  // Deliberately not normalized — an unknown kind is invalid, and isKind's
  // strict equality also keeps a string '1' from reaching the object lookup
  // below (where JS key coercion would happily resolve it).
  if (!isKind(kind)) return false;
  const t = TAXONOMIES[kind];
  const aOk = Number.isInteger(a) && a >= -1 && a < t.first.length;
  const bOk = Number.isInteger(b) && b >= 0 && b < t.main.length;
  const cOk = Number.isInteger(c) && c >= -1 && c < t.last.length;
  return aOk && bOk && cOk && (a !== -1 || c !== -1);
}

/** "Evening Cricket Match" / "Urgent Blood Needed" (hyphens render as spaces). */
export function sentence(kind, a, b, c) {
  const t = taxonomy(kind);
  const parts = [];
  if (a >= 0) parts.push(t.first[a]);
  parts.push(t.main[b].w);
  if (c >= 0) parts.push(t.last[c]);
  return parts.join(' ').replace(/-/g, ' ');
}

/**
 * True when the main word is retired: still a real index — existing pins keep
 * rendering, an edit may keep it — but barred from NEW pins, by the composer
 * (which no longer offers the chip) and by /api/create (which refuses it).
 * Retirement is for generics whose typed variants are REQUIRED to act — an
 * untyped 'Blood' appeal brings donors of the wrong group.
 */
export function isRetiredWord(kind, b) {
  return !!taxonomy(kind).main[b]?.r;
}

/** The glyph on the pin: the activity for a plan, the thing needed for a request. */
export function itemEmoji(kind, b) {
  const t = taxonomy(kind);
  return t.main[b]?.e ?? t.fallbackEmoji;
}

/** The pin's ring: the activity's category for a plan, one shared colour for help. */
export function itemColor(kind, b) {
  if (normalizeKind(kind) === KIND_HELP) return HELP_COLOR;
  return CAT_COLORS[ACTIVITIES[b]?.c] ?? '#64748b';
}
