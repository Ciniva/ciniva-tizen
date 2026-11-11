// Plugins (port of ciniva/web/plugins.js). A plugin describes its pages as JSON views made of blocks
// (text, stats, actions, form, list); they are drawn here for the remote. Nav pages join the rail, actions show
// up as buttons on movie, show and season pages, and settings forms live under Settings.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;
  C.screens = C.screens || {};

  const TONES = { info: 1, success: 1, warning: 1, error: 1 };
  let cache = null;
  let navPages = [];

  function list(force) {
    if (!cache || force) {
      cache = C.api('/plugins').catch(() => []).then((l) => {
        navPages = [];
        l.filter((p) => p.online).forEach((p) => (p.pages || []).filter((pg) => pg.nav).forEach((pg) => navPages.push({ plugin: p, page: pg })));
        return l;
      });
    }
    return cache;
  }

  function actionsFor(all, kind) {
    const out = [];
    all.filter((p) => p.online).forEach((p) => (p.actions || []).forEach((a) => {
      if ((a.contexts || []).indexOf(kind) >= 0) out.push({ plugin: p, action: a });
    }));
    return out;
  }

  /// Buttons for the plugin actions offered on `kind` pages; `suffix` tells apart the same action offered for a
  /// show and for one of its seasons.
  function buttons(all, kind, context, suffix) {
    return actionsFor(all, kind).map((x) =>
      h('div.btn.f', { onclick: () => runAction(x.plugin, x.action, context) }, C.icon(x.action.icon || 'search'), ' ', x.action.title + (suffix ? ' · ' + suffix : '')));
  }

  async function runAction(plugin, action, context) {
    try {
      const result = await C.api('/plugins/' + plugin.id + '/ui/actions/' + action.id, { method: 'POST', body: { context: context } });
      handle(result, { pluginId: plugin.id });
    } catch (e) {
      if (e instanceof C.AuthError) return C.app.signIn(e.message);
      C.toast(e.message, 'error');
    }
  }

  function call(pluginId, c, extra) {
    const body = Object.assign({}, c.body || {}, extra || {});
    const method = (c.method || 'POST').toUpperCase();
    const path = '/plugins/' + pluginId + '/ui/' + c.path.replace(/^\//, '');
    return method === 'GET' ? C.api(path) : C.api(path, { method: method, body: body });
  }

  function handle(result, ctx) {
    if (!result) return;
    if (result.message) C.toast(result.message, result.tone === 'error' ? 'error' : 'info');
    if (result.navigate) navigate(ctx.pluginId, result.navigate);
    else if (result.view) {
      if (ctx.show) ctx.show(result.view);
      else C.app.push(C.screens.pluginView(ctx.pluginId, result.view));
    } else if (result.refresh && ctx.reload) ctx.reload();
  }

  function navigate(pluginId, nav) {
    C.app.push(C.screens.plugin(pluginId, nav.page, nav.params || {}));
  }

  function play(ctx, p, channels) {
    C.live.open({ pluginId: ctx.pluginId, stream: p.stream, title: p.title, image: p.image, channels: channels });
  }

  async function perform(action, ctx, extra) {
    if (action.confirm && !(await C.ui.confirm(action.confirm, 'Continue'))) return;
    if (action.play) return play(ctx, Object.assign({ title: action.label }, action.play));
    if (action.navigate) return navigate(ctx.pluginId, action.navigate);
    if (!action.call) return;
    try {
      handle(await call(ctx.pluginId, action.call, extra), ctx);
    } catch (e) {
      if (e instanceof C.AuthError) return C.app.signIn(e.message);
      C.toast(e.message, 'error');
    }
  }

  // ---- Text entry -------------------------------------------------------------------------------------------------

  /// Keyboard overlay for one value; resolves with the text, or null on Back.
  C.ui.editText = function (label, value, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let result = null;
      let o = null;
      const field = C.textField(label, value || '', {
        secret: opts.secret,
        number: opts.number,
        onsubmit: () => {
          result = field.value;
          o.close();
        },
      });
      const kb = C.keyboard(() => field, {
        cyrillic: !opts.number,
        done: 'OK',
        onDone: () => {
          result = field.value;
          o.close();
        },
      });
      o = C.ui.overlay(h('div.dialog.wide', h('h2', label), field.el, kb.el), {
        initial: kb.el.querySelector('.key'),
        onKey: (e, code) => kb.onKey(e, code),
        onclose: () => resolve(result),
      });
    });
  };

  // ---- Views -----------------------------------------------------------------------------------------------------

  function actionButton(a, ctx) {
    const tone = a.tone === 'primary' ? '.primary' : a.tone === 'danger' ? '.danger' : '';
    return h('div.btn.f' + tone, { onclick: () => perform(a, ctx) }, a.icon ? C.icon(a.icon) : null, a.icon ? ' ' : '', a.label);
  }

  function renderView(view, ctx) {
    const blocks = (view.blocks || []).map((b) => renderBlock(b, ctx));
    return h('div.plugin-view',
      h('div.page-head', h('h1', view.title || ''), view.subtitle ? h('span.count', view.subtitle) : null),
      blocks);
  }

  function renderBlock(b, ctx) {
    switch (b.type) {
      case 'text':
        return h('p.plugin-text' + (TONES[b.tone] ? '.' + b.tone : ''), b.text);
      case 'stats':
        return h('div.plugin-stats', (b.items || []).map((s) => h('div.stat', h('div.stat-n', String(s.value === undefined || s.value === null ? '' : s.value)), h('div.stat-l', s.label))));
      case 'actions':
        return h('div.actions', { 'data-nav': 'row' }, (b.items || []).map((a) => actionButton(a, ctx)));
      case 'form':
        return renderForm(b, ctx);
      case 'list':
        return renderList(b, ctx);
      default:
        return null;
    }
  }

  function itemImage(it) {
    if (!it.image) return null;
    if (it.image.indexOf('/api/') === 0) return C.url(it.image.slice(4));
    return it.image.charAt(0) === '/' ? C.img(it.image, 'w185') : it.image;
  }

  function renderList(b, ctx) {
    const items = b.items || [];
    if (!items.length) return h('div.empty.small', h('p', b.empty || 'Nothing here.'));
    const channels = items.filter((it) => it.play && it.play.stream)
      .map((it) => ({ stream: it.play.stream, title: it.play.title || it.title, image: itemImage(it) }));
    return h('div.plugin-list', { 'data-nav': 'column' }, items.map((it) => {
      const acts = it.actions || [];
      const playable = !!(it.play && it.play.stream);
      const clickable = playable || it.link || acts.length;
      const image = itemImage(it);
      const watch = () => play(ctx, { stream: it.play.stream, title: it.play.title || it.title, image: image }, channels);
      const menu = () => C.ui.menu(it.title, (playable ? [{ label: 'Play', onSelect: watch }] : [])
        .concat(it.link ? [{ label: 'Open', onSelect: () => navigate(ctx.pluginId, it.link) }] : [])
        .concat(acts.map((a) => ({ label: a.label, onSelect: () => perform(a, ctx) }))));
      const row = h('div.plugin-item' + (clickable ? '.f' : '') + (playable ? '.playable' : ''),
        playable ? h('div.plugin-item-img.logo', C.icon('tv'), image ? C.ui.image(image) : null) : image ? h('div.plugin-item-img', C.ui.image(image)) : null,
        h('div.plugin-item-body',
          h('div.plugin-item-title', it.title),
          it.subtitle ? h('div.plugin-item-sub', it.subtitle) : null,
          typeof it.progress === 'number' ? h('div.resume-bar', h('div', { style: { width: Math.max(0, Math.min(1, it.progress)) * 100 + '%' } })) : null,
          it.badges && it.badges.length ? h('div.badges', it.badges.map((x) => h('span.tag' + (TONES[x.tone] ? '.' + x.tone : ''), x.text))) : null),
        playable && (acts.length || it.link) ? h('div.plugin-item-more', '•••') : acts.length ? h('div.plugin-item-more', acts.length === 1 && !it.link ? acts[0].label : '•••') : null);
      if (playable) {
        row.addEventListener('click', watch);
        if (acts.length || it.link) row._more = menu;
      } else if (clickable) {
        row.addEventListener('click', () => {
          if (!acts.length) return navigate(ctx.pluginId, it.link);
          if (acts.length === 1 && !it.link) return perform(acts[0], ctx);
          menu();
        });
      }
      return row;
    }));
  }

  function renderForm(b, ctx) {
    const values = {};
    const rows = (b.fields || []).map((f) => {
      values[f.name] = f.kind === 'toggle' ? !!f.value : f.value === undefined || f.value === null ? (f.kind === 'number' ? null : '') : f.value;
      const valueEl = h('div.setting-value');
      const show = () => {
        const v = values[f.name];
        if (f.kind === 'toggle') valueEl.textContent = v ? 'On' : 'Off';
        else if (f.kind === 'select') {
          const o = (f.options || []).filter((x) => String(x.value) === String(v))[0];
          valueEl.textContent = o ? o.label : '—';
        } else if (f.kind === 'password') valueEl.textContent = v ? '••••••••' : 'Not set';
        else if (f.kind === 'file') valueEl.textContent = 'Not available on the TV';
        else valueEl.textContent = v === null || v === '' ? f.placeholder || '—' : String(v);
      };
      show();
      const row = h('div.setting' + (f.kind === 'file' ? '.static' : '.f'),
        h('div.setting-label', f.label, f.help ? h('div.setting-help', f.help) : null), valueEl);
      if (f.kind !== 'file') {
        row.addEventListener('click', async () => {
          if (f.kind === 'toggle') values[f.name] = !values[f.name];
          else if (f.kind === 'select') {
            await new Promise((resolve) => {
              C.ui.menu(f.label, (f.options || []).map((o) => ({
                label: o.label,
                selected: String(o.value) === String(values[f.name]),
                onSelect: () => { values[f.name] = o.value; },
              })), { onclose: resolve });
            });
          } else {
            const t = await C.ui.editText(f.label, values[f.name] === null ? '' : String(values[f.name]), { secret: f.kind === 'password', number: f.kind === 'number' });
            if (t === null) return;
            values[f.name] = f.kind === 'number' ? (t === '' ? null : Number(t)) : t;
          }
          show();
        });
      }
      return row;
    });
    const submit = h('div.btn.primary.f', {
      onclick: async () => {
        const missing = (b.fields || []).filter((f) => f.required && (values[f.name] === '' || values[f.name] === null))[0];
        if (missing) {
          C.toast(missing.label + ' is required', 'error');
          return;
        }
        if (b.submit && b.submit.call) await perform({ call: b.submit.call }, ctx, values);
        else if (ctx.onSubmit) await ctx.onSubmit(values);
      },
    }, (b.submit && b.submit.label) || 'Save');
    return h('div.plugin-form', h('div.settings', { 'data-nav': 'column' }, rows), h('div.actions', { 'data-nav': 'row' }, submit));
  }

  // ---- Screens -----------------------------------------------------------------------------------------------------

  function pageScreen(pluginId, initialView, loader) {
    const host = h('div.scroll.plugin-host', { 'data-scroll': '', 'data-pad': '90' }, C.ui.spinner());
    let timer = null;
    const rail = loader && loader.nav ? C.ui.rail(loader.nav) : null;
    const screen = {
      el: h('div.screen' + (rail ? '.with-rail' : '.plain'), rail, h('div.content', { 'data-nav': 'group' }, host)),
      body: host,
      destroy: () => clearTimeout(timer),
      // OK plays a playable item; → opens its actions.
      onKey: (e, code) => {
        const cur = C.focus.current();
        if (code !== C.KEYS.RIGHT || !cur || !cur._more || !host.contains(cur)) return false;
        cur._more();
        return true;
      },
      onShow: () => (loader ? C.app.run(screen) : null),
      async load() {
        draw(initialView || (await loader.load()));
        return null;
      },
    };
    const ctx = {
      pluginId: pluginId,
      show: (v) => draw(v),
      reload: loader ? async () => draw(await loader.load()) : null,
    };
    function draw(view) {
      clearTimeout(timer);
      const cur = C.focus.current();
      const all = host.querySelectorAll('.f');
      const inside = !!cur && host.contains(cur);
      const was = inside ? Array.prototype.indexOf.call(all, cur) : -1;
      C.fill(host, renderView(view, ctx));
      const now = host.querySelectorAll('.f');
      // A refresh keeps focus on the same spot; it never pulls focus out of the rail.
      if (inside || !screen.layer.last || !screen.el.contains(screen.layer.last)) {
        C.focus.offer(screen.layer, now[Math.max(0, Math.min(was, now.length - 1))] || null);
      }
      if (view.refresh && loader) {
        timer = setTimeout(async function tick() {
          if (!screen.el.isConnected) return;
          // Don't redraw under an open menu or keyboard.
          if (C.focus.top() !== screen.layer) {
            timer = setTimeout(tick, view.refresh * 1000);
            return;
          }
          try {
            draw(await loader.load());
          } catch (e) {
            timer = setTimeout(tick, view.refresh * 1000);
          }
        }, view.refresh * 1000);
      }
    }
    return screen;
  }

  /// Plugin page at /plugins/{id}/ui/pages/{page}?params.
  C.screens.plugin = function (pluginId, page, params, nav) {
    const q = Object.keys(params || {}).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    return pageScreen(pluginId, null, {
      nav: nav,
      load: () => C.api('/plugins/' + pluginId + '/ui/pages/' + page + (q ? '?' + q : '')),
    });
  };

  /// A view returned by an action, shown on its own.
  C.screens.pluginView = (pluginId, view) => pageScreen(pluginId, view, null);

  /// Settings form of one plugin (administrators).
  C.screens.pluginSettings = function (p) {
    const host = h('div.scroll.plugin-host', { 'data-scroll': '', 'data-pad': '90' }, C.ui.spinner());
    const screen = {
      el: h('div.screen.plain', h('div.content', { 'data-nav': 'group' }, host)),
      body: host,
      async load() {
        const fields = (await C.api('/plugins/' + p.id + '/settings')).fields;
        C.fill(host,
          h('div.page-head', h('h1', p.name), h('span.tag' + (p.online ? '.success' : '.error'), p.online ? 'running' : 'offline'), p.version ? h('span.count', 'v' + p.version) : null),
          p.description ? h('p.muted', p.description) : null,
          renderForm({ fields: fields, submit: { label: 'Save settings' } }, {
            pluginId: p.id,
            onSubmit: async (values) => {
              try {
                await C.api('/plugins/' + p.id + '/settings', { method: 'PUT', body: { values: values } });
                C.toast(p.name + ' settings saved');
              } catch (e) {
                C.toast(e.message, 'error');
              }
            },
          }));
        return host.querySelector('.f');
      },
    };
    return screen;
  };

  // ---- Server events ---------------------------------------------------------------------------------------------

  let source = null;
  function listen() {
    if (!window.EventSource || source) return;
    const connect = () => {
      source = new EventSource(C.url('/events'));
      source.addEventListener('notification', (e) => {
        try {
          const n = JSON.parse(e.data);
          C.toast([n.title, n.body].filter(Boolean).join(' · '), n.tone === 'error' ? 'error' : 'info');
        } catch (err) {
          // Malformed event.
        }
      });
      source.addEventListener('library', () => C.app.libraryChanged());
      source.onerror = () => {
        source.close();
        source = null;
        setTimeout(() => {
          if (!source && C.session.token) connect();
        }, 15000);
      };
    };
    connect();
  }

  function stop() {
    if (source) source.close();
    source = null;
    cache = null;
    navPages = [];
  }

  C.plugins = { list: list, buttons: buttons, navPages: () => navPages, listen: listen, stop: stop };
})();
