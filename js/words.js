// ============================================================================
// The word system — the heart of HumanConnect's safety model.
//
// Event names are NEVER free text. An event is a combination of:
//   [vibe?] + [activity] + [format?]   →  "Evening Cricket Match"
// stored in Firestore as integer indices {a, b, c} (-1 = not used).
// Security rules validate the indices, so arbitrary text can never
// enter the database.
//
// IMPORTANT: if you add/remove words, update the list lengths in
// firestore.rules (VIBES=30, ACTIVITIES=86, FORMATS=26) and redeploy rules.
// Only APPEND new words — never reorder or delete, or existing events
// would change meaning.
// ============================================================================

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

/** True when {a,b,c} indices form a valid 2–3 word event name. */
export function isValidCombo(a, b, c) {
  const aOk = Number.isInteger(a) && a >= -1 && a < VIBES.length;
  const bOk = Number.isInteger(b) && b >= 0 && b < ACTIVITIES.length;
  const cOk = Number.isInteger(c) && c >= -1 && c < FORMATS.length;
  return aOk && bOk && cOk && (a !== -1 || c !== -1);
}

/** "Evening Cricket Match" (hyphenated words render with spaces). */
export function sentence(a, b, c) {
  const parts = [];
  if (a >= 0) parts.push(VIBES[a]);
  parts.push(ACTIVITIES[b].w);
  if (c >= 0) parts.push(FORMATS[c]);
  return parts.join(' ').replace(/-/g, ' ');
}

export function activityEmoji(b) {
  return ACTIVITIES[b]?.e ?? '📍';
}

export function activityColor(b) {
  return CAT_COLORS[ACTIVITIES[b]?.c] ?? '#64748b';
}
