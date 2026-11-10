// Browse screens: home, movie and show grids, search, settings.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;
  C.screens = C.screens || {};

  /// Index of the focused card within its row, to land on the same spot after a refresh.
  function spot(container) {
    const cur = C.focus.current();
    if (!cur || !container.contains(cur)) return null;
    const row = cur.closest('[data-key]');
    if (!row) return null;
    return { key: row.getAttribute('data-key'), index: Array.prototype.indexOf.call(row.querySelectorAll('.f'), cur) };
  }

  function restore(container, at) {
    if (!at) return null;
    const row = container.querySelector('[data-key="' + at.key + '"]');
    if (!row) return null;
    const items = row.querySelectorAll('.f');
    return items[Math.min(at.index, items.length - 1)] || null;
  }

  function keyed(el, key) {
    if (el) el.setAttribute('data-key', key);
    return el;
  }

  // ---- Home --------------------------------------------------------------------------------------------------

  C.screens.home = function () {
    const hero = C.ui.hero();
    const rows = h('div.rows', { 'data-scroll': 'align' }, C.ui.spinner());
    const content = h('div.content.home', { 'data-nav': 'group' }, hero.el, rows);
    const screen = {
      el: h('div.screen.with-rail', C.ui.rail('home'), content),
      body: rows,
      onFocus(el) {
        if (el._hero) hero.show(el._hero);
      },
      onShow() {
        C.app.run(screen);
      },
      async load() {
        const at = spot(rows);
        const all = await Promise.all([C.api('/home'), C.api('/movies?sort=title'), C.api('/shows?sort=title')]);
        const home = all[0];
        const movies = all[1];
        const shows = all[2];
        C.fill(rows,
          keyed(C.ui.row('Continue watching', home.continue_watching.map(C.ui.continueCard), 'wide'), 'continue'),
          keyed(C.ui.row('Recently added movies', home.recent_movies.map((m) => C.ui.posterCard('movie', m))), 'recent-movies'),
          keyed(C.ui.row('Recently added shows', home.recent_shows.map((s) => C.ui.posterCard('show', s))), 'recent-shows'),
          keyed(C.ui.row('Movies', movies.map((m) => C.ui.posterCard('movie', m))), 'movies'),
          keyed(C.ui.row('Shows', shows.map((s) => C.ui.posterCard('show', s))), 'shows'));
        if (!rows.querySelector('.f')) {
          rows.appendChild(C.ui.empty('Your library is empty', 'Add files to the media folder and scan the library from Settings.'));
          hero.show({ data: {}, title: 'Ciniva', eyebrow: 'Welcome' });
          return null;
        }
        return restore(rows, at) || rows.querySelector('.f');
      },
    };
    return screen;
  };

  // ---- Movie and show grids ---------------------------------------------------------------------------------

  const SORTS = [['title', 'Title'], ['added', 'Recently added'], ['year', 'Year'], ['rating', 'Rating']];

  function library(kind) {
    const plural = kind + 's';
    const bg = C.ui.hero('backdrop-only');
    const count = h('span.count');
    const sortLabel = h('span');
    const sortBtn = h('div.btn.small.f', { onclick: chooseSort }, C.icon('sort'), ' ', sortLabel);
    const grid = h('div.grid', { 'data-nav': 'grid' });
    const body = h('div.scroll', { 'data-scroll': '', 'data-pad': '90' },
      h('div.page-head', h('h1', kind === 'movie' ? 'Movies' : 'Shows'), count, h('div.spacer'), sortBtn),
      grid);
    const content = h('div.content', { 'data-nav': 'group' }, body);
    const screen = {
      el: h('div.screen.with-rail', bg.el, C.ui.rail(plural), content),
      body: grid,
      onFocus(el) {
        if (el._hero) bg.backdrop(el._hero.data.backdrop_path);
      },
      onShow() {
        C.app.run(screen);
      },
      async load() {
        const sort = C.pref('sort.' + plural, 'title');
        sortLabel.textContent = (SORTS.filter((s) => s[0] === sort)[0] || SORTS[0])[1];
        const cur = C.focus.current();
        const was = cur && grid.contains(cur) ? Array.prototype.indexOf.call(grid.children, cur) : -1;
        const items = await C.api('/' + plural + '?sort=' + sort);
        count.textContent = String(items.length);
        C.fill(grid, items.map((x) => C.ui.posterCard(kind, x)));
        if (!items.length) {
          C.fill(grid, C.ui.empty('Nothing here yet'));
          return sortBtn;
        }
        return grid.children[Math.max(0, Math.min(was, items.length - 1))];
      },
    };
    function chooseSort() {
      const sort = C.pref('sort.' + plural, 'title');
      C.ui.menu('Sort by', SORTS.map((s) => ({
        label: s[1],
        selected: s[0] === sort,
        onSelect: () => {
          C.setPref('sort.' + plural, s[0]);
          C.app.run(screen).then(() => C.focus.offer(screen.layer, grid.firstElementChild));
        },
      })));
    }
    return screen;
  }

  C.screens.movies = () => library('movie');
  C.screens.shows = () => library('show');

  // ---- Search --------------------------------------------------------------------------------------------------

  let lastQuery = '';

  C.screens.search = function () {
    const results = h('div.results.scroll', { 'data-scroll': '', 'data-pad': '90', 'data-nav': 'group' });
    let seq = 0;
    const field = C.textField('Search your library', lastQuery, {
      placeholder: 'Movies and shows',
      onchange: (v) => {
        lastQuery = v;
        run(v);
      },
    });
    const kb = C.keyboard(() => field, { cyrillic: true });
    const run = C.debounce(async (q) => {
      const mine = ++seq;
      q = q.trim();
      if (!q) {
        C.fill(results, h('p.hint', 'Type with the keyboard or the remote’s number keys.'));
        return;
      }
      let r;
      try {
        r = await C.api('/search?q=' + encodeURIComponent(q));
      } catch (e) {
        if (e instanceof C.AuthError) return C.app.signIn(e.message);
        if (mine === seq) C.fill(results, C.ui.empty('Search failed', e.message));
        return;
      }
      if (mine !== seq) return;
      C.fill(results,
        r.movies.length ? [h('h2.section', 'Movies'), h('div.grid.small', { 'data-nav': 'grid' }, r.movies.map((m) => C.ui.posterCard('movie', m)))] : null,
        r.shows.length ? [h('h2.section', 'Shows'), h('div.grid.small', { 'data-nav': 'grid' }, r.shows.map((s) => C.ui.posterCard('show', s)))] : null,
        !r.movies.length && !r.shows.length ? h('p.hint', 'No matches for “' + q + '”.') : null);
    }, 350);
    const screen = {
      el: h('div.screen.with-rail', C.ui.rail('search'),
        h('div.content.search', { 'data-nav': 'group' },
          h('div.search-panel', field.el, kb.el),
          results)),
      onKey: (e, code) => kb.onKey(e, code),
      load() {
        run(lastQuery);
        return kb.el.querySelector('.key');
      },
    };
    return screen;
  };

  // ---- Settings ------------------------------------------------------------------------------------------------

  const QUALITY_LABELS = [['auto', 'Original (direct play when possible)'], ['2160', '4K · 40 Mbps'], ['1080', '1080p · 10 Mbps'], ['720', '720p · 4 Mbps'], ['480', '480p · 1.5 Mbps']];
  const SUB_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
  const SEEK_STEPS = ['10', '15', '30'];

  C.screens.settings = function () {
    const list = h('div.settings', { 'data-nav': 'column' });
    const body = h('div.scroll', { 'data-scroll': '', 'data-pad': '90' }, h('div.page-head', h('h1', 'Settings')), list);

    function item(label, value, onclick) {
      return h(onclick ? 'div.setting.f' : 'div.setting.static', { onclick: onclick }, h('div.setting-label', label), h('div.setting-value', value));
    }
    function pick(title, options, prefName, fallback) {
      const cur = C.pref(prefName, fallback);
      C.ui.menu(title, options.map((o) => ({
        label: o[1],
        selected: o[0] === cur,
        onSelect: () => {
          C.setPref(prefName, o[0]);
          C.app.run(screen);
        },
      })));
    }
    function labelOf(options, v) {
      return (options.filter((o) => o[0] === v)[0] || options[0])[1];
    }

    const screen = {
      el: h('div.screen.with-rail', C.ui.rail('settings'), h('div.content', { 'data-nav': 'group' }, body)),
      body: list,
      async load() {
        const cur = C.focus.current();
        const was = cur && list.contains(cur) ? Array.prototype.indexOf.call(list.children, cur) : 0;
        const all = await Promise.all([C.api('/status').catch(() => null), C.api('/me').catch(() => ({})), C.plugins.list(true),
          Promise.race([C.updates.latest(), C.sleep(2000).then(() => null)])]);
        const update = all[3];
        const appVersion = C.VERSION + (update && update.version
          ? C.updates.newer(update.version, C.VERSION) ? ' · ' + update.version + ' available' : ' · up to date'
          : '');
        const status = all[0];
        const me = all[1].user || null;
        const plugins = me && me.admin ? all[2].filter((p) => p.has_settings) : [];
        C.session.user = me;
        const scan = status && status.scan;
        C.fill(list,
          h('h2.section', 'Playback'),
          item('Default quality', labelOf(QUALITY_LABELS, C.pref('quality', 'auto')), () => pick('Default quality', QUALITY_LABELS, 'quality', 'auto')),
          item('Subtitle size', labelOf(SUB_SIZES, C.pref('subSize', 'medium')), () => pick('Subtitle size', SUB_SIZES, 'subSize', 'medium')),
          item('Skip step (← →)', C.pref('seekStep', '10') + ' seconds', () => pick('Skip step', SEEK_STEPS.map((s) => [s, s + ' seconds']), 'seekStep', '10')),
          item('Remembered languages', [C.langName(C.pref('audioLang', '')) || 'Audio: file default', C.langName(C.pref('subLang', '')) ? 'Subtitles: ' + C.langName(C.pref('subLang', '')) : 'Subtitles: off'].join(' · '), async () => {
            if (await C.ui.confirm('Forget the audio and subtitle languages you picked?', 'Forget')) {
              C.setPref('audioLang', null);
              C.setPref('subLang', null);
              C.app.run(screen);
            }
          }),
          h('h2.section', 'Library'),
          status ? item('Contents', status.counts.movies + ' movies · ' + status.counts.shows + ' shows · ' + status.counts.episodes + ' episodes', null) : null,
          me && me.admin && scan ? item('Scan library', scan.running ? 'Scanning… ' + scan.done + '/' + scan.total : scan.last_finished ? 'Last scan ' + new Date(scan.last_finished).toLocaleString() : 'Not scanned yet', async () => {
            try {
              await C.api('/scan', { method: 'POST' });
              C.toast('Scan started');
              setTimeout(() => C.app.run(screen), 1500);
            } catch (e) {
              C.toast(e.message, 'error');
            }
          }) : null,
          plugins.length ? h('h2.section', 'Plugins') : null,
          plugins.map((p) => item(p.name, (p.online ? 'Running' : 'Offline') + (p.version ? ' · v' + p.version : ''), () => C.app.push(C.screens.pluginSettings(p)))),
          h('h2.section', 'Account'),
          item('Server', C.session.server, async () => {
            if (await C.ui.confirm('Sign out and connect to another server?', 'Sign out')) C.app.signOut();
          }),
          item('Signed in as', me ? me.username + (me.admin ? ' (administrator)' : '') : '—', async () => {
            if (await C.ui.confirm('Sign out of Ciniva on this TV?', 'Sign out')) C.app.signOut();
          }),
          h('h2.section', 'About'),
          item('Ciniva for Samsung TV', appVersion, null),
          status ? item('Ciniva server', status.version, null) : null);
        const rows = list.querySelectorAll('.f');
        return rows[Math.min(was, rows.length - 1)] || rows[0];
      },
    };
    return screen;
  };
})();
