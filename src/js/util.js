// Shared helpers. Tizen 5.5 runs Chromium 69: ES2017 only, and no DOM API newer than that (no replaceChildren,
// Object.fromEntries, Array.flat, Intl.DisplayNames).
(function () {
  'use strict';
  const C = (window.C = window.C || {});

  const PROPS = { value: 1, checked: 1, disabled: 1, selected: 1 };

  function add(el, k) {
    if (k === null || k === undefined || k === false || k === '') return;
    if (Array.isArray(k)) {
      k.forEach((x) => add(el, x));
      return;
    }
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }

  /// `h('div.card.wide', { onclick }, child, [children])`: element with classes, attributes, listeners and children.
  C.h = function (tag, attrs) {
    const kids = Array.prototype.slice.call(arguments, 2);
    const parts = tag.split('.');
    const el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    if (attrs === null || attrs === undefined || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
      kids.unshift(attrs);
    } else {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = el.className ? el.className + ' ' + v : v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k in PROPS) el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    add(el, kids);
    return el;
  };

  C.append = function (el) {
    add(el, Array.prototype.slice.call(arguments, 1));
    return el;
  };

  C.clear = function (el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };

  /// Replace an element's children (Element.replaceChildren is Chromium 86+).
  C.fill = function (el) {
    C.clear(el);
    add(el, Array.prototype.slice.call(arguments, 1));
    return el;
  };

  const ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    back: 'M15.5 5l-7 7 7 7',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    check: 'M5 12l5 5 9-10',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
    film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
    tv: 'M3 6h18v12H3zM8 21h8M12 18v3',
    x: 'M6 6l12 12M18 6L6 18',
    next: 'M6 5v14l9-7zM17 5h2v14h-2z',
    prev: 'M18 5v14l-9-7zM7 5H5v14h2z',
    rewind: 'M11 6v12l-8-6zM20 6v12l-8-6z',
    forward: 'M13 6v12l8-6zM4 6v12l8-6z',
    audio: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
    cc: 'M4 6h16v12H4zM10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3',
    quality: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    restart: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    plus: 'M12 5v14M5 12h14',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
    credits: 'M4 5h16v14H4zM8 9h8M8 12h8M8 15h5',
  };
  const FILLED = { play: 1, pause: 1, next: 1, prev: 1, rewind: 1, forward: 1 };

  C.icon = function (name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    const p = document.createElementNS(ns, 'path');
    // Plugins may name icons the app doesn't have.
    p.setAttribute('d', ICONS[name] || ICONS.list);
    if (FILLED[name]) p.setAttribute('class', 'fill');
    svg.appendChild(p);
    return svg;
  };

  C.clock = function (secs) {
    if (!isFinite(secs) || secs < 0) secs = 0;
    const s = Math.floor(secs % 60);
    const m = Math.floor(secs / 60) % 60;
    const hr = Math.floor(secs / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    return hr ? hr + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  };

  C.duration = function (secs) {
    if (!secs || !isFinite(secs)) return '';
    const m = Math.round(secs / 60);
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
  };

  C.bytes = function (n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return n.toFixed(i >= 3 ? 1 : 0) + ' ' + u[i];
  };

  C.audioLabel = function (a) {
    const names = { truehd: 'TrueHD', eac3: 'DD+', ac3: 'Dolby Digital', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', pcm_s16le: 'PCM', pcm_s24le: 'PCM' };
    let name = names[a.codec] || String(a.codec || '').toUpperCase();
    if (a.codec === 'dts' && a.profile && a.profile.indexOf('MA') >= 0) name = 'DTS-HD MA';
    const ch = a.channels ? { 1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1' }[a.channels] || a.channels + 'ch' : '';
    return [name, ch].filter(Boolean).join(' ');
  };

  // Intl.DisplayNames is Chromium 81+, so language names come from this table.
  const LANGS = {
    en: 'English', ru: 'Russian', ka: 'Georgian', uk: 'Ukrainian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
    fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', pl: 'Polish', tr: 'Turkish',
    ar: 'Arabic', hi: 'Hindi', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish',
    cs: 'Czech', hu: 'Hungarian', el: 'Greek', he: 'Hebrew', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
    ms: 'Malay', ro: 'Romanian', bg: 'Bulgarian', hr: 'Croatian', sr: 'Serbian', sl: 'Slovenian', sk: 'Slovak',
    et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian', fa: 'Persian', hy: 'Armenian', az: 'Azerbaijani', kk: 'Kazakh',
  };
  const ISO3 = {
    eng: 'en', rus: 'ru', jpn: 'ja', kor: 'ko', geo: 'ka', kat: 'ka', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de',
    spa: 'es', ita: 'it', por: 'pt', chi: 'zh', zho: 'zh', ukr: 'uk', pol: 'pl', tur: 'tr', ara: 'ar', hin: 'hi',
    dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', cze: 'cs', ces: 'cs', hun: 'hu', gre: 'el',
    ell: 'el', heb: 'he', tha: 'th', vie: 'vi', ind: 'id', may: 'ms', msa: 'ms', rum: 'ro', ron: 'ro', bul: 'bg',
    hrv: 'hr', srp: 'sr', slv: 'sl', slo: 'sk', slk: 'sk', est: 'et', lav: 'lv', lit: 'lt', per: 'fa', fas: 'fa',
    arm: 'hy', hye: 'hy', aze: 'az', kaz: 'kk',
  };

  C.langName = function (code) {
    if (!code || code === 'und') return '';
    const two = code.length === 3 ? ISO3[code] || code : code;
    return LANGS[two] || code;
  };

  C.techBadges = function (probe) {
    if (!probe) return [];
    const out = [];
    const v = probe.video;
    if (v) {
      out.push(v.height >= 1600 || v.width >= 3200 ? '4K' : v.height >= 1000 || v.width >= 1800 ? '1080p' : v.height >= 700 ? '720p' : v.height + 'p');
      if (v.dolby_vision_profile) out.push('Dolby Vision');
      if (v.hdr && v.hdr !== 'dolby_vision') out.push(v.hdr === 'hdr10' ? 'HDR10' : v.hdr === 'hdr10+' ? 'HDR10+' : String(v.hdr).toUpperCase());
      out.push({ hevc: 'HEVC', h264: 'H.264', av1: 'AV1', vp9: 'VP9', mpeg2video: 'MPEG-2', mpeg4: 'MPEG-4' }[v.codec] || String(v.codec).toUpperCase());
    }
    const audio = probe.audio || [];
    const a = audio.filter((x) => x.default)[0] || audio[0];
    if (a) {
      if (a.atmos) out.push('Atmos');
      out.push(C.audioLabel(a));
    }
    return out;
  };

  C.pref = function (name, fallback) {
    try {
      const v = localStorage.getItem('ciniva.' + name);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  };

  C.setPref = function (name, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem('ciniva.' + name);
      else localStorage.setItem('ciniva.' + name, String(value));
    } catch (e) {
      // Storage full or disabled: the setting just doesn't persist.
    }
  };

  C.debounce = function (fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  };

  C.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  C.toast = function (message, kind) {
    let host = document.querySelector('.toasts');
    if (!host) document.body.appendChild((host = C.h('div.toasts')));
    const t = C.h('div.toast.' + (kind || 'info'), message);
    host.appendChild(t);
    setTimeout(() => t.classList.add('out'), 4000);
    setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 4600);
  };

  C.isTizen = typeof window.tizen !== 'undefined';
  C.hasAvplay = () => !!(window.webapis && window.webapis.avplay);
})();
