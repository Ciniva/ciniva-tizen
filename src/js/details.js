// Movie and show detail screens, and the episode sheet.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;
  C.screens = C.screens || {};

  function backdrop(path) {
    return h('div.detail-bg', path ? C.ui.image(C.img(path, 'w1280')) : null, h('div.detail-shade'));
  }

  function resumeLine(f) {
    if (!f || f.watched || !f.position_ms || !f.duration_ms) return null;
    return h('div.resume-line',
      h('div.resume-bar', h('div', { style: { width: Math.min(100, (f.position_ms / f.duration_ms) * 100) + '%' } })),
      h('span', C.clock((f.duration_ms - f.position_ms) / 1000) + ' left'));
  }

  function badges(probe) {
    return h('div.badges', C.techBadges(probe).map((b) => h('span.tag', b)));
  }

  function castLine(cast) {
    if (!Array.isArray(cast) || !cast.length) return null;
    return h('p.cast', h('span.muted', 'Starring '), cast.slice(0, 6).map((c) => c.name).join(', '));
  }

  function button(label, iconName, onclick, primary) {
    return h('div.btn.f' + (primary ? '.primary.initial' : ''), { onclick: onclick }, iconName ? C.icon(iconName) : null, iconName ? ' ' : '', label);
  }

  function fileLabel(f) {
    return [C.techBadges(f.probe).slice(0, 3).join(' '), C.bytes(f.size), f.path.split('/').pop()].filter(Boolean).join(' · ');
  }

  // ---- Movie ----------------------------------------------------------------------------------------------------

  C.screens.movie = function (id) {
    const body = h('div.detail', C.ui.spinner());
    let fileIndex = 0;
    const screen = {
      el: h('div.screen.detail-screen', body),
      body: body,
      onShow() {
        C.app.run(screen);
      },
      async load() {
        const cur = C.focus.current();
        const wasLabel = cur && body.contains(cur) ? cur.textContent : null;
        const all = await Promise.all([C.api('/movies/' + id), C.plugins.list()]);
        const m = all[0];
        const file = m.files[fileIndex] || m.files[0];
        const resume = file && file.position_ms > 0 && !file.watched;
        const watched = m.files.some((f) => f.watched);
        const play = (startAt) => C.player.open({ fileId: file.id, title: m.title, subtitle: m.year ? String(m.year) : '', startAt: startAt });
        const actions = h('div.actions', { 'data-nav': 'row' },
          file ? button(resume ? 'Resume' : 'Play', 'play', () => play(resume ? file.position_ms / 1000 : 0), true) : null,
          file && resume ? button('Start over', 'restart', () => play(0)) : null,
          m.files.length ? button(watched ? 'Mark unwatched' : 'Mark watched', 'check', async () => {
            await C.setWatched(m.files, !watched);
            C.app.run(screen);
          }) : null,
          m.files.length > 1 ? button('Version ' + (fileIndex + 1) + ' of ' + m.files.length, 'list', () => {
            C.ui.menu('Version', m.files.map((f, i) => ({
              label: fileLabel(f),
              selected: i === fileIndex,
              onSelect: () => {
                fileIndex = i;
                C.app.run(screen);
              },
            })));
          }) : null,
          C.plugins.buttons(all[1], 'movie', { kind: 'movie', id: m.id, tmdb_id: m.tmdb_id, title: m.title, year: m.year }));
        const genres = (m.genres || []).join(', ');
        C.fill(body,
          backdrop(m.backdrop_path),
          h('div.detail-main',
            h('div.detail-poster', C.ui.art(m.poster_path, 'w342', m.title)),
            h('div.detail-body',
              h('h1', m.title),
              h('div.meta', [m.year, C.duration((m.runtime || 0) * 60), m.rating ? '★ ' + m.rating.toFixed(1) : null, genres].filter(Boolean).join('  ·  ')),
              m.tagline ? h('p.tagline', m.tagline) : null,
              file ? badges(file.probe) : h('p.muted', 'No playable file.'),
              m.overview ? h('p.overview', m.overview) : null,
              castLine(m.cast),
              resumeLine(file),
              actions)));
        const again = wasLabel && Array.prototype.filter.call(actions.querySelectorAll('.f'), (b) => b.textContent === wasLabel)[0];
        return again || actions.querySelector('.initial') || actions.querySelector('.f');
      },
    };
    return screen;
  };

  // ---- Show -------------------------------------------------------------------------------------------------------

  function seasonLabel(x) {
    return x.name || (x.season_number === 0 ? 'Specials' : 'Season ' + x.season_number);
  }

  C.screens.show = function (id) {
    const body = h('div.detail.show', C.ui.spinner());
    let seasonNumber = null;
    const screen = {
      el: h('div.screen.detail-screen', body),
      body: body,
      onShow() {
        C.app.run(screen);
      },
      async load() {
        C.episodes.forget(id);
        const cur = C.focus.current();
        const where = cur && body.contains(cur) ? { area: cur.closest('[data-key]'), index: 0 } : null;
        if (where && where.area) where.index = Array.prototype.indexOf.call(where.area.querySelectorAll('.f'), cur);
        const areaKey = where && where.area ? where.area.getAttribute('data-key') : null;
        const all = await Promise.all([C.api('/shows/' + id), C.plugins.list()]);
        const s = all[0];
        if (!s.seasons.length) {
          C.fill(body, backdrop(s.backdrop_path), h('div.detail-main', h('div.detail-body', h('h1', s.title), h('p', 'No episodes in the library.'))));
          return null;
        }
        const firstUnwatched = s.seasons.filter((x) => x.season_number > 0 && x.watched < x.available)[0];
        const current = s.seasons.filter((x) => x.season_number === seasonNumber)[0] || firstUnwatched || s.seasons[0];
        seasonNumber = current.season_number;
        const eps = await C.api('/shows/' + id + '/seasons/' + current.season_number);
        const upNext = eps.filter((e) => e.files.length && !e.files[0].watched)[0];
        const seasonWatched = current.watched >= current.available;

        const actions = h('div.actions', { 'data-nav': 'row', 'data-key': 'actions' },
          upNext ? button((upNext.files[0].position_ms ? 'Resume' : 'Play') + ' S' + upNext.season_number + ' · E' + upNext.episode_number, 'play', () => playEpisode(s, upNext), true) : null,
          button(seasonWatched ? 'Mark ' + seasonLabel(current) + ' unwatched' : 'Mark ' + seasonLabel(current) + ' watched', 'check', async () => {
            const files = [];
            eps.forEach((e) => e.files.forEach((f) => files.push(f)));
            await C.setWatched(files, !seasonWatched);
            C.app.run(screen);
          }),
          C.plugins.buttons(all[1], 'show', {
            kind: 'show', id: s.id, tmdb_id: s.tmdb_id, title: s.title, year: s.year,
            seasons: s.seasons.map((x) => ({ season: x.season_number, available: x.available, episodes: x.episode_count })),
          }),
          C.plugins.buttons(all[1], 'season', {
            kind: 'season', id: s.id, tmdb_id: s.tmdb_id, title: s.title, year: s.year, season: current.season_number,
            missing: eps.filter((e) => !e.files.length).map((e) => ({ season: e.season_number, episode: e.episode_number, title: e.title })),
          }, seasonLabel(current)));

        const pills = h('div.row-clip.pills', { 'data-nav': 'row', 'data-key': 'seasons' }, h('div.track', s.seasons.map((x) => {
          const pill = h('div.pill.f' + (x === current ? '.active' : ''), {
            onclick: () => {
              if (seasonNumber === x.season_number) return;
              seasonNumber = x.season_number;
              C.app.run(screen).then(() => C.focus.offer(screen.layer, body.querySelector('.pill.active')));
            },
          }, seasonLabel(x), h('span.pill-count', x.available + (x.episode_count ? '/' + x.episode_count : '')));
          return pill;
        })));

        const cards = eps.map((e) => episodeCard(s, e, screen));
        const episodes = h('div.row-clip', { 'data-nav': 'row', 'data-key': 'episodes' }, h('div.track', cards));
        C.fill(body,
          backdrop(s.backdrop_path),
          h('div.detail-main.compact',
            h('div.detail-body',
              h('h1', s.title),
              h('div.meta', [s.year, s.status, s.rating ? '★ ' + s.rating.toFixed(1) : null, (s.genres || []).join(', ')].filter(Boolean).join('  ·  ')),
              s.overview ? h('p.overview.short', s.overview) : null,
              actions)),
          h('div.show-lower', pills, episodes));
        if (areaKey) {
          const area = body.querySelector('[data-key="' + areaKey + '"]');
          const items = area ? area.querySelectorAll('.f') : [];
          if (items.length) return items[Math.min(where.index, items.length - 1)];
        }
        const target = upNext ? cards[eps.indexOf(upNext)] : null;
        if (target) episodes._last = target;
        return actions.querySelector('.initial') || actions.querySelector('.f');
      },
    };
    return screen;
  };

  function playEpisode(s, e, startAt) {
    const f = e.files[0];
    if (startAt === undefined) startAt = f.position_ms && !f.watched ? f.position_ms / 1000 : 0;
    C.player.open({ fileId: f.id, title: s.title, subtitle: C.episodes.label(e), showId: s.id, startAt: startAt });
  }

  function episodeCard(s, e, screen) {
    const f = e.files[0];
    const frac = f && f.duration_ms ? f.position_ms / f.duration_ms : 0;
    const meta = f
      ? [e.runtime ? e.runtime + 'm' : null, f.watched ? 'Watched' : f.position_ms ? C.clock((f.duration_ms - f.position_ms) / 1000) + ' left' : null].filter(Boolean).join(' · ')
      : 'Not in library';
    return h('div.card.wide-card.episode-card.f' + (f ? '' : '.missing'), { onclick: () => episodeSheet(s, e, screen) },
      h('div.card-art', C.ui.art(e.still_path, 'w780', ''), f ? h('span.play-overlay', C.icon('play')) : null, C.ui.progress(frac),
        f && f.watched ? h('span.badge.watched', C.icon('check')) : null),
      h('div.card-title', e.episode_number + '. ' + (e.title || 'Episode ' + e.episode_number)),
      h('div.card-sub', meta));
  }

  /// Episode pre-play: overview, play / start over / watched.
  function episodeSheet(s, e, screen) {
    const f = e.files[0];
    const resume = f && f.position_ms > 0 && !f.watched;
    let o = null;
    const act = (fn) => () => {
      o.close();
      fn();
    };
    const buttons = h('div.actions', { 'data-nav': 'row' },
      f ? button(resume ? 'Resume' : 'Play', 'play', act(() => playEpisode(s, e)), true) : null,
      f && resume ? button('Start over', 'restart', act(() => playEpisode(s, e, 0))) : null,
      f ? button(f.watched ? 'Mark unwatched' : 'Mark watched', 'check', act(async () => {
        await C.setWatched(e.files, !f.watched);
        C.app.run(screen);
      })) : null);
    o = C.ui.overlay(h('div.sheet',
      h('div.sheet-art', C.ui.art(e.still_path, 'w780', '')),
      h('div.sheet-body',
        h('div.eyebrow', s.title + ' · S' + e.season_number + ' · E' + e.episode_number),
        h('h1', e.title || 'Episode ' + e.episode_number),
        h('div.meta', [e.air_date, e.runtime ? e.runtime + 'm' : null, e.rating ? '★ ' + e.rating.toFixed(1) : null].filter(Boolean).join('  ·  ')),
        f ? badges(f.probe) : h('p.muted', 'This episode is not in the library.'),
        e.overview ? h('p.overview', e.overview) : null,
        resumeLine(f),
        buttons)), { cls: 'center' });
  }
})();
