// Sign-in: server address, then username and password, all typed on the on-screen keyboard.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;
  C.screens = C.screens || {};

  C.screens.login = function (message) {
    const card = h('div.login-card');
    const screen = {
      el: h('div.screen.login', h('div.login-brand', h('img', { src: 'icon.png', alt: '' }), h('span', 'Ciniva')), card),
      onKey: null,
      onBack: () => C.app.exitPrompt(),
      load() {
        return C.session.server ? credentials(message) : server(message);
      },
    };

    function server(note) {
      const error = h('p.error', note || '');
      const field = C.textField('Server address', C.session.server || C.pref('lastServer', 'http://'), { placeholder: 'http://192.168.1.10:8484', onsubmit: () => connect() });
      const kb = C.keyboard(() => field, { url: true, done: 'Connect', onDone: connect });
      screen.layer.onKey = (e, code) => kb.onKey(e, code);
      async function connect() {
        const url = C.normalizeServer(field.value);
        if (!/^https?:\/\/[^/]+/.test(url)) {
          error.textContent = 'Enter the address of your Ciniva server, like http://192.168.1.10:8484';
          return;
        }
        error.textContent = 'Connecting…';
        let setup;
        try {
          setup = await C.api('/setup', { server: url, token: '' });
        } catch (e) {
          error.textContent = 'No Ciniva server at ' + url + ' (' + e.message + ').';
          return;
        }
        if (setup.needs_admin) {
          error.textContent = 'This server is not set up yet. Open ' + url + ' in a browser to create the administrator account first.';
          return;
        }
        C.setPref('lastServer', url);
        C.setSession(url, '');
        C.focus.offer(screen.layer, credentials());
      }
      C.fill(card,
        h('h1', 'Connect to Ciniva'),
        h('p.muted', 'Enter the address you open Ciniva at in a browser.'),
        field.el, error, kb.el);
      return kb.el.querySelector('.key.done') || kb.el.querySelector('.key');
    }

    function credentials(note) {
      const error = h('p.error', note || '');
      let active = null;
      const user = C.textField('Username', C.pref('lastUser', ''), {
        onsubmit: () => {
          select(pass);
          pass.edit();
        },
      });
      const pass = C.textField('Password', '', { secret: true, onsubmit: () => signIn() });
      const select = (f) => {
        active = f;
        user.el.classList.toggle('editing', f === user);
        pass.el.classList.toggle('editing', f === pass);
      };
      user.el.addEventListener('click', () => select(user));
      pass.el.addEventListener('click', () => select(pass));
      const kb = C.keyboard(() => active, {
        done: 'Next',
        onDone: () => {
          if (active === user) select(pass);
          else signIn();
        },
      });
      screen.layer.onKey = (e, code) => kb.onKey(e, code);
      select(user.value ? pass : user);

      async function signIn() {
        if (!user.value || !pass.value) {
          error.textContent = 'Enter your username and password.';
          select(user.value ? pass : user);
          return;
        }
        error.textContent = 'Signing in…';
        try {
          const r = await C.api('/auth/login', { method: 'POST', token: '', body: { username: user.value, password: pass.value, client: 'Ciniva for Samsung TV' } });
          C.setPref('lastUser', user.value);
          C.setSession(C.session.server, r.token);
          C.session.user = r.user;
          C.app.afterSignIn();
        } catch (e) {
          error.textContent = e instanceof C.AuthError ? 'Wrong username or password.' : e.message;
        }
      }

      C.fill(card,
        h('h1', 'Sign in'),
        h('p.muted', C.session.server),
        h('div.login-fields', { 'data-nav': 'row' }, user.el, pass.el),
        error,
        kb.el,
        h('div.actions', { 'data-nav': 'row' },
          h('div.btn.primary.f', { onclick: signIn }, 'Sign in'),
          h('div.btn.f', { onclick: () => { C.setSession('', ''); C.focus.offer(screen.layer, server()); } }, 'Change server')));
      return kb.el.querySelector('.key');
    }

    return screen;
  };
})();
