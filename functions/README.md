# Bell House — Cloud Functions

This folder holds the Cloud Function that delivers a Web Push notification when a new entry appears at `/nudges/{id}` in the Realtime Database.

## One-time setup (do this once on your machine)

1. Install the Firebase CLI: `npm install -g firebase-tools`
2. From the repo root, run `firebase login`.
3. Run `firebase use house-chores-5adf7`. (If `firebase.json` is missing, run `firebase init` and pick **Functions** + the existing project; do **not** overwrite `functions/index.js`.)
4. In the Firebase Console: **Project Settings → Cloud Messaging → Web configuration → Generate key pair**. Copy the resulting VAPID public key.
5. Open `House-Chores/index.html`, find `FCM_VAPID_KEY`, and paste the key there.
6. Deploy: `firebase deploy --only functions`.

The free Spark plan covers this trigger. Scheduled functions (e.g. nightly cleanup) are **not** used because they require Blaze; the client cleans up nudges older than 30 days on app load instead.

## How push delivery works

1. Roommate A taps **Nudge** → client writes `/nudges/{key}` with `to`, `from`, `choreId`, `choreName`, `time`.
2. The `sendNudge` function fires, looks up `/tokens/{name}/*`, and calls `admin.messaging().sendEachForMulticast(...)`.
3. Recipient's browser/PWA receives the push and `firebase-messaging-sw.js` shows the notification.
4. Foreground clients also see an in-app toast (`messaging.onMessage`) plus the existing realtime-DB listener still removes the `/nudges/{key}` row after delivery so storage doesn't grow.

## iOS caveat

Web Push on iOS only fires if the user has installed the PWA via Safari → **Share → Add to Home Screen**. There is no way around this from the web; it is an Apple platform restriction.
