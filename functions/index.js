const { onValueCreated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();

// Keep in sync with House-Chores/index.html — a pickup's tag cycles based
// on the anchor date if there are multiple tags. This is the same math as
// the client's tagForOccurrence, translated to plain JS for the server.
const DAY_MAP = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseDateLocal(str) { return new Date(str + 'T12:00:00'); }
function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return Object.values(v);
}
function countOccurrencesBetween(days, start, end) {
  if (!days || !days.length) return 0;
  const set = new Set(days.map(d => DAY_MAP[d]));
  let count = 0;
  const cur = new Date(start);
  cur.setHours(12, 0, 0, 0);
  while (cur <= end) {
    if (set.has(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  if (set.has(start.getDay())) count--;
  return Math.max(0, count);
}
function tagForOccurrence(entry, dateStr) {
  const tags = toArray(entry.tags);
  if (tags.length === 0) return null;
  if (tags.length === 1) return tags[0];
  if (!entry.anchor) return tags[0];
  const anchor = parseDateLocal(entry.anchor);
  const target = parseDateLocal(dateStr);
  const days = toArray(entry.days);
  if (target < anchor) {
    const occ = -countOccurrencesBetween(days, target, anchor);
    const idx = ((occ % tags.length) + tags.length) % tags.length;
    return tags[idx];
  }
  const occ = countOccurrencesBetween(days, anchor, target);
  return tags[occ % tags.length];
}
function pickupsFor(trashList, dateStr) {
  const d = parseDateLocal(dateStr);
  const dayName = DAY_NAMES[d.getDay()];
  return (trashList || [])
    .map(t => {
      const clone = { ...t };
      clone.days = toArray(clone.days).length ? toArray(clone.days) : (clone.day ? [clone.day] : []);
      clone.tags = toArray(clone.tags);
      return clone;
    })
    .filter(t => t.days.includes(dayName))
    .map(t => ({
      name: t.name,
      icon: t.icon || '🗑️',
      tag: tagForOccurrence(t, dateStr)
    }));
}
function isoLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Realtime Database trigger: when a new /nudges/{id} row appears, look up the
// recipient's stored FCM tokens under /tokens/{name}/* and send a push to each.
// Stale tokens are pruned automatically.
exports.sendNudge = onValueCreated(
  { ref: '/nudges/{nudgeId}', region: 'us-central1' },
  async event => {
    const nudge = event.data.val();
    if (!nudge || !nudge.to) return;

    const safeName = String(nudge.to).replace(/[.#$\[\]\/]/g, '_');
    const tokensSnap = await admin.database().ref(`tokens/${safeName}`).once('value');
    const entries = [];
    tokensSnap.forEach(child => {
      const v = child.val();
      if (v && v.token) entries.push({ key: child.key, token: v.token });
    });
    if (entries.length === 0) return;

    const message = {
      notification: {
        title: `\u{1F44B} Nudge from ${nudge.from || 'a roommate'}`,
        body: `Don't forget: ${nudge.choreName || 'a chore'}`
      },
      data: {
        choreId: String(nudge.choreId || ''),
        from: String(nudge.from || ''),
        to: String(nudge.to)
      },
      tokens: entries.map(e => e.token)
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    // Clean up tokens that the FCM service rejected.
    const stale = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];
    const updates = {};
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error && stale.includes(r.error.code)) {
        updates[`tokens/${safeName}/${entries[i].key}`] = null;
      }
    });
    if (Object.keys(updates).length) await admin.database().ref().update(updates);
  }
);

// Nightly reminder: at 8pm America/New_York, look up tomorrow's pickups
// from /house/trash and push a notification to every roommate token
// registered under /tokens/<name>/*. Stale tokens are pruned.
exports.pickupReminder = onSchedule(
  {
    schedule: '0 20 * * *',
    timeZone: 'America/New_York',
    region: 'us-central1'
  },
  async () => {
    const houseSnap = await admin.database().ref('house').once('value');
    const house = houseSnap.val();
    if (!house) return;

    const trash = toArray(house.trash);
    if (trash.length === 0) return;

    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const pickups = pickupsFor(trash, isoLocalDate(tomorrow));
    if (pickups.length === 0) return;

    const tokensSnap = await admin.database().ref('tokens').once('value');
    const entries = [];
    tokensSnap.forEach(roommate => {
      const roommateName = roommate.key;
      roommate.forEach(entry => {
        const v = entry.val();
        if (v && v.token) entries.push({ owner: roommateName, key: entry.key, token: v.token });
      });
    });
    if (entries.length === 0) return;

    const body = pickups
      .map(p => p.tag ? `${p.icon} ${p.name} — ${p.tag}` : `${p.icon} ${p.name}`)
      .join(' · ');

    const resp = await admin.messaging().sendEachForMulticast({
      notification: {
        title: '\u{1F514} Pickup tomorrow',
        body
      },
      data: { kind: 'pickupReminder' },
      tokens: entries.map(e => e.token)
    });

    const stale = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];
    const updates = {};
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error && stale.includes(r.error.code)) {
        updates[`tokens/${entries[i].owner}/${entries[i].key}`] = null;
      }
    });
    if (Object.keys(updates).length) await admin.database().ref().update(updates);
  }
);
