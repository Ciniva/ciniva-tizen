// Shared 10-foot UI pieces: rail, hero, cards, rows, menus and dialogs.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;
  C.ui = {};

  // <img loading=lazy> is Chromium 76+; load images as they come near the screen instead.
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const img = e.target;
        io.unobserve(img);
        if (img.dataset.src) img.src = img.dataset.src;
      });
    }, { rootMargin: '700px 1200px' })
    : null;

  C.ui.image = function (src, cls) {
    const img = h('img' + (cls ? '.' + cls : ''), { alt: '' });
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => img.classList.add('broken'));
    if (!src) img.classList.add('broken');
    else if (io) {
      img.dataset.src = src;
      io.observe(img);
    } else img.src = src;
    return img;
  };

  C.ui.art = function (path, size, alt, cls) {
    return h('div.art' + (cls ? '.' + cls : ''), h('span.art-fallback', alt || ''), path ? C.ui.image(C.img(path, size)) : null);
  };

  C.ui.progress = function (fraction) {
    if (!fraction || fraction <= 0) return null;
    return h('div.progress', h('div', { style: { width: Math.min(100, fraction * 100) + '%' } }));
  };

  C.ui.spinner = () => h('div.spinner');

  C.ui.empty = function (title, text, retry) {
    const box = h('div.empty', h('h2', title), text ? h('p', text) : null);
    if (retry) box.appendChild(h('div.btn.f.initial', { onclick: retry }, C.icon('refresh'), ' Try again'));
    return box;
  };

  // ---- Rail ------------------------------------------------------------------------------------------------

  const RAIL = [
    ['home', 'Home', 'home'],
    ['search', 'Search', 'search'],
    ['movies', 'Movies', 'film'],
    ['shows', 'Shows', 'tv'],
    ['settings', 'Settings', 'gear'],
  ];

  C.ui.rail = function (active) {
    const list = h('div.rail-items', { 'data-nav': 'column', 'data-trap': '' });
    // Plugin pages marked for navigation (e.g. downloads) sit between the library and Settings.
    const plugins = C.plugins ? C.plugins.navPages().map((x) => ['plugin:' + x.plugin.id + ':' + x.page.id, x.page.title, x.page.icon || 'list']) : [];
    RAIL.slice(0, -1).concat(plugins, RAIL.slice(-1)).forEach((r) => {
      const item = h('div.rail-item.f' + (r[0] === active ? '.active' : ''), { onclick: () => C.app.root(r[0]) }, C.icon(r[2]), h('span', r[1]));
      list.appendChild(item);
      if (r[0] === active) list._last = item;
    });
    const rail = h('nav.rail', { 'data-nav': 'group' }, h('div.rail-logo', h('img', { src: 'icon.png', alt: '' })), list);
    rail._last = list._last;
    return rail;
  };

  // ---- Hero ------------------------------------------------------------------------------------------------

  const details = {};

  /// Full details for the hero's overview, cached per item.
  function loadDetails(kind, id) {
    const key = kind + '/' + id;
    if (!details[key]) details[key] = C.api('/' + kind + 's/' + id).catch(() => { delete details[key]; return null; });
    return details[key];
  }
  C.ui.loadDetails = loadDetails;
  C.ui.forgetDetails = () => Object.keys(details).forEach((k) => delete details[k]);

  /// Backdrop and text of the focused item, crossfading between two images.
  C.ui.hero = function (cls) {
    const imgs = [h('img.hero-img', { alt: '' }), h('img.hero-img', { alt: '' })];
    imgs.forEach((i) => i.addEventListener('load', () => {
      if (i.dataset.want === i.src) {
        imgs.forEach((o) => o.classList.toggle('on', o === i));
      }
    }));
    const eyebrow = h('div.hero-eyebrow');
    const title = h('h1.hero-title');
    const meta = h('div.hero-meta');
    const overview = h('p.hero-overview');
    const el = h('div.hero' + (cls ? '.' + cls : ''), imgs, h('div.hero-shade'), h('div.hero-text', eyebrow, title, meta, overview));
    let seq = 0;
    let shown = null;

    function setBackdrop(path) {
      const src = path ? C.img(path, 'w1280') : '';
      const on = imgs.filter((i) => i.classList.contains('on'))[0];
      if (on && on.src === src && src) return;
      if (!src) {
        imgs.forEach((i) => i.classList.remove('on'));
        return;
      }
      const spare = imgs.filter((i) => i !== on)[0];
      spare.dataset.want = src;
      spare.src = src;
    }

    const apply = C.debounce(async (item, mine) => {
      if (mine !== seq) return;
      const d = item.data;
      const own = item.backdrop || d.backdrop_path;
      if (own) setBackdrop(own);
      eyebrow.textContent = item.eyebrow || '';
      title.textContent = item.title || d.title || '';
      meta.textContent = item.meta || [d.year, d.rating ? '★ ' + d.rating.toFixed(1) : null].filter(Boolean).join('  ·  ');
      overview.textContent = item.overview || '';
      if (item.detailKind && item.detailId) {
        const full = await loadDetails(item.detailKind, item.detailId);
        if (mine !== seq || !full) return;
        if (!own) setBackdrop(full.backdrop_path);
        if (!item.overview) overview.textContent = full.overview || '';
        if (!item.meta) {
          const genres = (full.genres || []).slice(0, 3).join(', ');
          meta.textContent = [full.year || d.year, full.runtime ? C.duration(full.runtime * 60) : null, full.rating ? '★ ' + full.rating.toFixed(1) : null, genres].filter(Boolean).join('  ·  ');
        }
      }
    }, 180);

    return {
      el: el,
      show(item) {
        if (shown === item) return;
        shown = item;
        apply(item, ++seq);
      },
      backdrop: setBackdrop,
    };
  };

  // ---- Cards and rows -----------------------------------------------------------------------------------------

  function badge(watched, left) {
    if (watched) return h('span.badge.watched', C.icon('check'));
    if (left) return h('span.badge.count', String(left));
    return null;
  }

  /// Poster card for a movie or show from a list endpoint.
  C.ui.posterCard = function (kind, x) {
    const frac = x.duration_ms ? x.position_ms / x.duration_ms : 0;
    const left = kind === 'show' ? x.episodes - x.watched_episodes : 0;
    const sub = kind === 'show' ? [x.year, x.episodes + ' ep' + (x.episodes === 1 ? '' : 's')].filter(Boolean).join(' · ') : x.year || '';
    const card = h('div.card.poster-card.f', { onclick: () => C.app.open(kind, x.id) },
      h('div.card-art', C.ui.art(x.poster_path, 'w342', x.title), badge(kind === 'movie' ? x.watched : left === 0 && x.episodes > 0, kind === 'show' ? left : 0), C.ui.progress(frac)),
      h('div.card-title', x.title),
      h('div.card-sub', String(sub)));
    card._hero = { data: x, detailKind: kind, detailId: x.id, eyebrow: kind === 'movie' ? 'Movie' : 'Show' };
    return card;
  };

  /// Wide card for Continue watching; Enter plays.
  C.ui.continueCard = function (c) {
    const left = c.duration_ms ? C.clock((c.duration_ms - c.position_ms) / 1000) + ' left' : '';
    const card = h('div.card.wide-card.f', {
      onclick: () => C.player.open({
        fileId: c.file_id,
        title: c.title,
        subtitle: c.subtitle,
        showId: c.show_id || undefined,
        startAt: c.next_up ? undefined : c.position_ms / 1000,
      }),
    },
    h('div.card-art', C.ui.art(c.image_path || c.backdrop_path, 'w780', c.title), h('span.play-overlay', C.icon('play')), C.ui.progress(c.duration_ms ? c.position_ms / c.duration_ms : 0)),
    h('div.card-title', c.title),
    h('div.card-sub', c.next_up ? 'Up next · ' + (c.subtitle || '') : c.subtitle ? c.subtitle + ' · ' + left : left));
    card._hero = {
      data: c,
      eyebrow: 'Continue watching',
      meta: c.subtitle || '',
      detailKind: c.show_id ? 'show' : 'movie',
      detailId: c.show_id || c.movie_id,
    };
    return card;
  };

  /// Horizontal shelf; null when empty.
  C.ui.row = function (title, cards, cls) {
    if (!cards.length) return null;
    return h('section.row' + (cls ? '.' + cls : ''), { 'data-unit': '' },
      h('h2.row-title', title),
      h('div.row-clip', { 'data-nav': 'row' }, h('div.track', cards)));
  };

  // ---- Overlays -------------------------------------------------------------------------------------------

  /// Modal layer above the current screen. Back closes it; returns { el, close }.
  C.ui.overlay = function (content, opts) {
    opts = opts || {};
    const el = h('div.overlay' + (opts.cls ? '.' + opts.cls : ''), content);
    document.getElementById('overlays').appendChild(el);
    let closed = false;
    const layer = {
      root: el,
      initial: opts.initial,
      onKey: opts.onKey,
      onBack: () => close(),
    };
    function close(result) {
      if (closed) return;
      closed = true;
      C.focus.pop(layer);
      if (el.parentNode) el.parentNode.removeChild(el);
      if (opts.onclose) opts.onclose(result);
    }
    C.focus.push(layer);
    return { el: el, close: close, layer: layer };
  };

  /// List picker. items: [{ label, sub, selected, disabled, onSelect }]; opts.onclose runs however it closes.
  C.ui.menu = function (title, items, opts) {
    const list = h('div.menu-list', { 'data-nav': 'column', 'data-scroll': '', 'data-pad': '40' });
    let initial = null;
    let o = null;
    items.forEach((it) => {
      const row = h('div.menu-item.f' + (it.selected ? '.selected' : '') + (it.disabled ? '.disabled' : ''),
        { onclick: () => { if (it.disabled) return; o.close(); if (it.onSelect) it.onSelect(); } },
        h('span.menu-check', it.selected ? C.icon('check') : null),
        h('div.menu-text', h('div.menu-label', it.label), it.sub ? h('div.menu-sub', it.sub) : null));
      if (it.selected && !it.disabled) initial = row;
      list.appendChild(row);
    });
    o = C.ui.overlay(h('div.menu', h('h2', title), list), { initial: initial, cls: 'side', onclose: opts && opts.onclose });
    return o;
  };

  /// Centered dialog with buttons; resolves with the chosen button's value (null on Back).
  C.ui.dialog = function (opts) {
    return new Promise((resolve) => {
      let choice = null;
      let o = null;
      const buttons = h('div.dialog-actions', { 'data-nav': 'row' }, opts.buttons.map((b, i) =>
        h('div.btn.f' + (b.primary ? '.primary' : '') + (i === 0 ? '.initial' : ''), { onclick: () => { choice = b.value; o.close(); } }, b.icon ? C.icon(b.icon) : null, b.icon ? ' ' : '', b.label)));
      o = C.ui.overlay(h('div.dialog', opts.title ? h('h2', opts.title) : null, opts.body || null, buttons), { onclose: () => resolve(choice) });
    });
  };

  C.ui.confirm = (title, ok, cancel) => C.ui.dialog({
    title: title,
    buttons: [{ label: ok, value: true, primary: true }, { label: cancel || 'Cancel', value: false }],
  }).then((v) => v === true);
})();
