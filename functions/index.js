const { onValueCreated } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

admin.initializeApp();

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
