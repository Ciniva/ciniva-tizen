// Live TV: a plugin's `play` streams, relayed by Ciniva as a rolling HLS playlist in MPEG-TS. No seeking; the
// other `play` items of the list it was picked from are the channel up/down list.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;
  const K = C.KEYS;

  const REQUEST = {
    max_height: 1080,
    video_copy: 'h264,hevc',
    audio_copy: 'aac,ac3,eac3',
    audio_channels: 2,
    container: 'ts',
  };
  // Sessions end 45 s after the last request; a longer pause needs a new one.
  const STALE_PAUSE = 30000;
  const STALL = 20000;
  const MAX_RETRIES = 5;

  function logoBox(cls) {
    const img = h('img', { alt: '' });
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => img.classList.add('broken'));
    const box = h('div.' + cls, C.icon('tv'), img);
    return {
      el: box,
      set(src) {
        img.classList.remove('loaded', 'broken');
        if (src) img.src = src;
        else {
          img.removeAttribute('src');
          img.classList.add('broken');
        }
      },
    };
  }

  /// opts: { pluginId, stream, title, image, channels: [{ stream, title, image }] }
  function open(opts) {
    const list = (opts.channels || []).filter((c) => c && c.stream);
    let index = list.findIndex((c) => c.stream === opts.stream);
    let current = index >= 0 ? list[index] : { stream: opts.stream, title: opts.title, image: opts.image };
    if (index < 0) index = 0;
    const zappable = list.length > 1 && list.some((c) => c.stream === opts.stream);

    let closed = false;
    let failed = false;
    let paused = false;
    let starting = true;
    let generation = 0;
    let attempt = 0;
    let pausedAt = 0;
    let lastTick = 0;
    let playingSince = 0;
    let retryTimer = null;
    let zapTimer = null;
    let hideTimer = null;

    const videoHost = h('div.video-host');
    const logo = logoBox('live-logo');
    const titleEl = h('div.player-title');
    const position = h('span.live-position');
    const message = h('div.player-message');
    const root = h('div.screen.player.live.ui.loading',
      videoHost,
      h('div.player-top.live-top',
        logo.el,
        h('div.player-titles', titleEl, h('div.player-subtitle', h('span.live-badge', 'LIVE'), position))),
      h('div.spinner'),
      message,
      h('div.player-bottom.live-bottom',
        h('div.live-hints', zappable ? 'CH ▲▼ change channel · ' : '', 'OK pause · Back close')));

    const engine = C.player.engine(videoHost, {
      buffering: (on) => {
        if (!failed) root.classList.toggle('loading', on);
      },
      time: () => {
        lastTick = Date.now();
        if (!playingSince) playingSince = lastTick;
        else if (lastTick - playingSince > 20000) attempt = 0;
      },
      ended: () => dropped(),
      error: () => dropped(),
    });

    function showChannel() {
      titleEl.textContent = current.title || '';
      logo.set(current.image);
      position.textContent = zappable ? (index + 1) + ' / ' + list.length : '';
    }

    async function start() {
      const mine = ++generation;
      clearTimeout(retryTimer);
      failed = false;
      starting = true;
      paused = false;
      playingSince = 0;
      C.clear(message);
      root.classList.remove('paused');
      root.classList.add('loading');
      showChannel();
      engine.stop();
      let r;
      try {
        r = await C.api('/plugins/' + opts.pluginId + '/live/' + encodeURIComponent(current.stream), { method: 'POST', body: REQUEST });
      } catch (e) {
        if (mine !== generation || closed) return;
        if (e instanceof C.AuthError) {
          close();
          C.app.signIn(e.message);
          return;
        }
        fail(e.message || 'This channel is not available right now.');
        return;
      }
      if (mine !== generation || closed) return;
      if (r.title) titleEl.textContent = r.title;
      if (r.image && !current.image) logo.set(r.image.indexOf('/api/') === 0 ? C.url(r.image.slice(4)) : r.image);
      try {
        await engine.open(C.url(r.playlist.replace(/^\/api/, '')), 0);
      } catch (e) {
        if (mine !== generation || closed) return;
        retry('The channel could not be played' + (e && e.message ? ': ' + e.message : '.'));
        return;
      }
      if (mine !== generation || closed) {
        if (mine === generation) engine.stop();
        return;
      }
      starting = false;
      lastTick = Date.now();
      root.classList.remove('loading');
      armHide();
    }

    function dropped() {
      if (closed || failed || starting || paused) return;
      retry('The channel stopped sending video.');
    }

    /// A dropped stream or dead session: a new POST a few times (a new session if the old one ended), then give up.
    function retry(text) {
      if (closed) return;
      generation++;
      engine.stop();
      if (++attempt > MAX_RETRIES) {
        fail(text);
        return;
      }
      starting = true;
      root.classList.add('loading');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(start, Math.min(8000, 1000 * attempt));
    }

    function fail(text) {
      failed = true;
      starting = false;
      root.classList.remove('loading');
      const again = h('div.btn.primary.f', { onclick: () => { attempt = 0; start(); } }, C.icon('refresh'), ' Try again');
      C.fill(message, h('p', text), h('div.actions.live-actions', again));
      showUI();
      if (C.focus.top() === screen.layer) C.focus.set(again, { instant: true });
    }

    function zap(step) {
      if (!zappable) return;
      index = (index + step + list.length) % list.length;
      current = list[index];
      attempt = 0;
      generation++;
      clearTimeout(retryTimer);
      engine.stop();
      failed = false;
      starting = true;
      C.clear(message);
      root.classList.add('loading');
      showChannel();
      showUI();
      clearTimeout(zapTimer);
      zapTimer = setTimeout(start, 500);
    }

    function toggle() {
      if (failed || starting) return;
      if (paused) {
        paused = false;
        root.classList.remove('paused');
        if (Date.now() - pausedAt > STALE_PAUSE) start();
        else {
          lastTick = Date.now();
          engine.play();
        }
        armHide();
      } else {
        paused = true;
        pausedAt = Date.now();
        engine.pause();
        root.classList.add('paused');
        showUI();
      }
    }

    function showUI() {
      root.classList.add('ui');
      armHide();
    }

    function armHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (closed || paused || failed || starting) return armHide();
        root.classList.remove('ui');
      }, 5000);
    }

    const watchdog = setInterval(() => {
      if (closed || failed || starting || paused || document.hidden) return;
      if (Date.now() - lastTick > STALL) retry('The channel stopped sending video.');
    }, 5000);

    function onKey(e, code) {
      const back = code === K.BACK || code === K.ESC || code === K.BACKSPACE || code === K.STOP;
      if (back) {
        close();
        return true;
      }
      if (code === K.CH_UP || code === K.UP || code === K.PAGE_UP) zap(1);
      else if (code === K.CH_DOWN || code === K.DOWN || code === K.PAGE_DOWN) zap(-1);
      else if (code === K.ENTER) {
        if (failed) {
          attempt = 0;
          start();
        } else toggle();
      } else if (code === K.PLAY_PAUSE) toggle();
      else if (code === K.PLAY) {
        if (paused) toggle();
      } else if (code === K.PAUSE) {
        if (!paused) toggle();
      } else if (code === K.LEFT || code === K.RIGHT) showUI();
      else return false;
      if (!failed) showUI();
      return true;
    }

    function onVisibility() {
      if (closed) return;
      if (document.hidden) {
        generation++;
        clearTimeout(retryTimer);
        clearTimeout(zapTimer);
        engine.stop();
      } else {
        attempt = 0;
        start();
      }
    }

    function shutdown() {
      if (closed) return;
      closed = true;
      generation++;
      clearTimeout(retryTimer);
      clearTimeout(zapTimer);
      clearTimeout(hideTimer);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
      engine.stop();
      document.body.classList.remove('playing');
    }

    function close() {
      shutdown();
      if (C.app.top() === screen) C.app.back();
    }

    const screen = {
      el: root,
      onKey: onKey,
      onBack: () => close(),
      destroy: shutdown,
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.body.classList.add('playing');
    showChannel();
    C.app.push(screen);
    setTimeout(start, 0);
    return screen;
  }

  C.live = { open: open, request: REQUEST };
})();
