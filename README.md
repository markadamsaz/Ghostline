# Ghostline

Real-world hide and seek for phones. The host draws a play zone, friends join with a 4-letter code, seekers are picked at random (or by the host), and hiders' phones ping a fuzzy spot to the seekers on a timer.

## Play
Open the game link on your phone, allow location, create a game and share the code or QR.
Play somewhere safe and public. Locations are only shared with players in your game while it runs, and nothing is stored.

## Game modes (mix and match in the lobby)
Infection, Jailbreak, Fugitive, Starter power-ups, Supply drops, Missions, Capture points, Hot potato, Final sprint, Shrinking zone, Strict zone.
Tags: GPS range, honor tag (they confirm) or photo tag (snap them, they confirm). The host settles disputes.

## Mini games (toggle in the lobby)

- **Treasure drops:** a chest pops up in the open about every 90 s. A hider who grabs it gets +30, but their exact spot pings to the seekers.
- **Showdown:** every few minutes (the host picks how often) two random hiders, anywhere in the zone, face off in a quick game: rock paper scissors, a tap race, a reaction test or a memory pattern. The winner gets +25 and the loser loses nothing. With an odd number of hiders one sits it out; a hider who doesn't play in 45 s, or gets caught, loses.
- **Live Wire:** one hider holds the wire and sees where the other hiders are. Walking within 15 m of one passes it. Passing doesn't reset the fuse (1 to 10 min, set in the lobby). Whoever holds it when the fuse runs out goes live: seekers see their exact spot for the rest of the round. A new wire goes to someone else a minute later.

## Picking the seekers

Under **Rules & settings**, **Seeker pick** is Random (the default: the Seekers count picks that many, favouring whoever has sought least) or Host picks. With Host picks, a **Pick the seekers** card lists everyone in the lobby: the host taps each player who starts as a seeker (any number, as long as one player is left to hide). In Fugitive mode the host taps the one runner instead. Other phones see who was picked. Picks reset after each round.

## Seeker alarm

When a seeker gets close, the hider's phone plays the alarm clip on repeat (`public/audio/seeker-alarm.m4a`). The closer the seeker, the louder it plays and the shorter the gap between plays, until it runs back to back. The host sets the range in the lobby under **Seeker alarm** (Off, or 20 to 200 m, default 50 m). Seekers' phones share their spot every 3 s for this, and it's never shown on anyone's map. Hiders never send their spot for it.

## Screens stay on

From the moment you join, the game keeps your screen from dimming or locking (Wake Lock, or a tiny silent looping video on phones without it). A web page can't block the power button, so during the hunt a hider who turns off their screen or leaves the app sends their exact spot to the seekers, and everyone is told. A seeker who does it is just called out.

## Tagging

GPS tag range is set in 10 m steps (10 to 50 m). A tag that reaches nobody costs the seeker 10 points (never below 0). A too-close-to-call tag on weak GPS costs nothing.

## Points shop

Points you earn (survival minutes, catches, missions, flags, extraction) can be spent. Each player sees picks for their own role during a round; picks bought in the lobby wait for a round where you have that role.

