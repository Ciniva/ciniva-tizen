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
- **Live TV:** channels a plugin lists play live through Ciniva (HLS in MPEG-TS, H.264/HEVC copied when possible) with the channel logo, a LIVE badge and no seek bar. CH+/CH− or ↑ ↓ change channel within the list, OK pauses, Back leaves; a dropped stream reconnects on its own and a dead channel offers a retry.
- **Settings:** default quality, subtitle size, skip step, remembered languages, library scan (administrators), sign out, and the app version, which checks GitHub for a newer release.

## Install

Releases contain `Ciniva-<version>-tizen.wgt`, signed with the Ciniva author certificate. Install it on a TV in developer mode whose Host PC IP is the machine you install from:

```sh
sdb connect <tv ip>
tizen install -n Ciniva-<version>-tizen.wgt -t <tv name from sdb devices>
```

To install a build you signed yourself (for example a pull request's unsigned artifact), unpack it and package the directory, since the Tizen CLI doesn't re-sign a finished `.wgt`:

```sh
mkdir ciniva && cd ciniva && unzip ../Ciniva-<version>-tizen.wgt && cd ..
tizen package -t wgt -s <certificate profile> -- ciniva
tizen install -n "$(basename ciniva/*.wgt)" -t <tv name from sdb devices> -- ciniva
```

The TV refuses to upgrade an app signed with a different certificate, so a TV with a self-signed build needs it uninstalled before installing a release. The app can't update itself, because installing packages needs a platform privilege. It does show in Settings when a newer release exists.

## Updates from the server

The installed app is a shell around the interface. When the Ciniva server runs the `tv-ui` plugin and it has a newer interface than the app, the TV runs the server's, so an update reaches every TV through a new plugin image, with no reinstall:

- **Signed in:** at every start the app asks the plugin for `ui.json`. A newer version is downloaded, saved on the TV, and started.
- **Server down:** the TV starts the last server interface that worked.
- **First start, sign-in, or no plugin:** the TV uses the interface built into the app.
- **Broken interface:** an interface that never finishes starting is skipped at the next start, and the TV goes back to the last good one.
- **Compatibility:** `ui.json` names the oldest shell it runs on (`shell`, `SHELL` in `src/boot.js`). Change it only when the interface needs something new from the installed app, such as a new privilege. TVs on an older shell keep their current interface until the app is reinstalled.

Settings → About shows the app's version and where the interface came from.

The plugin is `ghcr.io/ciniva/ciniva-tizen-ui`. It's built from this repository (`plugin/` and `src/`), and a `v<VERSION>` tag publishes it. Run it next to Ciniva like the other plugins:

```yaml
  ciniva-tv-ui:
    image: ghcr.io/ciniva/ciniva-tizen-ui:latest
    environment:
      CINIVA_URL: http://ciniva:8484
      CINIVA_PLUGIN_SECRET_FILE: /run/secrets/ciniva_plugin_secret
      PLUGIN_URL: http://ciniva-tv-ui:8092
    secrets: [ciniva_plugin_secret]
    read_only: true
    restart: unless-stopped
```

## Develop

Open `src/index.html` from any local web server in a desktop Chromium at 1920×1080. Arrow keys, Enter and Esc/Backspace stand in for the remote. AVPlay isn't there, so the player falls back to `<video>`, which plays direct MP4/H.264 but no HLS.

`sh scripts/check.sh` checks what the TV can run: ES2017 syntax (acorn), no DOM API or CSS newer than Chromium 69, and the same version in `VERSION`, `src/config.xml` and `src/js/app.js`.

Code map (`src/js`, the interface: classic scripts on one `window.C` namespace, in load order):

| File | Contents |
|---|---|
| `util.js`, `api.js` | helpers; API client (Bearer header for calls, `?token=` for media URLs) |
| `focus.js` | D-pad focus: layers, rows and columns with memory, geometry between them |
| `keyboard.js`, `ui.js` | on-screen keyboard; rail, hero, cards, rows, menus, dialogs |
| `episodes.js`, `plugins.js` | episode order; plugin views, actions and settings, server events |
| `screens.js`, `details.js`, `login.js` | home, grids, search, settings; movie and show pages; sign-in |
| `player.js`, `live.js`, `app.js` | AVPlay / `<video>` player; live channel player; screen stack, keys, update check, startup |

Outside `src/js`: `src/boot.js` is the shell that picks and starts the interface. `src/ui.json` lists the interface's files in load order; `scripts/check.sh` keeps it complete. `plugin/` is the `tv-ui` plugin that serves the interface.

## Remote

- **Browsing:** arrows move, OK opens, Back goes back. Back on Home asks to exit.
- **Player, controls hidden:** ← → skip (10 s by default, faster while held), OK pauses and shows the controls, ↑ ↓ show the controls, Back leaves.
- **Player, controls shown:** arrows move, Back hides them.
- **Media keys:** play, pause, stop, fast-forward (30 s), rewind, and previous/next track for previous/next episode.
- **Live TV:** OK plays a channel (→ opens its other actions); in the player CH+/↑ next channel, CH−/↓ previous, OK or play/pause pauses, Back leaves.

## Releases

Pull requests and manual runs of the App workflow build an unsigned `.wgt` as a workflow artifact. The Plugin workflow tests the `tv-ui` plugin on pull requests, and publishes its image on tags (`<VERSION>` and `latest`) and on manual runs (a commit tag). Pushing a tag `v<VERSION>` (matching `VERSION`, on `main`) runs the Release workflow. It waits for approval in the `release` environment, which holds the signing secrets, then signs the app and publishes release `v<VERSION>` with the signed `.wgt` and its SHA-256.
