# Ghostline

Real-world hide and seek for phones. The host draws a play zone, friends join with a 4-letter code, a seeker is picked at random, and hiders' phones ping a fuzzy spot to the seekers on a timer.

## Play
Open the game link on your phone, allow location, create a game and share the code or QR.
Play somewhere safe and public. Locations are only shared with players in your game while it runs, and nothing is stored.

## Game modes (mix and match in the lobby)
Infection, Jailbreak, Fugitive, Starter power-ups, Supply drops, Missions, Capture points, Hot potato, Final sprint, Shrinking zone, Strict zone.
Tags: GPS range, honor tag (they confirm) or photo tag (snap them, they confirm). The host settles disputes.

## Points shop

Points you earn (survival minutes, catches, missions, flags, extraction) can be spent. Each player sees picks for their own role during a round; picks bought in the lobby wait for a round where you have that role.

- Hiders: Power-up 40, Peek 50 (see the nearest seeker for 10 s), Cloak 60 (no pings for 30 s), Escape pass 120 (get away from one catch)
- Seekers: Radar 40, Hot trail 60 (arrow to the nearest hider for 20 s), Lockdown 70 (hiders can't use power-ups for 30 s), Spotlight 80 (one hider's exact spot for 10 s)
- Anyone: Map icon 25

## GPS accuracy

Phones ask for their most accurate fresh fix. A weak fix (worse than 30 m) is skipped while a recent good one exists, and the last few fixes are averaged to smooth out jitter. Each player sees their accuracy (GPS ±N m) in the top bar. A tag counts inside the tag range plus a few meters for normal GPS error. If either phone's GPS is weak, only a tag inside half the range counts, and the seeker is told to get closer. Phone GPS is about 5 to 10 m outdoors at best and worse indoors, so for small areas use a 20 to 30 m tag range and Exact or 10 m ping fuzz.

## How it works
- `public/` is a static web app (no build step). Phones sync over Supabase Realtime (broadcast + presence, no tables), set in `public/config.js`.
- `server.js` serves `public/` and a WebSocket relay for play-testing on your own Wi-Fi: `npm install && npm start`.
- `test/sim.mjs` plays full rounds with 4 simulated phones.
