// Episode order across seasons (port of ciniva/web/episodes.js).
(function () {
  'use strict';
  const C = window.C;
  const shows = {};
  const seasons = {};

  function show(showId) {
    if (!shows[showId]) shows[showId] = C.api('/shows/' + showId).catch((e) => { delete shows[showId]; throw e; });
    return shows[showId];
  }

  function season(showId, number) {
    const key = showId + '/' + number;
    if (!seasons[key]) seasons[key] = C.api('/shows/' + showId + '/seasons/' + number).catch((e) => { delete seasons[key]; throw e; });
    return seasons[key];
  }

  function label(e) {
    return 'S' + e.season_number + ' · E' + e.episode_number + (e.title ? ' — ' + e.title : '');
  }

  /// Seasons in viewing order: regular seasons first, specials last.
  function seasonOrder(s) {
    return s.seasons.slice().sort((a, b) => (a.season_number === 0) - (b.season_number === 0) || a.season_number - b.season_number);
  }

  function item(s, e) {
    return { fileId: e.files[0].id, title: s.title, subtitle: label(e), showId: s.id };
  }

  /// The playable episode `step` places away from `fileId` (1 = next, -1 = previous), crossing seasons but not
  /// into or out of specials.
  async function neighbour(showId, fileId, step) {
    const s = await show(showId);
    const all = [];
    let at = -1;
    for (const x of seasonOrder(s)) {
      const eps = (await season(showId, x.season_number)).filter((e) => e.files.length);
      for (const e of eps) {
        if (e.files.some((f) => f.id === fileId)) at = all.length;
        all.push(e);
      }
      if (at >= 0 && step > 0 && all.length > at + 1) break;
    }
    if (at < 0) return null;
    const here = all[at];
    const target = all[at + step];
    if (!target || (target.season_number === 0) !== (here.season_number === 0)) return null;
    return item(s, target);
  }

  /// Cached show and season data go stale after playback changes progress.
  function forget(showId) {
    delete shows[showId];
    Object.keys(seasons).forEach((k) => {
      if (k.indexOf(showId + '/') === 0) delete seasons[k];
    });
  }

  C.episodes = { show: show, season: season, label: label, seasonOrder: seasonOrder, item: item, neighbour: neighbour, forget: forget };
})();
