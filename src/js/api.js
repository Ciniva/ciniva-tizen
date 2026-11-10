// Ciniva API client. Calls carry the session token as a Bearer header; URLs handed to the player or to <img> carry
// it as ?token= (the server accepts both).
(function () {
  'use strict';
  const C = window.C;

  class AuthError extends Error {}
  C.AuthError = AuthError;

  C.session = { server: C.pref('server', ''), token: C.pref('token', ''), user: null };

  C.normalizeServer = function (s) {
    s = String(s || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  };

  C.setSession = function (server, token) {
    C.session.server = server;
    C.session.token = token || '';
    C.setPref('server', server);
    C.setPref('token', token || null);
  };

  function base(server) {
    return (server || C.session.server) + '/api';
  }

  /// JSON request. 401 throws AuthError; other failures throw Error with the server's message.
  C.api = async function (path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body !== undefined && typeof body !== 'string') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const token = opts.token === undefined ? C.session.token : opts.token;
    if (token) headers.Authorization = 'Bearer ' + token;
    let r;
    try {
      r = await fetch(base(opts.server) + path, { method: opts.method || 'GET', headers: headers, body: body });
    } catch (e) {
      throw new Error('Cannot reach the server');
    }
    if (r.status === 401) {
      let msg = 'Sign in required';
      try {
        msg = (await r.json()).error || msg;
      } catch (e) {
        // Not JSON.
      }
      throw new AuthError(msg);
    }
    if (!r.ok) {
      let msg = r.statusText || 'HTTP ' + r.status;
      try {
        msg = (await r.json()).error || msg;
      } catch (e) {
        // Not JSON.
      }
      throw new Error(msg);
    }
    if (r.status === 202 || r.status === 204) return null;
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };

  /// Absolute URL for media the player or an <img> fetches itself.
  C.url = function (path, params) {
    const q = [];
    const all = Object.assign({}, params || {});
    if (C.session.token) all.token = C.session.token;
    Object.keys(all).forEach((k) => {
      const v = all[k];
      if (v !== undefined && v !== null) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return base() + path + (q.length ? '?' + q.join('&') : '');
  };

  C.img = function (path, size) {
    return path ? C.url('/images/' + (size || 'w342') + '/' + String(path).replace(/^\//, '')) : '';
  };

  C.setWatched = function (files, watched) {
    return Promise.all(files.map((f) => C.api('/files/' + f.id + '/watched', { method: 'POST', body: { watched: watched } })));
  };
})();
