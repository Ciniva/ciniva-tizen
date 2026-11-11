// Screen stack, sign-in state and startup.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;

  C.VERSION = '0.4.0';

  const stack = [];
  const host = () => document.getElementById('screens');
  const top = () => stack[stack.length - 1] || null;

  function mount(screen) {
    const prev = top();
    if (prev) prev.el.classList.add('hidden');
    stack.push(screen);
    host().appendChild(screen.el);
    screen.layer = {
      root: screen.el,
      initial: screen.initial,
      onKey: screen.onKey,
      onFocus: screen.onFocus,
      onBack: () => (screen.onBack ? screen.onBack() : C.app.back()),
    };
    C.focus.push(screen.layer);
    if (screen.load) run(screen);
  }

  function unmount(screen) {
    const i = stack.indexOf(screen);
    if (i >= 0) stack.splice(i, 1);
    C.focus.pop(screen.layer);
    if (screen.el.parentNode) screen.el.parentNode.removeChild(screen.el);
    if (screen.destroy) screen.destroy();
  }

  /// Runs a screen's load() and focuses what it returns; failures show in its body with a retry.
  async function run(screen) {
    let target;
    try {
      target = await screen.load();
    } catch (e) {
      if (e instanceof C.AuthError) {
        C.app.signIn(e.message);
        return;
      }
      if (screen.body && stack.indexOf(screen) >= 0) {
        const box = C.ui.empty('Something went wrong', e.message, () => run(screen));
        C.fill(screen.body, box);
        C.focus.offer(screen.layer, box.querySelector('.f'));
      } else {
        C.toast(e.message, 'error');
      }
      return;
    }
    if (stack.indexOf(screen) < 0) return;
    if (target) C.focus.offer(screen.layer, target);
    else if (C.focus.top() === screen.layer && (!C.focus.current() || !screen.el.contains(C.focus.current()))) {
      const f = C.focus.first(screen.el);
      if (f) C.focus.set(f, { instant: true });
    }
  }

  function clearStack() {
    while (stack.length) unmount(stack[stack.length - 1]);
  }

  const ROOTS = {
    home: () => C.screens.home(),
    search: () => C.screens.search(),
    movies: () => C.screens.movies(),
    shows: () => C.screens.shows(),
    settings: () => C.screens.settings(),
  };

  function rootScreen(name) {
    if (ROOTS[name]) return ROOTS[name]();
    const m = /^plugin:([\w-]+):([\w-]+)$/.exec(name);
    if (m) return C.screens.plugin(m[1], m[2], {}, name);
    return ROOTS.home();
  }

  C.app = {
    top: top,
    run: run,
    push: mount,

    /// Section from the rail: replaces the whole stack. Back from a section returns home.
    root(name) {
      clearStack();
      const screen = rootScreen(name);
      if (name !== 'home') screen.onBack = () => C.app.root('home');
      else screen.onBack = () => C.app.exitPrompt();
      mount(screen);
    },

    open(kind, id) {
      mount(kind === 'movie' ? C.screens.movie(id) : C.screens.show(id));
    },

    back() {
      const s = top();
      if (!s) return;
      if (stack.length === 1) {
        if (s.onBack) s.onBack();
        return;
      }
      // Unhide first: focus only returns to the remembered item if it's visible.
      stack[stack.length - 2].el.classList.remove('hidden');
      unmount(s);
      const t = top();
      if (t && t.onShow) t.onShow();
    },

    /// Swap `old` for `screen` without showing what's underneath (next episode).
    replace(old, screen) {
      if (stack.indexOf(old) >= 0) unmount(old);
      mount(screen);
    },

    async exitPrompt() {
      if (!(await C.ui.confirm('Exit Ciniva?', 'Exit'))) return;
      try {
        window.tizen.application.getCurrentApplication().exit();
      } catch (e) {
        window.close();
      }
    },

    signIn(message) {
      clearStack();
      C.plugins.stop();
      mount(C.screens.login(message));
    },

    async signOut() {
      await C.api('/auth/logout', { method: 'POST' }).catch(() => {});
      C.setSession(C.session.server, '');
      C.session.user = null;
      C.ui.forgetDetails();
      C.app.signIn('You are signed out.');
    },

    /// A scan finished: refresh the browse screen on top, unless something is playing.
    libraryChanged: C.debounce(() => {
      C.ui.forgetDetails();
      const t = top();
      if (t && t.onShow && !t.el.classList.contains('player') && C.focus.top() === t.layer) t.onShow();
    }, 2000),
  };

  // ---- Remote keys ----------------------------------------------------------------------------------------------

  function registerKeys() {
    const input = window.tizen && window.tizen.tvinputdevice;
    if (!input) return;
    const names = {
      MediaPlayPause: 'PLAY_PAUSE', MediaPlay: 'PLAY', MediaPause: 'PAUSE', MediaStop: 'STOP',
      MediaFastForward: 'FF', MediaRewind: 'RW', MediaTrackNext: 'NEXT', MediaTrackPrevious: 'PREV',
      ChannelUp: 'CH_UP', ChannelDown: 'CH_DOWN',
      ColorF0Red: 'RED', ColorF1Green: 'GREEN', ColorF2Yellow: 'YELLOW', ColorF3Blue: 'BLUE',
    };
    const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    Object.keys(names).concat(digits).forEach((name) => {
      try {
        input.registerKey(name);
      } catch (e) {
        // Not on this remote.
      }
    });
    // Use the TV's own key codes.
    Object.keys(names).forEach((name) => {
      try {
        const k = input.getKey(name);
        if (k && k.code) C.KEYS[names[name]] = k.code;
      } catch (e) {
        // Keep the default code.
      }
    });
  }

  // ---- Updates --------------------------------------------------------------------------------------------------

  // The TV can't install packages itself (that needs a platform privilege); the server that is the TV's
  // developer-mode host installs new releases. The app only tells you one exists.
  const RELEASES = 'https://api.github.com/repos/Ciniva/ciniva-tizen/releases/latest';

  function newer(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }

  /// The installed package's version (the UI may be newer, from the server).
  C.packageVersion = function () {
    return (window.CinivaShell && window.CinivaShell.bundled) || C.VERSION;
  };
  /// Where the running UI came from, for Settings: 'bundled', 'server' or 'kept' (the server's, kept on the TV).
  C.uiSource = function () {
    return (window.CinivaShell && window.CinivaShell.ui && window.CinivaShell.ui.source) || 'bundled';
  };

  C.updates = {
    newer: newer,
    /// Latest release { version, url }, cached for 6 hours; null when unknown.
    async latest(force) {
      let cached = null;
      try {
        cached = JSON.parse(C.pref('update', 'null'));
      } catch (e) {
        cached = null;
      }
      if (!force && cached && Date.now() - cached.at < 6 * 3600 * 1000) return cached;
      try {
        const r = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) return cached;
        const j = await r.json();
        const v = { version: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url, at: Date.now() };
        C.setPref('update', JSON.stringify(v));
        return v;
      } catch (e) {
        return cached;
      }
    },
    /// One notice per new version. Not while the server supplies the UI: it updates the TV itself.
    async notify() {
      if (C.uiSource() !== 'bundled') return;
      const v = await C.updates.latest();
      if (!v || !v.version || !newer(v.version, C.packageVersion()) || C.pref('updateNoticed', '') === v.version) return;
      C.setPref('updateNoticed', v.version);
      C.toast('Ciniva for Samsung TV ' + v.version + ' is available (this TV has ' + C.packageVersion() + ').');
    },
  };

  // ---- Startup --------------------------------------------------------------------------------------------------

  async function boot() {
    if (window.CinivaShell) window.CinivaShell.started();
    registerKeys();
    if (!C.session.server || !C.session.token) {
      C.app.signIn();
      return;
    }
    try {
      const me = await C.api('/me');
      C.session.user = me.user || null;
    } catch (e) {
      if (e instanceof C.AuthError) {
        C.app.signIn('Your session has ended. Sign in again.');
        return;
      }
      offline(e);
      return;
    }
    await C.plugins.list();
    C.plugins.listen();
    C.app.root('home');
    setTimeout(() => C.updates.notify(), 5000);
  }

  function offline(e) {
    clearStack();
    const screen = {
      el: h('div.screen.login', h('div.login-brand', h('img', { src: 'icon.png', alt: '' }), h('span', 'Ciniva')),
        h('div.login-card',
          h('h1', 'Cannot reach the server'),
          h('p.muted', C.session.server + ' · ' + e.message),
          h('div.actions', { 'data-nav': 'row' },
            h('div.btn.primary.f.initial', { onclick: boot }, C.icon('refresh'), ' Try again'),
            h('div.btn.f', { onclick: () => C.app.signIn() }, 'Change server')))),
      onBack: () => C.app.exitPrompt(),
    };
    mount(screen);
  }

  C.app.boot = boot;
  C.app.afterSignIn = async function () {
    // A newer UI on the server takes over now rather than at the next launch.
    if (window.CinivaShell && (await window.CinivaShell.refresh())) return;
    await C.plugins.list(true);
    C.plugins.listen();
    C.app.root('home');
    setTimeout(() => C.updates.notify(), 5000);
  };

  // The shell may add this script after the page has loaded.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
