// Player. On the TV it uses Samsung's AVPlay (direct play of MKV/MP4 with HEVC/HDR10 and seeking, and HLS);
// in a desktop browser it falls back to <video> for previewing the UI.
//
// Direct play when AVPlay decodes the file as is. Everything else goes through Ciniva as HLS in MPEG-TS
// (Tizen 5.5 freezes on HEVC in fMP4) with Dolby Vision stripped (the TV stalls on its metadata): a remux at
// "Original" quality, an NVENC/CPU encode for the lower qualities.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;
  const K = C.KEYS;

  const QUALITIES = [
    { id: 'auto', label: 'Original' },
    { id: '2160', label: '4K · 40 Mbps', height: 2160, kbps: 40000 },
    { id: '1080', label: '1080p · 10 Mbps', height: 1080, kbps: 10000 },
    { id: '720', label: '720p · 4 Mbps', height: 720, kbps: 4000 },
    { id: '480', label: '480p · 1.5 Mbps', height: 480, kbps: 1500 },
  ];
  const TEXT_SUBS = { subrip: 1, srt: 1, ass: 1, ssa: 1, mov_text: 1, webvtt: 1, text: 1 };
  const DIRECT_CONTAINERS = { mkv: 1, mp4: 1, m4v: 1, mov: 1, ts: 1, m2ts: 1, mts: 1 };
  // Samsung's 2020 TVs dropped DTS; TrueHD, FLAC and Opus aren't decoded in these containers either.
  const DIRECT_AUDIO = { aac: 1, ac3: 1, eac3: 1, mp3: 1 };
  const COPY_AUDIO = 'aac,ac3,eac3,mp3';

  function defaultAudio(probe) {
    return probe.audio.filter((a) => a.default)[0] || probe.audio[0] || null;
  }

  function canDirect(file, audio) {
    const p = file.probe;
    if (!p || !p.video) return false;
    const ext = file.path.split('.').pop().toLowerCase();
    if (!DIRECT_CONTAINERS[ext]) return false;
    const v = p.video;
    if (v.dolby_vision_profile) return false;
    if (v.codec === 'h264') {
      if ((v.bit_depth || 8) > 8) return false;
    } else if (v.codec !== 'hevc') return false;
    if ((v.height || 0) > 2160) return false;
    return !audio || !!DIRECT_AUDIO[audio.codec];
  }

  function canCopy(v) {
    return (v.codec === 'h264' && (v.bit_depth || 8) <= 8) || v.codec === 'hevc';
  }

  function transcodeRequest(file, quality, audio) {
    const v = file.probe.video || {};
    const srcHeight = v.height || 1080;
    const q = QUALITIES.filter((x) => x.id === quality)[0];
    const height = Math.min(q && q.height ? q.height : srcHeight, Math.max(srcHeight, 480));
    const kbps = q && q.kbps ? q.kbps : srcHeight >= 1600 ? 40000 : srcHeight >= 1000 ? 12000 : 5000;
    return {
      max_height: height,
      bitrate_kbps: kbps,
      codec: 'h264',
      hdr: false,
      audio_stream: audio ? audio.index : null,
      audio_channels: audio && (audio.channels || 2) >= 6 ? 6 : 2,
      audio_copy: COPY_AUDIO,
      video_copy: quality === 'auto' && canCopy(v) ? v.codec : undefined,
      dolby_vision: false,
      container: 'ts',
    };
  }

  // ---- Engines -----------------------------------------------------------------------------------------------

  function avplayEngine(host, ev) {
    const av = window.webapis.avplay;
    host.appendChild(h('object.av', { type: 'application/avplayer' }));
    let paused = false;
    let length = 0;
    let lastMs = 0;
    const quiet = (fn) => {
      try {
        return fn();
      } catch (e) {
        return undefined;
      }
    };
    return {
      kind: 'avplay',
      open(url, start, hints) {
        return new Promise((resolve, reject) => {
          try {
            quiet(() => av.stop());
            quiet(() => av.close());
            av.open(url);
            av.setDisplayRect(0, 0, 1920, 1080);
            quiet(() => av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'));
            av.setListener({
              onbufferingstart: () => ev.buffering(true),
              onbufferingprogress: () => {},
              onbufferingcomplete: () => ev.buffering(false),
              oncurrentplaytime: (ms) => {
                lastMs = ms;
                ev.time(ms / 1000);
              },
              onstreamcompleted: () => ev.ended(),
              onerror: (type) => ev.error(String(type)),
              onevent: () => {},
              onsubtitlechange: () => {},
              ondrmevent: () => {},
            });
            if (hints && hints.uhd) quiet(() => av.setStreamingProperty('SET_MODE_4K', 'TRUE'));
            av.prepareAsync(() => {
              length = (quiet(() => av.getDuration()) || 0) / 1000;
              const go = () => {
                quiet(() => av.play());
                paused = false;
                resolve();
              };
              if (start > 1) av.seekTo(Math.floor(start * 1000), go, go);
              else go();
            }, (err) => reject(new Error(err && err.name ? err.name : String(err))));
          } catch (e) {
            reject(e);
          }
        });
      },
      play() {
        quiet(() => av.play());
        paused = false;
      },
      pause() {
        quiet(() => av.pause());
        paused = true;
      },
      seek(t) {
        return new Promise((resolve) => {
          try {
            av.seekTo(Math.max(0, Math.floor(t * 1000)), () => resolve(true), () => resolve(false));
          } catch (e) {
            resolve(false);
          }
        });
      },
      time() {
        const ms = quiet(() => av.getCurrentTime());
        return (typeof ms === 'number' ? ms : lastMs) / 1000;
      },
      duration: () => length,
      paused: () => paused,
      audioTracks() {
        return (quiet(() => av.getTotalTrackInfo()) || []).filter((t) => t.type === 'AUDIO');
      },
      selectAudio(track) {
        try {
          av.setSelectTrack('AUDIO', track.index);
          return true;
        } catch (e) {
          return false;
        }
      },
      stop() {
        quiet(() => av.stop());
        quiet(() => av.close());
      },
      suspend: () => quiet(() => av.suspend()),
      restore: () => quiet(() => av.restore()),
    };
  }

  function videoEngine(host, ev) {
    const v = h('video.av', { preload: 'auto' });
    host.appendChild(v);
    v.addEventListener('waiting', () => ev.buffering(true));
    v.addEventListener('playing', () => ev.buffering(false));
    v.addEventListener('seeked', () => ev.buffering(false));
    v.addEventListener('timeupdate', () => ev.time(v.currentTime));
    v.addEventListener('ended', () => ev.ended());
    let opening = null;
    v.addEventListener('error', () => {
      const msg = v.error ? 'MEDIA_ERR_' + v.error.code : 'error';
      if (opening) opening(new Error(msg));
      else ev.error(msg);
    });
    return {
      kind: 'video',
      open(url, start) {
        return new Promise((resolve, reject) => {
          opening = (e) => {
            opening = null;
            reject(e);
          };
          const meta = () => {
            v.removeEventListener('loadedmetadata', meta);
            opening = null;
            if (start > 1) v.currentTime = start;
            const p = v.play();
            if (p && p.then) p.then(resolve, () => resolve());
            else resolve();
          };
          v.addEventListener('loadedmetadata', meta);
          v.src = url;
        });
      },
      play() {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      },
      pause: () => v.pause(),
      seek(t) {
        v.currentTime = Math.max(0, t);
        return Promise.resolve(true);
      },
      time: () => v.currentTime,
      duration: () => (isFinite(v.duration) ? v.duration : 0),
      paused: () => v.paused,
      audioTracks: () => [],
      selectAudio: () => false,
      stop() {
        v.removeAttribute('src');
        v.load();
      },
      suspend() {},
      restore() {},
    };
  }

  // ---- Subtitles --------------------------------------------------------------------------------------------------

  function vttTime(s) {
    const p = s.trim().split(':').map(Number);
    return p.reduce((acc, n) => acc * 60 + n, 0);
  }

  function parseVtt(text) {
    const cues = [];
    text.replace(/\r/g, '').split(/\n\n+/).forEach((block) => {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.indexOf('-->') >= 0);
      if (i < 0) return;
      const parts = lines[i].split('-->');
      const start = vttTime(parts[0]);
      const end = vttTime(parts[1].trim().split(/\s+/)[0]);
      const body = lines.slice(i + 1).join('\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .trim();
      if (body && isFinite(start) && isFinite(end)) cues.push({ start: start, end: end, text: body });
    });
    return cues;
  }

  // ---- Player ---------------------------------------------------------------------------------------------------

  function askResume(saved, duration) {
    return C.ui.dialog({
      title: 'Continue watching?',
      body: h('div',
        duration ? h('div.resume-bar.big', h('div', { style: { width: Math.min(100, (saved / duration) * 100) + '%' } })) : null,
        h('p.muted', 'You stopped at ' + C.clock(saved) + (duration ? ' of ' + C.clock(duration) : '') + '.')),
      buttons: [
        { label: 'Resume from ' + C.clock(saved), icon: 'play', value: saved, primary: true },
        { label: 'Start over', icon: 'restart', value: 0 },
      ],
    });
  }

  C.player = {
    /// opts: { fileId, title, subtitle, showId, startAt (seconds; undefined asks to resume), replace (player screen) }
    async open(opts) {
      let file;
      try {
        file = await C.api('/files/' + opts.fileId);
      } catch (e) {
        if (e instanceof C.AuthError) return C.app.signIn(e.message);
        C.toast(e.message, 'error');
        if (opts.replace) C.app.back();
        return;
      }
      if (!file.probe) {
        C.toast('This file has not been analysed yet. Try again after the scan finishes.', 'error');
        if (opts.replace) C.app.back();
        return;
      }
      const duration = file.duration || file.probe.duration || 0;
      let start = opts.startAt;
      if (start === undefined) {
        const saved = !file.watched && file.position_ms ? file.position_ms / 1000 : 0;
        start = saved >= 30 && (!duration || saved < duration - 15) ? await askResume(saved, duration) : 0;
        if (start === null) return;
      }
      if (duration && start > duration - 15) start = 0;
      const screen = create(file, opts, start, duration);
      if (opts.replace) C.app.replace(opts.replace, screen);
      else C.app.push(screen);
    },
  };

  function create(file, opts, start, duration) {
    const probe = file.probe;
    const audioLang = C.pref('audioLang', '');
    let audio = probe.audio.filter((a) => audioLang && a.language === audioLang)[0] || defaultAudio(probe);
    let quality = C.pref('quality', 'auto');
    const subLang = C.pref('subLang', '');
    const autoSub = probe.subtitles.filter((s) => TEXT_SUBS[s.codec] && (subLang ? s.language === subLang && !s.forced : s.forced))[0];
    let subIndex = autoSub ? autoSub.index : null;
    const step = () => Number(C.pref('seekStep', '10')) || 10;

    const state = { mode: null, session: null, plan: null, forceHls: false, closed: false, starting: true };
    let lastGood = start || 0;

    // Elements.
    const videoHost = h('div.video-host');
    const subs = h('div.subs.' + C.pref('subSize', 'medium'));
    const spinner = h('div.spinner');
    const message = h('div.player-message');
    const info = h('div.stream-info');
    const played = h('div.seek-played');
    const knob = h('div.seek-knob');
    const marker = h('div.seek-marker');
    const thumb = h('div.trick-img');
    const thumbTime = h('div.trick-time');
    const trick = h('div.trick', thumb, thumbTime);
    const seekBar = h('div.seek.f', h('div.seek-track', played, marker), knob, trick);
    const timeNow = h('span.time-now');
    const timeEnd = h('span.time-end');
    const playBtn = h('div.ctl.f', { onclick: () => toggle() }, C.icon('pause'));
    const prevBtn = opts.showId ? h('div.ctl.f.disabled', { onclick: () => neighbour(-1) }, C.icon('prev')) : null;
    const nextBtn = opts.showId ? h('div.ctl.f.disabled', { onclick: () => neighbour(1) }, C.icon('next')) : null;
    const rwBtn = h('div.ctl.f', { onclick: () => scrub(-step()) }, C.icon('rewind'));
    const ffBtn = h('div.ctl.f', { onclick: () => scrub(30) }, C.icon('forward'));
    const audioBtn = probe.audio.length > 1 ? h('div.ctl.wide.f', { onclick: chooseAudio }, C.icon('audio'), h('span', 'Audio')) : null;
    const subBtn = probe.subtitles.length ? h('div.ctl.wide.f', { onclick: chooseSubs }, C.icon('cc'), h('span', 'Subtitles')) : null;
    const qualityBtn = h('div.ctl.wide.f', { onclick: chooseQuality }, C.icon('quality'), h('span', 'Quality'));
    const upNext = h('div.upnext');

    const root = h('div.screen.player.ui',
      videoHost,
      subs,
      h('div.player-top',
        h('div.player-titles', h('div.player-title', opts.title || ''), opts.subtitle ? h('div.player-subtitle', opts.subtitle) : null),
        info),
      spinner,
      message,
      upNext,
      h('div.player-bottom',
        h('div.seek-row', timeNow, seekBar, timeEnd),
        h('div.controls', { 'data-nav': 'row' },
          prevBtn, rwBtn, playBtn, ffBtn, nextBtn,
          h('div.spacer'),
          audioBtn, subBtn, qualityBtn)));

    const total = () => duration || engine.duration() || 0;

    const engine = (C.hasAvplay() ? avplayEngine : videoEngine)(videoHost, {
      buffering: (on) => root.classList.toggle('loading', on),
      time: onTime,
      ended: onEnded,
      error: onError,
    });

    // ---- Loading -----------------------------------------------------------------------------------------------

    function stopSession() {
      if (!state.session) return;
      const sid = state.session;
      state.session = null;
      C.api('/transcode/' + sid, { method: 'DELETE' }).catch(() => {});
    }

    function teardown() {
      engine.stop();
      stopSession();
    }

    function showInfo() {
      const v = probe.video || {};
      const res = C.techBadges(probe).slice(0, 3).join(' ');
      if (state.mode === 'direct') info.textContent = 'Direct play · ' + res;
      else if (state.plan && state.plan.remux) info.textContent = 'Direct stream · ' + String(v.codec || '').toUpperCase() + ' copied';
      else if (state.plan) info.textContent = 'Transcode · ' + String(state.plan.codec || '').toUpperCase() + ' on ' + state.plan.device;
      else info.textContent = '';
    }

    async function load(position, quiet) {
      state.starting = true;
      message.textContent = '';
      root.classList.add('loading');
      teardown();
      if (state.closed) return true;
      const direct = !state.forceHls && quality === 'auto' && canDirect(file, audio);
      let url;
      if (direct) {
        state.mode = 'direct';
        state.plan = null;
        url = C.url('/files/' + file.id + '/stream');
      } else {
        state.mode = 'hls';
        let r;
        try {
          r = await C.api('/files/' + file.id + '/transcode', { method: 'POST', body: transcodeRequest(file, quality, audio) });
        } catch (e) {
          if (!quiet) fail('Could not start the stream: ' + e.message);
          return false;
        }
        if (state.closed) {
          C.api('/transcode/' + r.session, { method: 'DELETE' }).catch(() => {});
          return true;
        }
        state.session = r.session;
        state.plan = r.plan;
        url = C.url(r.playlist.replace(/^\/api/, ''));
      }
      showInfo();
      try {
        await engine.open(url, position, { uhd: ((probe.video && probe.video.height) || 0) > 1080 });
      } catch (e) {
        if (state.closed) return true;
        if (state.mode === 'direct') {
          state.forceHls = true;
          return load(position, quiet);
        }
        if (!quiet) fail('Playback failed: ' + e.message);
        return false;
      }
      if (state.closed) {
        engine.stop();
        return true;
      }
      state.starting = false;
      lastGood = position || 0;
      root.classList.remove('loading');
      setPlaying(true);
      if (state.mode === 'direct') applyDirectAudio();
      loadSubtitles();
      render(engine.time());
      return true;
    }

    function fail(text) {
      root.classList.remove('loading');
      message.textContent = text;
      showUI(playBtn);
    }

    /// AVPlay starts on the file's default track; switch to the chosen one when it differs.
    function applyDirectAudio() {
      if (audio === defaultAudio(probe)) return true;
      const tracks = engine.audioTracks();
      const n = probe.audio.indexOf(audio);
      if (tracks.length === probe.audio.length && tracks[n] && engine.selectAudio(tracks[n])) return true;
      state.forceHls = true;
      load(engine.time() || lastGood, true);
      return false;
    }

    // A lost stream (server restart, network drop) is rebuilt at the last good position instead of ending.
    let recovering = false;
    let recoveredAt = 0;
    let recoveries = 0;
    async function recover() {
      if (state.closed || recovering) return;
      if (Date.now() - recoveredAt > 60000) recoveries = 0;
      if (recoveries >= 12) {
        fail('Lost the connection to the server.');
        return;
      }
      recovering = true;
      recoveries++;
      recoveredAt = Date.now();
      root.classList.add('loading');
      if (recoveries > 1) await C.sleep(2000);
      for (let attempt = 0; attempt < 20 && !state.closed; attempt++) {
        if (await load(lastGood, true)) break;
        await C.sleep(3000);
      }
      recovering = false;
    }

    function onError() {
      if (state.closed || state.starting) return;
      if (state.mode === 'direct') {
        state.forceHls = true;
        load(lastGood);
      } else {
        recover();
      }
    }

    function onEnded() {
      if (state.closed) return;
      if (total() && lastGood < total() - 30) {
        recover();
        return;
      }
      const d = total();
      if (d) C.api('/files/' + file.id + '/progress', { method: 'PUT', body: { position_ms: Math.floor(d * 1000), duration_ms: Math.floor(d * 1000) } }).catch(() => {});
      if (!upNextOpen) showUpNext(false);
    }

    // ---- Time, progress and rendering -----------------------------------------------------------------------------

    function onTime(t) {
      if (state.starting) return;
      if (t > 0) lastGood = t;
      render(t);
      renderSubs(t);
      report(false);
      watchCredits(t);
    }

    function render(t) {
      const d = total();
      const shown = scrubTarget !== null ? scrubTarget : t;
      const pct = d ? Math.min(100, (shown / d) * 100) : 0;
      played.style.width = (d ? Math.min(100, (t / d) * 100) : 0) + '%';
      knob.style.left = pct + '%';
      timeNow.textContent = C.clock(shown);
      timeEnd.textContent = d ? '-' + C.clock(Math.max(0, d - shown)) : '';
    }

    let lastReport = 0;
    function report(force) {
      const t = state.starting ? lastGood : engine.time();
      const d = total();
      if (!d || t < 1 || (state.starting && !force)) return Promise.resolve();
      if (!force && Date.now() - lastReport < 10000) return Promise.resolve();
      lastReport = Date.now();
      return C.api('/files/' + file.id + '/progress', { method: 'PUT', body: { position_ms: Math.floor(t * 1000), duration_ms: Math.floor(d * 1000) } }).catch(() => {});
    }

    function setPlaying(on) {
      C.fill(playBtn, C.icon(on ? 'pause' : 'play'));
      root.classList.toggle('paused', !on);
    }

    function toggle() {
      if (state.starting) return;
      if (engine.paused()) {
        engine.play();
        setPlaying(true);
        armHide();
      } else {
        engine.pause();
        setPlaying(false);
        report(true);
        showUI();
      }
    }

    // ---- Seeking -------------------------------------------------------------------------------------------------

    let scrubTarget = null;
    let scrubTimer = null;
    let lastScrub = 0;
    let repeats = 0;
    let trickplay = null;
    C.api('/files/' + file.id + '/trickplay').then((m) => { trickplay = m; }).catch(() => {});

    /// Arrow presses move a pending target (with a preview); the seek happens once they stop.
    function scrub(delta) {
      if (state.starting) return;
      const now = Date.now();
      repeats = now - lastScrub < 400 ? repeats + 1 : 0;
      lastScrub = now;
      const speed = repeats > 24 ? 6 : repeats > 8 ? 3 : 1;
      const from = scrubTarget !== null ? scrubTarget : engine.time();
      const d = total();
      scrubTarget = Math.max(0, Math.min(d ? d - 2 : Infinity, from + delta * speed));
      const wasHidden = !root.classList.contains('ui');
      root.classList.add('scrubbing');
      // From hidden controls the seek bar takes focus, so further ← → keep moving the target.
      showUI(wasHidden ? seekBar : null);
      preview(scrubTarget);
      render(engine.time());
      clearTimeout(scrubTimer);
      scrubTimer = setTimeout(commit, 800);
    }

    function preview(t) {
      const d = total();
      const frac = d ? t / d : 0;
      trick.style.left = frac * 100 + '%';
      marker.style.left = frac * 100 + '%';
      thumbTime.textContent = C.clock(t);
      if (trickplay && trickplay.count) {
        const perSheet = trickplay.cols * trickplay.rows;
        const i = Math.min(Math.floor(t / trickplay.interval), trickplay.count - 1);
        const within = i % perSheet;
        thumb.style.display = '';
        thumb.style.width = trickplay.width + 'px';
        thumb.style.height = trickplay.height + 'px';
        thumb.style.backgroundImage = 'url("' + C.url('/files/' + file.id + '/trickplay/' + (Math.floor(i / perSheet) + 1) + '.jpg') + '")';
        thumb.style.backgroundPosition = '-' + (within % trickplay.cols) * trickplay.width + 'px -' + Math.floor(within / trickplay.cols) * trickplay.height + 'px';
      } else {
        thumb.style.display = 'none';
      }
    }

    async function commit() {
      clearTimeout(scrubTimer);
      if (scrubTarget === null) return;
      const t = scrubTarget;
      scrubTarget = null;
      root.classList.remove('scrubbing');
      root.classList.add('loading');
      lastGood = t;
      const ok = await engine.seek(t);
      root.classList.remove('loading');
      if (!ok && !state.closed) load(t, true);
      render(t);
      armHide();
      lastReport = 0;
      report(false);
    }

    // ---- Menus ---------------------------------------------------------------------------------------------------

    function chooseAudio() {
      C.ui.menu('Audio', probe.audio.map((a) => ({
        label: [C.langName(a.language) || 'Unknown', a.title].filter(Boolean).join(' · '),
        sub: [C.audioLabel(a), a.atmos ? 'Atmos' : '', a.default ? 'Default' : ''].filter(Boolean).join(' · '),
        selected: a === audio,
        onSelect: () => {
          if (a === audio) return;
          audio = a;
          C.setPref('audioLang', a.language || '');
          if (state.mode === 'direct' && canDirect(file, a)) {
            applyDirectAudio();
            return;
          }
          state.forceHls = false;
          load(engine.time() || lastGood);
        },
      })));
    }

    function chooseSubs() {
      C.ui.menu('Subtitles', [{
        label: 'Off',
        selected: subIndex === null,
        onSelect: () => {
          subIndex = null;
          C.setPref('subLang', '');
          loadSubtitles();
        },
      }].concat(probe.subtitles.map((s) => ({
        label: [C.langName(s.language) || 'Unknown', s.title].filter(Boolean).join(' · '),
        sub: [s.forced ? 'Forced' : '', TEXT_SUBS[s.codec] ? String(s.codec).toUpperCase() : String(s.codec).toUpperCase() + ' (image subtitles are not supported)'].filter(Boolean).join(' · '),
        selected: s.index === subIndex,
        disabled: !TEXT_SUBS[s.codec],
        onSelect: () => {
          subIndex = s.index;
          C.setPref('subLang', s.language || '');
          loadSubtitles();
        },
      }))));
    }

    function chooseQuality() {
      C.ui.menu('Quality', QUALITIES.map((q) => ({
        label: q.label,
        sub: q.id === 'auto' ? (canDirect(file, audio) ? 'Direct play' : 'Direct stream or transcode as needed') : null,
        selected: q.id === quality,
        onSelect: () => {
          if (q.id === quality) return;
          quality = q.id;
          C.setPref('quality', quality);
          state.forceHls = false;
          load(engine.time() || lastGood);
        },
      })));
    }

    // ---- Subtitles ---------------------------------------------------------------------------------------------

    let cues = [];
    let subSeq = 0;
    async function loadSubtitles() {
      const mine = ++subSeq;
      cues = [];
      renderSubs(-1);
      if (subIndex === null) return;
      const slow = setTimeout(() => C.toast('Extracting subtitles from the file; the first time can take a minute…'), 1500);
      try {
        const r = await fetch(C.url('/files/' + file.id + '/subtitles/' + subIndex + '.vtt'));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        if (mine === subSeq) cues = parseVtt(text);
      } catch (e) {
        if (mine === subSeq) C.toast('Could not load subtitles', 'error');
      } finally {
        clearTimeout(slow);
      }
    }

    let subText = '';
    function renderSubs(t) {
      const text = cues.filter((c) => t >= c.start && t <= c.end).map((c) => c.text).join('\n');
      if (text === subText) return;
      subText = text;
      C.fill(subs, text ? text.split('\n').map((line) => h('span', line)) : null);
    }

    // ---- Credits, up next, episodes -----------------------------------------------------------------------------

    const credits = file.credits_start && (!duration || file.credits_start < duration - 5) ? file.credits_start : null;
    const nextFn = opts.showId ? () => C.episodes.neighbour(opts.showId, file.id, 1) : null;
    let creditsShown = false;
    let upNextOpen = null;
    let upNextTimer = null;

    function hideUpNext() {
      clearInterval(upNextTimer);
      upNextTimer = null;
      upNext.classList.remove('show');
      if (upNextOpen) {
        const o = upNextOpen;
        upNextOpen = null;
        C.focus.pop(o);
      }
    }

    function openUpNext(content, initial) {
      C.fill(upNext, content);
      upNext.classList.add('show');
      upNextOpen = {
        root: upNext,
        initial: initial,
        onKey: (e, code) => {
          if (isMedia(code)) return onKey(e, code);
          if (code === K.BACK || code === K.ESC || code === K.BACKSPACE) {
            hideUpNext();
            return true;
          }
          return false;
        },
      };
      C.focus.push(upNextOpen);
    }

    async function showUpNext(atCredits) {
      const n = nextFn ? await nextFn().catch(() => null) : null;
      if (state.closed) return;
      if (!n) {
        if (!atCredits) {
          close();
          return;
        }
        const skip = h('div.btn.primary.f', { onclick: () => {
          const d = total();
          C.api('/files/' + file.id + '/progress', { method: 'PUT', body: { position_ms: Math.floor(d * 1000), duration_ms: Math.floor(d * 1000) } }).catch(() => {});
          hideUpNext();
          close();
        } }, 'Skip credits');
        openUpNext(h('div.upnext-actions', { 'data-nav': 'row' }, skip, h('div.btn.f', { onclick: hideUpNext }, 'Watch credits')), skip);
        return;
      }
      let left = 10;
      const counter = h('span', String(left));
      const go = () => {
        hideUpNext();
        switchTo(n);
      };
      const playNow = h('div.btn.primary.f', { onclick: go }, C.icon('play'), ' Play now · ', counter);
      openUpNext([
        h('div.upnext-label', 'Up next'),
        h('div.upnext-title', n.subtitle || n.title),
        h('div.upnext-actions', { 'data-nav': 'row' }, playNow, h('div.btn.f', { onclick: hideUpNext }, atCredits ? 'Watch credits' : 'Cancel')),
      ], playNow);
      clearInterval(upNextTimer);
      upNextTimer = setInterval(() => {
        if (engine.paused() && atCredits) return;
        left -= 1;
        counter.textContent = String(left);
        if (left <= 0) go();
      }, 1000);
    }

    function watchCredits(t) {
      if (!credits || scrubTarget !== null) return;
      if (t < credits - 1) {
        if (creditsShown && upNextOpen) hideUpNext();
        creditsShown = false;
      } else if (!creditsShown && t < total() - 3) {
        creditsShown = true;
        showUpNext(true);
      }
    }

    const targets = { '-1': null, '1': null };
    if (opts.showId) {
      [-1, 1].forEach((d) => {
        C.episodes.neighbour(opts.showId, file.id, d).then((t) => {
          targets[d] = t;
          const btn = d < 0 ? prevBtn : nextBtn;
          btn.classList.toggle('disabled', !t);
        }).catch(() => {});
      });
    }

    function neighbour(d) {
      if (targets[d]) switchTo(targets[d]);
    }

    async function switchTo(target) {
      await shutdown();
      C.player.open(Object.assign({}, target, { startAt: 0, replace: screen }));
    }

    // ---- Controls visibility and keys ---------------------------------------------------------------------------

    let hideTimer = null;
    function showUI(focusEl) {
      root.classList.add('ui');
      // Never pull focus out of a menu or the up-next box sitting above the controls.
      if (C.focus.top() === screen.layer) {
        const cur = C.focus.current();
        if (focusEl) C.focus.set(focusEl, { noReveal: true });
        else if (!cur || !root.contains(cur)) C.focus.set(playBtn, { noReveal: true });
      }
      armHide();
    }

    function armHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (state.closed || engine.paused() || scrubTarget !== null || state.starting || message.textContent) return;
        if (C.focus.top() !== screen.layer) return armHide();
        root.classList.remove('ui');
      }, 5000);
    }

    function isMedia(code) {
      return [K.PLAY, K.PAUSE, K.PLAY_PAUSE, K.STOP, K.FF, K.RW, K.NEXT, K.PREV].indexOf(code) >= 0;
    }

    function onKey(e, code) {
      switch (code) {
        case K.PLAY:
          if (engine.paused()) toggle();
          return true;
        case K.PAUSE:
          if (!engine.paused()) toggle();
          return true;
        case K.PLAY_PAUSE:
          toggle();
          return true;
        case K.STOP:
          close();
          return true;
        case K.FF:
          scrub(30);
          return true;
        case K.RW:
          scrub(-step());
          return true;
        case K.NEXT:
          neighbour(1);
          return true;
        case K.PREV:
          neighbour(-1);
          return true;
        default:
      }
      const back = code === K.BACK || code === K.ESC || code === K.BACKSPACE;
      const uiOn = root.classList.contains('ui');
      if (!uiOn) {
        if (code === K.LEFT) scrub(-step());
        else if (code === K.RIGHT) scrub(step());
        else if (code === K.ENTER) {
          toggle();
          showUI(playBtn);
        } else if (code === K.UP || code === K.DOWN) showUI(playBtn);
        else if (back) close();
        return true;
      }
      armHide();
      if (back) {
        if (scrubTarget !== null) {
          scrubTarget = null;
          clearTimeout(scrubTimer);
          root.classList.remove('scrubbing');
          render(engine.time());
        } else if (!message.textContent) root.classList.remove('ui');
        else close();
        return true;
      }
      if (C.focus.current() === seekBar) {
        if (code === K.LEFT || code === K.RIGHT) {
          scrub(code === K.LEFT ? -step() : step());
          return true;
        }
        if (code === K.ENTER) {
          if (scrubTarget !== null) commit();
          else toggle();
          return true;
        }
      }
      return false;
    }

    // ---- Lifecycle ---------------------------------------------------------------------------------------------

    function onVisibility() {
      if (state.closed) return;
      if (document.hidden) {
        report(true);
        if (!engine.paused()) {
          engine.pause();
          setPlaying(false);
        }
        engine.suspend();
      } else {
        engine.restore();
        showUI(playBtn);
      }
    }

    async function shutdown() {
      if (state.closed) return;
      const saved = report(true);
      state.closed = true;
      clearTimeout(hideTimer);
      clearTimeout(scrubTimer);
      hideUpNext();
      document.removeEventListener('visibilitychange', onVisibility);
      teardown();
      document.body.classList.remove('playing');
      if (opts.showId) C.episodes.forget(opts.showId);
      await Promise.race([saved, C.sleep(2000)]);
    }

    async function close() {
      await shutdown();
      if (C.app.top() === screen) C.app.back();
    }

    const screen = {
      el: root,
      initial: playBtn,
      onKey: onKey,
      onBack: () => close(),
      destroy: () => {
        shutdown();
      },
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.body.classList.add('playing');
    render(start);
    armHide();
    setTimeout(() => load(start), 0);
    return screen;
  }

  C.player.engine = (host, ev) => (C.hasAvplay() ? avplayEngine : videoEngine)(host, ev);
  C.player.canDirect = canDirect;
  C.player.transcodeRequest = transcodeRequest;
  C.player.parseVtt = parseVtt;
})();
