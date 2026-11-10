// On-screen keyboard for the remote. The remote's number keys and a physical keyboard type into it too.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;

  const LAYOUTS = {
    abc: ['abcdefgh', 'ijklmnop', 'qrstuvwx', 'yz123456', '7890.-_@'],
    ABC: ['ABCDEFGH', 'IJKLMNOP', 'QRSTUVWX', 'YZ123456', '7890.-_@'],
    sym: ['!?,:;/\\\'', '"()[]{}&', '%#+=*~$^', '<>|`12345', '67890.-_'],
    ru: ['абвгдеёж', 'зийклмно', 'прстуфхц', 'чшщъыьэю', 'я.,-1234'],
    RU: ['АБВГДЕЁЖ', 'ЗИЙКЛМНО', 'ПРСТУФХЦ', 'ЧШЩЪЫЬЭЮ', 'Я.,-1234'],
  };

  /// A text field shown above the keyboard: { el, value, set(v) }. `secret` masks the text.
  C.textField = function (label, value, opts) {
    opts = opts || {};
    const text = h('span.field-text');
    const el = h('div.field' + (opts.focusable ? '.f' : ''), h('div.field-label', label), h('div.field-box', text, h('span.caret')));
    const field = {
      el: el,
      value: value || '',
      secret: !!opts.secret,
      placeholder: opts.placeholder || '',
      set(v) {
        field.value = v;
        render();
        if (opts.onchange) opts.onchange(v);
      },
    };
    function render() {
      const shown = field.secret ? field.value.replace(/./g, '•') : field.value;
      text.textContent = shown || field.placeholder;
      text.classList.toggle('placeholder', !shown);
    }
    render();
    return field;
  };

  /// Keyboard that edits `getField()` (so one keyboard can serve several fields).
  /// opts: { url: bool (adds http:// and :8484 keys), cyrillic: bool, done: label, onDone() }
  C.keyboard = function (getField, opts) {
    opts = opts || {};
    let layout = 'abc';
    const grid = h('div.osk-keys', { 'data-nav': 'grid' });
    const el = h('div.osk', grid);

    function type(s) {
      const f = getField();
      if (f) f.set(f.value + s);
    }
    function erase() {
      const f = getField();
      if (f) f.set(f.value.slice(0, -1));
    }

    function key(label, action, cls) {
      const k = h('div.key.f' + (cls ? '.' + cls : ''), label);
      k.addEventListener('click', action);
      return k;
    }

    function render() {
      const focusedIndex = Array.prototype.indexOf.call(grid.querySelectorAll('.key'), C.focus.current());
      C.clear(grid);
      LAYOUTS[layout].forEach((row) => {
        const r = h('div.osk-row');
        Array.from(row).forEach((ch) => r.appendChild(key(ch, () => type(ch))));
        grid.appendChild(r);
      });
      const shiftable = layout === 'abc' || layout === 'ABC' || layout === 'ru' || layout === 'RU';
      const lower = layout === 'abc' || layout === 'ru';
      grid.appendChild(h('div.osk-row',
        shiftable ? key(lower ? '⇧' : '⇩', () => switchTo(lower ? layout.toUpperCase() : layout.toLowerCase()), 'wide') : key('abc', () => switchTo('abc'), 'wide'),
        layout === 'sym' ? null : key('#+=', () => switchTo('sym'), 'wide'),
        opts.cyrillic ? key(layout === 'ru' || layout === 'RU' ? 'ABC' : 'АБВ', () => switchTo(layout === 'ru' || layout === 'RU' ? 'abc' : 'ru'), 'wide') : null,
        key('Space', () => type(' '), 'space'),
        key('⌫', erase, 'wide'),
      ));
      grid.appendChild(h('div.osk-row',
        opts.url ? key('http://', () => type('http://'), 'wide') : null,
        opts.url ? key(':8484', () => type(':8484'), 'wide') : null,
        key('Clear', () => { const f = getField(); if (f) f.set(''); }, 'wide'),
        opts.onDone ? key(opts.done || 'Done', () => opts.onDone(), 'done') : null,
      ));
      const keys = grid.querySelectorAll('.key');
      if (focusedIndex >= 0 && keys[focusedIndex]) C.focus.set(keys[focusedIndex], { instant: true });
    }

    function switchTo(l) {
      layout = l;
      render();
    }

    render();
    return {
      el: el,
      /// Typing from the remote's digits or a physical keyboard; returns true when handled.
      onKey(e, code) {
        if (code >= 48 && code <= 57 && !e.ctrlKey && !e.metaKey && (!e.key || e.key.length === 1)) {
          type(e.key && e.key.length === 1 ? e.key : String(code - 48));
          return true;
        }
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          type(e.key);
          return true;
        }
        if (code === C.KEYS.BACKSPACE) {
          erase();
          return true;
        }
        return false;
      },
    };
  };
})();
