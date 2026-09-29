# Golf Outing Sweep

A free, offline-first Progressive Web App for running a golf outing sweep. Everything is stored on the organiser's phone. No accounts, servers, fonts, libraries or network calls.

## 1. Architecture

- **Vanilla HTML/CSS/JS**, no framework, no build step.
- `js/core.js`: pure logic (secure shuffle, derangement, validation, CSV/text exports, PIN hashing, backup validation). Testable in Node.
- `js/app.js`: UI. One state object `S` saved to `localStorage` (`golf-outing-sweep.v1`); views are functions returning HTML; one delegated click/input handler.
- `sw.js`: precaches every file, cache-first, so the app runs offline after first load.
- Icons are an inline SVG sprite in `index.html`; app icons are local PNG/SVG.
- **Draw integrity**: the full allocation (a uniform random derangement via rejection sampling, validated) is created before the first reveal and stored. The reel only animates to the stored result. A reveal is recorded the moment the button is pressed, so closing the app mid-spin can never allow a second pick; on reopening, that golfer sees "Show my player".
- **Practice mode** uses an in-memory outing and never touches saved data.

## 2. Screen map and flow

```
Launch -> [PIN gate if set] -> Home
Home -> Create New Outing -> Set Up -> Confirm -> Payments
Bottom nav: Home | Players | Payments | To Pick | More
More -> Draw List | Status | Enter Results | Prize Giving | History | Practice | Settings
Still to Pick -> Player screen (kiosk) / Start draw as X / All-player status

Kiosk (player mode): Who are you? -> You are drawing as X? -> (unpaid message) -> Make Your Pick
   -> single-reel spin -> "Your player is" -> Done -> Who are you? (next golfer)
Kiosk -> lock icon -> PIN, or press-and-hold 1s -> Organiser mode

Results -> Prize Giving (reveal one by one / show all / share) -> Complete Outing -> History
```

## 3. Files

```
index.html            shell + inline SVG icon sprite
styles.css            theme
js/core.js            pure logic
js/app.js             UI
sw.js                 service worker
manifest.webmanifest  PWA manifest
icons/                icon.svg, icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png
README.md
```

## 4. Test locally

Service workers need `localhost` or HTTPS:

```
cd golf-outing-sweep
python3 -m http.server 8080
```
Open http://localhost:8080. Then in DevTools > Application confirm the service worker is active, tick "Offline", reload: the app should still work.
To try on a phone on the same Wi-Fi, use a hosted HTTPS URL (see below), because iPhone Safari will not install from plain http on your LAN.

## 5. Install on iPhone

1. Open the hosted HTTPS URL in **Safari**.
2. Tap Share > **Add to Home Screen** > Add.
3. Open it once from the home screen while online (this caches everything), then try airplane mode.

## 6. Free hosting (any one)

- **GitHub Pages**: push the folder to a repo, Settings > Pages > deploy from `main` root.
- **Cloudflare Pages / Netlify**: drag and drop the folder; no build command, output directory is the folder.
The URL must be HTTPS (all of these are).

**Updating**: change files, then bump `CACHE_VERSION` in `sw.js` (e.g. `gos-v2`) or installed copies keep the old version. Data is untouched by updates.

**Renaming**: change it in Settings > App name (in-app), and edit `name`/`short_name` in `manifest.webmanifest`, `<title>` in `index.html` and `apple-mobile-web-app-title` if you want the home-screen label changed.

## 7. Test plan

1. Add 5 players (try pasting a list); add a duplicate name (blocked/needs label); archive and restore.
2. Set up outing with 2 golfers: each must draw the other. Repeat with 6.
3. With "Require payment" on, an unpaid golfer sees the hand-back message; mark paid and retry.
4. Draw for everyone: nobody gets themselves, every golfer appears once (check Draw List). The next golfer never sees the previous result.
5. Kill/refresh the app mid-spin: golfer is not in the list, resume shows their same player; they cannot draw again.
6. Still to Pick shrinks after each Done and shows the success message at the end.
7. Enter results (a golfer can't be in two places), check "Drawn by", add extra competitions, run Prize Giving, Complete Outing, then check History, CSV/text export, duplicate, reopen, delete.
8. Export backup, erase all data, import backup; try a corrupted/edited file (must be rejected).
9. Set a PIN; check wrong PIN is refused. Without PIN, hold-to-enter works.
10. Reset draw needs typing RESET. Practice mode leaves real data unchanged.
11. Airplane mode after install; reduced-motion on; larger text size.

## 8. Requirement checklist

| Requirement | Where |
|---|---|
| Installable PWA, offline, no server/account | manifest, `sw.js`, localStorage |
| Master list: add/edit/archive/search/paste/duplicates/labels | Players |
| Outing setup, guests, min 2, confirmation | Set Up Outing |
| Payments, filter, reversal, pay-before-draw setting | Payments, Settings |
| Player-safe Who are you / confirm / unpaid message | Kiosk |
| Single vertical reel 3-5s, ease-out, lands on stored result, sound/vibration/reduced motion | Reel |
| Derangement, validated, locked after first reveal, audit times | `core.js`, Draw List |
| Optional hashed PIN / press-and-hold | Organiser access |
| Still to Pick, combined status | Still to Pick, Status |
| Draw list with sort, hide, export | Draw List |
| Results, prizes, extras, prize giving, complete | Results, Prize Giving |
| History with export/duplicate/reopen/delete | History |
| JSON backup/restore with validation | Settings |
| Practice mode | More > Practice |
| Storage-failure banner, refresh/close resilience | `app.js` |
| Accessibility: large targets, labels, focus, non-colour status | CSS + markup |

Known limits: iOS Safari has no vibration API; PIN is a deterrent (4 digits, hashed locally), not strong security; data lives in one browser, so back it up.
