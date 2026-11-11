// The installed shell. It starts the UI from the Ciniva server's `tv-ui` plugin when the server has a newer one
// than this package, so updates reach the TV without reinstalling it, and falls back to the UI bundled here.
//
// - The UI is fetched only when signed in (plugin files need a Ciniva session); sign-in itself runs the bundled UI.
// - The last server UI that started is kept in localStorage, so it still starts when the server is down. A new download
//   waits as `uiNext` and only replaces the kept one once it has started. When the server answers with nothing newer
//   than the package (the plugin was updated or rolled back to it), the kept copy is dropped.
// - A server UI declares the oldest shell it works with (`shell` in ui.json). A newer requirement keeps the bundled UI
//   until this package is updated.
// - A server UI that never finishes starting is skipped on the next launch (C.app calls CinivaShell.started()).
// - Only interfaces signed by the Ciniva release key run (verify.js): the server's manifest must carry a valid signature
//   and every file must match its signed hash, checked on download and again before each start of a kept copy.
(function () {
  'use strict';

  const SHELL = 1;
  const PLUGIN = '/api/plugins/tv-ui/ui/tv/';
  const KEY = 'ciniva.';

  function read(name) {
    try {
      return localStorage.getItem(KEY + name);
    } catch (e) {
      return null;
    }
  }
  function write(name, value) {
    try {
      if (value === null) localStorage.removeItem(KEY + name);
      else localStorage.setItem(KEY + name, value);
      return true;
    } catch (e) {
      return false; // Full or blocked: the server UI then runs without being kept.
    }
  }

  function get(url, token, timeout) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('GET', url);
      if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
      x.timeout = timeout;
      x.onload = () => (x.status === 200 || (x.status === 0 && x.responseText) ? resolve(x.responseText) : reject(new Error('HTTP ' + x.status)));
      x.onerror = () => reject(new Error('network'));
      x.ontimeout = () => reject(new Error('timeout'));
      x.send();
    });
  }

  function newer(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }

  function parse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  /// One build of the UI: its version and the plugin's fingerprint of its files.
  const id = (ui) => ui.version + '+' + (ui.build || '');
  const usable = (ui) => !!ui && ui.shell <= SHELL && read('uiBad') !== id(ui);

  /// The server's UI when it's newer than `bundled` and runs on this shell; downloads it unless already here.
  /// BUNDLED when the server answers with nothing newer than the package: its interface is the package's (or older),
  /// so a kept copy from earlier is stale. null when the server's newer UI can't be used; throws when unreachable.
  const BUNDLED = {};
  async function fromServer(bundled, kept) {
    const server = read('server');
    const token = read('token');
    if (!server || !token) return null;
    const answer = parse(await get(server + PLUGIN + 'ui.json', token, 4000));
    // Unsigned or not signed by our key: the server's interface never runs.
    const m = answer && window.CinivaVerify.manifest(answer.signed);
    if (!m) return null;
    if (!newer(m.version, bundled.version)) return BUNDLED;
    const info = { version: m.version, shell: m.shell, build: answer.build || '' };
    if (!usable(info)) return null;
    // `build` fingerprints the files, so a different build under the same version is downloaded again.
    const same = (ui) => !!ui && ui.version === info.version && ui.build === info.build;
    if (same(kept)) return kept;
    const next = parse(read('uiNext'));
    if (same(next)) return next;
    const names = m.css.concat(m.js).map((f) => f[0]);
    const texts = await Promise.all(names.map((f) => get(server + PLUGIN + f, token, 20000)));
    const files = names.map((f, i) => [f, texts[i]]);
    if (!window.CinivaVerify.files(m, files)) throw new Error('files differ from the signed manifest');
    const ui = { version: info.version, build: info.build, shell: info.shell, signed: answer.signed, css: files.slice(0, m.css.length), js: files.slice(m.css.length) };
    write('uiNext', JSON.stringify(ui));
    return ui;
  }

  /// A stored or downloaded interface is still exactly what the release key signed.
  function trusted(ui) {
    const m = window.CinivaVerify.manifest(ui.signed);
    return !!m && m.version === ui.version && m.shell === ui.shell && window.CinivaVerify.files(m, ui.css.concat(ui.js));
  }

  function start(ui, source, bundled) {
    window.CinivaShell.ui = { version: ui.version, build: ui.build || '', source: source };
    window.CinivaShell.bundled = bundled.version;
    const head = document.head;
    if (source === 'bundled') {
      ui.css.forEach((f) => head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: f })));
      // Classic scripts added this way run in insertion order once async is off.
      ui.js.forEach((f) => head.appendChild(Object.assign(document.createElement('script'), { src: f, async: false })));
      return;
    }
    write('uiPending', id(ui));
    ui.css.forEach((f) => head.appendChild(Object.assign(document.createElement('style'), { textContent: f[1] })));
    ui.js.forEach((f) => head.appendChild(Object.assign(document.createElement('script'), { textContent: f[1] + '\n//# sourceURL=' + f[0] })));
  }

  async function boot() {
    const bundled = parse(await get('ui.json', null, 4000).catch(() => null));
    let kept = parse(read('ui'));
    // The kept UI started last time, or it never got going: then skip that version.
    const pending = read('uiPending');
    if (pending) {
      write('uiBad', pending);
      write('uiPending', null);
      const next = parse(read('uiNext'));
      if (next && id(next) === pending) write('uiNext', null);
    }
    if (kept && !(usable(kept) && trusted(kept))) {
      write('ui', null);
      kept = null;
    }
    let ui = null;
    let source = 'server';
    if (bundled) {
      try {
        ui = await fromServer(bundled, kept);
      } catch (e) {
        // Server or plugin unreachable: keep going with what's here.
      }
      if (ui === BUNDLED) {
        write('ui', null);
        write('uiNext', null);
        ui = null;
        kept = null;
      }
      if (!ui && kept && newer(kept.version, bundled.version)) {
        ui = kept;
        source = 'kept';
      }
    }
    if (ui && !trusted(ui)) {
      write('uiNext', null);
      ui = null;
    }
    if (ui) start(ui, source, bundled);
    else start(bundled || FALLBACK, 'bundled', bundled || FALLBACK);
  }

  // Load order if ui.json can't be read; kept in step with ui.json by scripts/check.sh.
  const FALLBACK = {
    version: '0.4.0',
    shell: 1,
    css: ['css/app.css'],
    js: ['js/util.js', 'js/api.js', 'js/focus.js', 'js/keyboard.js', 'js/ui.js', 'js/episodes.js', 'js/plugins.js',
      'js/screens.js', 'js/details.js', 'js/login.js', 'js/player.js', 'js/live.js', 'js/app.js'],
  };

  window.CinivaShell = {
    version: SHELL,
    /// The UI running: { version, source: 'bundled' | 'server' (checked against the server) | 'kept' (server down) }.
    ui: null,
    /// The UI version in this package.
    bundled: null,
    /// The UI booted; its version is good.
    started() {
      write('uiPending', null);
      const ui = window.CinivaShell.ui;
      if (!ui || ui.source === 'bundled') return;
      const next = read('uiNext');
      const parsed = next && parse(next);
      if (parsed && parsed.version === ui.version && (parsed.build || '') === (ui.build || '')) {
        write('ui', next);
        write('uiNext', null);
      }
    },
    /// After sign-in: if the server has a newer UI, restart into it.
    async refresh() {
      const current = window.CinivaShell.ui;
      if (!current) return false;
      try {
        const ui = await fromServer(current, parse(read('ui')));
        if (ui && newer(ui.version, current.version)) {
          location.reload();
          return true;
        }
      } catch (e) {
        // Stay on this UI.
      }
      return false;
    },
  };

  boot();
})();
