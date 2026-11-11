// D-pad focus. Focusable elements have class `f`; the focused one gets `focused` (no DOM focus, so the TV's IME
// never pops up and nothing scrolls on its own). Keys go to the top layer (a screen or an overlay) first.
//
// Containers steer movement with data-nav:
//   row     items in DOM order left/right, remembers the last item (Plex-style shelves, scrolled via `.track`)
//   column  items in DOM order up/down, remembers the last item (with data-trap, its ends are walls)
//   group   only remembers the last item, so coming back lands where you left
//   grid    plain geometry, no memory
// data-scroll on an ancestor makes it scroll vertically to keep the focused item (or its data-unit) in view:
//   data-scroll="align" puts the unit at the top (+ data-offset), anything else keeps it inside data-pad.
(function () {
  'use strict';
  const C = window.C;

  const KEYS = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8, EXIT: 10182,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, FF: 417, RW: 412, NEXT: 10233, PREV: 10232,
    CH_UP: 427, CH_DOWN: 428, PAGE_UP: 33, PAGE_DOWN: 34,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
  };
  C.KEYS = KEYS;

  const layers = [];
  let current = null;

  function visible(el) {
    if (!el.isConnected) return false;
    const r = el.getClientRects();
    if (!r.length) return false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.style && p.style.visibility === 'hidden') return false;
    }
    return true;
  }

  function usable(el) {
    return el && !el.classList.contains('disabled') && !el.disabled && visible(el);
  }

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('.f'), usable);
  }

  function top() {
    return layers[layers.length - 1] || null;
  }

  function groups(el, stop) {
    const out = [];
    for (let p = el.parentElement; p && p !== stop; p = p.parentElement) if (p.hasAttribute('data-nav')) out.push(p);
    return out;
  }

  function reveal(el, instant) {
    const row = el.closest('[data-nav="row"]');
    if (row) {
      const track = row.querySelector('.track');
      if (track && track.contains(el)) {
        const first = track.firstElementChild;
        const last = track.lastElementChild;
        let item = el;
        while (item.parentElement !== track) item = item.parentElement;
        const start = first ? first.offsetLeft : 0;
        const end = last ? last.offsetLeft + last.offsetWidth : 0;
        const room = row.clientWidth - start;
        // The focused item sits in the first slot, as in Plex, until the row runs out.
        const x = Math.max(0, Math.min(item.offsetLeft - start, end - start - room));
        track._x = x;
        track.style.transform = 'translateX(' + -x + 'px)';
      }
    }
    const sc = el.closest('[data-scroll]');
    if (sc) {
      const unit = el.closest('[data-unit]') || el;
      const sr = sc.getBoundingClientRect();
      const ur = unit.getBoundingClientRect();
      const at = ur.top - sr.top + sc.scrollTop;
      let target = sc.scrollTop;
      if (sc.getAttribute('data-scroll') === 'align') {
        target = at - Number(sc.getAttribute('data-offset') || 0);
      } else {
        const pad = Number(sc.getAttribute('data-pad') || 60);
        if (ur.top - pad < sr.top) target = at - pad;
        else if (ur.bottom + pad > sr.bottom) target = at + ur.height + pad - sc.clientHeight;
      }
      target = Math.max(0, Math.min(target, sc.scrollHeight - sc.clientHeight));
      sc._y = target;
      if (Math.abs(target - sc.scrollTop) > 1) {
        if (instant) sc.scrollTop = target;
        else sc.scrollTo({ top: target, behavior: 'smooth' });
      }
    }
  }

  function set(el, opts) {
    if (!el) return;
    opts = opts || {};
    if (current !== el) blur();
    current = el;
    el.classList.add('focused');
    const L = top();
    if (L && L.root.contains(el)) L.last = el;
    // `within` marks the groups holding focus (CSS can't ask that: :has is Chromium 105+).
    groups(el, document.body).forEach((g) => {
      g._last = el;
      g.classList.add('within');
    });
    if (!opts.noReveal) reveal(el, opts.instant);
    if (L && L.onFocus) L.onFocus(el);
  }

  function blur() {
    if (!current) return;
    current.classList.remove('focused');
    groups(current, document.body).forEach((g) => g.classList.remove('within'));
    current = null;
  }

  /// Where focus starts in a layer: its `.initial` item, else the first item outside the rail (the rail keeps
  /// remembering the current section). A screen still loading has none; `anything` then allows the rail.
  function first(root, anything) {
    const pref = root.querySelector('.f.initial');
    if (usable(pref)) return pref;
    const all = focusables(root);
    return all.filter((el) => !el.closest('.rail'))[0] || (anything ? all[0] || null : null);
  }

  /// Where `el` will be once row slides and smooth scrolls finish, so quick presses during an animation still
  /// move the right way.
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    const track = el.closest('.track');
    if (track && track._x !== undefined) {
      const m = getComputedStyle(track).transform;
      const now = m && m !== 'none' ? parseFloat(m.split(',')[4]) || 0 : 0;
      dx = -track._x - now;
    }
    const sc = el.closest('[data-scroll]');
    if (sc && sc._y !== undefined) dy = sc.scrollTop - sc._y;
    return { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy, width: r.width, height: r.height };
  }

  function overlap(a1, a2, b1, b2) {
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  function best(from, dir, cands) {
    const a = rectOf(from);
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let found = null;
    let score = Infinity;
    cands.forEach((el) => {
      if (el === from || el.contains(from) || from.contains(el)) return;
      const b = rectOf(el);
      // Cards scrolled out of another row's clip are not targets (they'd sit "left" of everything).
      const clip = el.closest('[data-nav="row"]');
      if (clip && !clip.contains(from)) {
        const c = clip.getBoundingClientRect();
        if (b.right <= c.left + 1 || b.left >= c.right - 1) return;
      }
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let primary;
      let secondary;
      if (dir === 'left') {
        if (bx >= ax - 1 || b.left >= a.left) return;
        primary = a.left - b.right;
        secondary = overlap(a.top, a.bottom, b.top, b.bottom) * 3 + Math.abs(by - ay) * 0.05;
      } else if (dir === 'right') {
        if (bx <= ax + 1 || b.right <= a.right) return;
        primary = b.left - a.right;
        secondary = overlap(a.top, a.bottom, b.top, b.bottom) * 3 + Math.abs(by - ay) * 0.05;
      } else if (dir === 'up') {
        if (by >= ay - 1 || b.top >= a.top) return;
        primary = a.top - b.bottom;
        secondary = overlap(a.left, a.right, b.left, b.right) * 3 + Math.abs(bx - ax) * 0.05;
      } else {
        if (by <= ay + 1 || b.bottom <= a.bottom) return;
        primary = b.top - a.bottom;
        secondary = overlap(a.left, a.right, b.left, b.right) * 3 + Math.abs(bx - ax) * 0.05;
      }
      const s = Math.max(0, primary) + secondary;
      if (s < score) {
        score = s;
        found = el;
      }
    });
    return found;
  }

  function move(dir) {
    const L = top();
    if (!L) return false;
    const from = current && L.root.contains(current) && usable(current) ? current : null;
    if (!from) {
      const f = first(L.root, true);
      if (f) set(f);
      return !!f;
    }
    const horizontal = dir === 'left' || dir === 'right';
    const g = from.closest('[data-nav]');
    const kind = g && L.root.contains(g) ? g.getAttribute('data-nav') : null;
    if ((kind === 'row' && horizontal) || (kind === 'column' && !horizontal)) {
      const items = focusables(g);
      const i = items.indexOf(from);
      const next = items[i + (dir === 'right' || dir === 'down' ? 1 : -1)];
      if (next) {
        set(next);
        return true;
      }
      if (kind === 'row' && dir === 'right') return false;
      // data-trap: the list's ends are walls (the rail shouldn't drop into the page below).
      if (g.hasAttribute('data-trap')) return false;
    }
    const cand = best(from, dir, focusables(L.root));
    if (!cand) return false;
    // Entering a group from outside lands on the item it remembers (outermost group first).
    const entered = groups(cand, L.root).filter((x) => !x.contains(from) && x.getAttribute('data-nav') !== 'grid');
    for (let i = entered.length - 1; i >= 0; i--) {
      const m = entered[i]._last;
      if (m && entered[i].contains(m) && usable(m)) {
        set(m);
        return true;
      }
    }
    set(cand);
    return true;
  }

  function activate() {
    const L = top();
    if (!current || !L || !L.root.contains(current)) return;
    if (current._enter) current._enter();
    else current.click();
  }

  function back() {
    const L = top();
    if (L && L.onBack) L.onBack();
  }

  C.focus = {
    set: set,
    move: move,
    first: first,
    reveal: reveal,
    current: () => current,
    top: top,
    /// A layer is { root, onKey(e, code) → true if handled, onBack, onFocus(el), initial }.
    push(layer) {
      layers.push(layer);
      const target = usable(layer.initial) ? layer.initial : first(layer.root);
      if (target) set(target, { instant: true });
      else blur();
    },
    pop(layer) {
      const i = layers.indexOf(layer);
      if (i < 0) return;
      layers.splice(i, 1);
      if (i !== layers.length) return;
      const T = top();
      blur();
      if (!T) return;
      const el = T.last && T.root.contains(T.last) && usable(T.last) ? T.last : first(T.root, true);
      if (el) set(el, { instant: true });
    },
    /// Focus `el` if its layer is on top, otherwise remember it for when that layer returns.
    offer(layer, el) {
      if (!el) return;
      if (top() === layer) set(el, { instant: true });
      else layer.last = el;
    },
  };

  document.addEventListener('keydown', (e) => {
    const L = top();
    const code = e.keyCode;
    if (L && L.onKey && L.onKey(e, code) === true) {
      e.preventDefault();
      return;
    }
    switch (code) {
      case KEYS.LEFT: move('left'); break;
      case KEYS.RIGHT: move('right'); break;
      case KEYS.UP: move('up'); break;
      case KEYS.DOWN: move('down'); break;
      case KEYS.ENTER: activate(); break;
      case KEYS.BACK:
      case KEYS.ESC:
      case KEYS.BACKSPACE:
        back();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // Pointer support (desktop browsers, pointer remotes). Only real movement counts: browsers also fire mouse
  // events when content scrolls under a resting pointer, which would steal focus from the D-pad.
  let px = -1;
  let py = -1;
  document.addEventListener('mousemove', (e) => {
    if (e.clientX === px && e.clientY === py) return;
    px = e.clientX;
    py = e.clientY;
    const el = e.target.closest && e.target.closest('.f');
    const L = top();
    if (el && L && L.root.contains(el) && usable(el) && el !== current) set(el, { noReveal: true });
  });
})();
