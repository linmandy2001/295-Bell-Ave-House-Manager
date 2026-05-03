# 295 Bell Ave House Manager

## Overview
A Progressive Web App (PWA) for managing household chores, expenses, announcements, and notes for the house at 295 Bell Ave. Roommates can sync data in real-time via Firebase Realtime Database.

## Project Structure
```
House-Chores/
  index.html      - Single-page app (all HTML, CSS, JS in one file)
  manifest.json   - PWA manifest
  sw.js           - Service worker for offline support and push notifications
  vercel.json     - Rewrite rules (used for reference; not active here)
package.json      - Node.js project with `serve` for local development
```

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JavaScript (no build step)
- **Database**: Firebase Realtime Database (syncs across all roommates)
- **PWA**: Service worker for offline support
- **Server**: `serve` (npm package) for local static file serving

## Running Locally
```bash
npm start
```
Serves `House-Chores/` on port 5000.

## Deployment
Configured as a **static** deployment pointing to the `House-Chores/` directory.

## Firebase
The app uses Firebase Realtime Database at:
`https://house-chores-5adf7-default-rtdb.firebaseio.com/`

Firebase config is embedded in `index.html`. If the database URL shows a 404, the Firebase project may need to be initialized or the config updated.
