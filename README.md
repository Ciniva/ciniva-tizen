# Ciniva for Samsung TV

[Ciniva](https://github.com/Ciniva/ciniva) on Samsung Tizen TVs: browse and play your library with the remote. It's a Tizen web app (plain JavaScript, no build step) targeting Tizen 5.5 (2020 TVs, Chromium 69) and newer. Feature parity target: the Ciniva web UI.

## What it does

- **Library:** home with a hero for the focused item and rows (Continue watching, recently added, Movies, Shows); movie and show grids with sorting; movie and show pages with seasons, episodes and an episode sheet; search with an on-screen keyboard (Latin and Cyrillic, and the remote's number keys).
- **Playback:** Samsung's AVPlay. Files the TV decodes play directly, with seeking: H.264 and HEVC (including HDR10) in MKV, MP4 or TS, with AAC, AC-3, E-AC-3 or MP3 audio. Everything else streams from Ciniva as HLS in MPEG-TS:
  - a remux at Original quality;
  - an encode at the lower qualities;
  - Dolby Vision is always stripped, because Tizen 5.5 freezes on HEVC in fMP4 and stalls on DV metadata.
- **Player features:** a resume prompt and progress reports, and ← → seeking that speeds up while held, with trickplay thumbnails. Audio, subtitle (text formats, drawn by the app) and quality menus; previous and next episode; skip credits and up next.
- **Plugins:** plugin pages appear in the rail, plugin actions (e.g. *Find downloads*) on movie, show and season pages, and plugin settings under Settings for administrators. Server notifications show as toasts.
- **Settings:** default quality, subtitle size, skip step, remembered languages, library scan (administrators), sign out, and the app version, which checks GitHub for a newer release.

## Install

Releases contain an **unsigned** `Ciniva-<version>-tizen.wgt`. Sign it with your Tizen author certificate and install it to a TV in developer mode, whose Host PC IP is the machine you install from:

```sh
tizen package -t wgt -s <certificate profile> -- Ciniva-0.1.0-tizen.wgt
sdb connect <tv ip>
tizen install -n Ciniva-0.1.0-tizen.wgt -t <tv name from sdb devices>
```

Use the same certificate for every version; the TV refuses to upgrade an app signed with a different one. The app can't update itself, because installing packages needs a platform privilege. It does show in Settings when a newer release exists.

## Develop

Open `src/index.html` from any local web server in a desktop Chromium at 1920×1080. Arrow keys, Enter and Esc/Backspace stand in for the remote. AVPlay isn't there, so the player falls back to `<video>`, which plays direct MP4/H.264 but no HLS.

`sh scripts/check.sh` checks what the TV can run: ES2017 syntax (acorn), no DOM API or CSS newer than Chromium 69, and the same version in `VERSION`, `src/config.xml` and `src/js/app.js`.

Code map (`src/js`, classic scripts on one `window.C` namespace, in load order):

| File | Contents |
|---|---|
| `util.js`, `api.js` | helpers; API client (Bearer header for calls, `?token=` for media URLs) |
| `focus.js` | D-pad focus: layers, rows and columns with memory, geometry between them |
| `keyboard.js`, `ui.js` | on-screen keyboard; rail, hero, cards, rows, menus, dialogs |
| `episodes.js`, `plugins.js` | episode order; plugin views, actions and settings, server events |
| `screens.js`, `details.js`, `login.js` | home, grids, search, settings; movie and show pages; sign-in |
| `player.js`, `app.js` | AVPlay / `<video>` player; screen stack, keys, update check, startup |

## Remote

- **Browsing:** arrows move, OK opens, Back goes back. Back on Home asks to exit.
- **Player, controls hidden:** ← → skip (10 s by default, faster while held), OK pauses and shows the controls, ↑ ↓ show the controls, Back leaves.
- **Player, controls shown:** arrows move, Back hides them.
- **Media keys:** play, pause, stop, fast-forward (30 s), rewind, and previous/next track for previous/next episode.

## Releases

Pull requests and manual runs build the `.wgt` as a workflow artifact. Pushing a tag `v<VERSION>` (matching `VERSION`) publishes release `v<VERSION>` with the `.wgt`.