- Hiders: Decoy 50 (your next ping shows a spot you pick), Jammer 50 (skip your next ping), Sonar 50 (see every seeker for 30 s), Peek 65 (see the nearest seeker for 10 s), Cloak 75 (your next ping is hidden), Escape pass 150 (get away from one catch)
- Seekers: Radar 50, Hot trail 75 (arrow to the nearest hider for 20 s), Lockdown 90 (hiders can't use power-ups for 30 s), Spotlight 100 (one hider's exact spot for 10 s)
- Hider sabotage: Pickpocket 55 (steal a power-up from another hider, or 40 points), Mirror 60 (the next power aimed at you bounces back), Phantoms 65 (seekers see 3 fake pings), Scramble 70 (seekers' maps blur for 20 s), Frame 80 (another hider pings now and your next ping is hidden), Butterfingers 90 (seekers can't tag for 20 s), Snitch 110 (another hider's exact spot pings to the seekers, even through a cloak), Fast forward 120 (1 minute off the clock)
- Seeker sabotage: Siren 45 (every hider's phone blares the alarm for 6 s), Truth lens 50 (decoys, swarm fakes and phantoms vanish from your map for 60 s), Firewall 50 (blocks the next hider sabotage on you), Flashbang 55 (one hider's screen goes white for 5 s), Tax 60 (up to 15 points from every hider), Fog 70 (hiders' maps go dark for 30 s), Silencer 80 (hiders' alarms go quiet for 45 s), Overtime 120 (1 minute on the clock)
- Anyone hit by sabotage is told who did it. Aimed powers (Snitch, Frame, Pickpocket, Flashbang, Spotlight) bounce off a Mirror: back onto a hider who used them, or wasted for a seeker (a Flashbang flashes the seeker instead).
- Characters (art from the Mafia game, shown as your avatar and your own map dot): Common 100 (Toad, Toadette, Crewmate), Rare 200 (Yoshi, Luigi, Peach, Mike, Rumi, Sparky, Clawd, Gooigi and the Phantom, Wraith, Ember and Crimson ghosts), Epic 350 (Pikachu, Shrek, Gru, Kirby, Specter), Legendary 600 (Mewtwo, Godzilla, Mega Clawd, Rolling Hero). Once bought, a character is yours forever: it's saved on the phone, and on the account when signed in (so it follows you to other phones). Switching back to one you own is free.
- Shapes 10, colors 5

## Settings

The gear (on the home screen, and in the top bar during a game) opens Settings. Signed-in players see their account there: name, points, username, their password (the account server only stores it hashed, so the phone keeps its own copy from signing in or changing it there; it's deleted on sign out), Change password and Sign out. Everything else is saved on the phone:
Appearance (Automatic, Light or Dark), Map (Satellite or Streets), Vibration, Chat sounds and Animations (off reduces motion), plus location, the how-to-play film and the map key. Game sounds and the seeker alarm always play.

## GPS accuracy

Phones ask for their most accurate fresh fix. A weak fix (worse than 30 m) is skipped while a recent good one exists, and the last few fixes are averaged to smooth out jitter. Each player sees their accuracy (GPS ±N m) in the top bar. A tag counts inside the tag range plus a few meters for normal GPS error. If either phone's GPS is weak, only a tag inside half the range counts, and the seeker is told to get closer. Phone GPS is about 5 to 10 m outdoors at best and worse indoors, so for small areas use a 20 to 30 m tag range and Exact or 10 m ping fuzz.

## How it works
- `public/` is a static web app (no build step). Phones sync over Supabase Realtime (broadcast + presence, no tables), set in `public/config.js`.
- `server.js` serves `public/` and a WebSocket relay for play-testing on your own Wi-Fi: `npm install && npm start`.
- `test/sim.mjs` plays full rounds with 4 simulated phones.

## Look and motion

The UI follows iOS conventions: system font (SF on Apple devices), grouped cards, frosted bars, iOS switches and segmented controls, light and dark mode, and one tint (iMessage blue, `#007AFF`). Panels are frosted glass: translucent, blurred, with a bright top edge, over a soft blue wash. Seekers are blue, hiders are graphite.

The home screen's radar loop and the "Watch how it works" film are made with [HyperFrames](https://hyperframes.heygen.com) in `motion/hero` and `motion/how-to-play` (HTML + GSAP rendered to MP4). To change one, edit its `index.html`, then render and re-encode into `public/media/` (needs Node 22+ and ffmpeg):

```
cd motion/how-to-play && npx hyperframes render -o renders/how-to-play.mp4
ffmpeg -i renders/how-to-play.mp4 -vf scale=720:900,format=yuv420p -c:v libx264 -crf 27 -an -movflags +faststart ../../public/media/how-to-play.mp4
```
