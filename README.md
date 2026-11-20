# Ghostline

Real-world hide and seek for phones. The host draws a play zone, friends join with a 4-letter code, a seeker is picked at random, and hiders' phones ping a fuzzy spot to the seekers on a timer.

## Play
Open the game link on your phone, allow location, create a game and share the code or QR.
Play somewhere safe and public. Locations are only shared with players in your game while it runs, and nothing is stored.

## Game modes (mix and match in the lobby)
Infection, Jailbreak, Fugitive, Starter power-ups, Supply drops, Missions, Capture points, Hot potato, Final sprint, Shrinking zone, Strict zone.
Tags: GPS range, honor tag (they confirm) or photo tag (snap them, they confirm). The host settles disputes.

## Mini games (toggle in the lobby)

- **Treasure drops:** a chest pops up in the open about every 90 s. A hider who grabs it gets +30, but their exact spot pings to the seekers.
- **Quick-fire trivia:** every 2 min each hider gets a question with 15 s to answer. A right answer earns a free decoy.
- **Live Wire:** one hider holds the wire and sees where the other hiders are. Walking within 15 m of one passes it. Passing doesn't reset the fuse (1 to 10 min, set in the lobby). Whoever holds it when the fuse runs out goes live: seekers see their exact spot for the rest of the round. A new wire goes to someone else a minute later.

## Seeker alarm

When a seeker gets close, the hider's phone plays "wanna sprite cranberry?" on repeat (the clip from the mafia game, `public/audio/sprite-cranberry.m4a`). The closer the seeker, the louder it plays and the shorter the gap between plays, until it runs back to back. The host sets the range in the lobby under **Seeker alarm** (Off, or 20 to 200 m, default 50 m). Seekers' phones share their spot every 3 s for this, and it's never shown on anyone's map. Hiders never send their spot for it.

## Screens stay on

From the moment you join, the game keeps your screen from dimming or locking (Wake Lock, or a tiny silent looping video on phones without it). A web page can't block the power button, so during the hunt a hider who turns off their screen or leaves the app sends their exact spot to the seekers, and everyone is told. A seeker who does it is just called out.

## Tagging

GPS tag range is set in 10 m steps (10 to 50 m). A tag that reaches nobody costs the seeker 10 points (never below 0). A too-close-to-call tag on weak GPS costs nothing.

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
