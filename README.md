# Ghostline

Real-world hide and seek for phones. The host draws a play zone, friends join with a 4-letter code, a seeker is picked at random, and hiders' phones ping a fuzzy spot to the seekers on a timer.

## Play
Open the game link on your phone, allow location, create a game and share the code or QR.
Play somewhere safe and public. Locations are only shared with players in your game while it runs, and nothing is stored.

## Game modes (mix and match in the lobby)
Infection, Jailbreak, Fugitive, Starter power-ups, Supply drops, Missions, Capture points, Hot potato, Final sprint, Shrinking zone, Strict zone.
Tags: GPS range, honor tag (they confirm) or photo tag (snap them, they confirm). The host settles disputes.

## How it works
- `public/` is a static web app (no build step). Phones sync over Supabase Realtime (broadcast + presence, no tables), set in `public/config.js`.
- `server.js` serves `public/` and a WebSocket relay for play-testing on your own Wi-Fi: `npm install && npm start`.
- `test/sim.mjs` plays full rounds with 4 simulated phones.
