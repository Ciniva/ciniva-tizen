// On-screen keyboard for the remote. The remote's number keys and a physical keyboard type into it too.
(function () {
  'use strict';
  const C = window.C;
  const h = C.h;

  // QWERTY and ЙЦУКЕН, like a computer keyboard; capitals come from the lower-case rows.
  const abc = ['1234567890', 'qwertyuiop', 'asdfghjkl@', 'zxcvbnm.-_'];
  const ru = ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю.ё'];
  const upper = (rows) => rows.map((r) => r.toUpperCase());
  const LAYOUTS = {
    abc: abc,
    ABC: upper(abc),
    ru: ru,
    RU: upper(ru),
    sym: ['!?,:;/\'"()', '[]{}&%#+=*~$', '^<>|`.-_@'],
  };

  /// A text field: a real <input>, so the TV's own keyboard and the SmartThings phone keyboard can type into it
  /// once OK is pressed on it, while the on-screen keyboard below edits it too. Returns { el, input, value, set(v) }.
  /// opts: { secret, placeholder, number, onchange(v), onsubmit() (Enter/Done from a native keyboard) }
  C.textField = function (label, value, opts) {
    opts = opts || {};
    const input = h('input.field-input', {
      type: opts.secret ? 'password' : 'text',
      placeholder: opts.placeholder || '',
      autocomplete: 'off',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      inputmode: opts.number ? 'numeric' : null,
    });
    input.value = value || '';
    const el = h('div.field.f',
      h('div.field-label', label, h('span.field-tip', 'OK to type with the TV or phone keyboard')),
      h('div.field-box', input));
    const field = {
      el: el,
      input: input,
      value: input.value,
      secret: !!opts.secret,
      set(v) {
        field.value = v;
        if (input.value !== v) input.value = v;
        if (opts.onchange) opts.onchange(v);
      },
      /// Hands the field to the native keyboard (Tizen IME, SmartThings, a physical keyboard).
      edit() {
        if (C.focus.current() !== el) C.focus.set(el, { noReveal: true });
        input.focus();
        try {
          input.setSelectionRange(input.value.length, input.value.length);
        } catch (e) {
          // Password inputs may refuse a selection.
        }
      },
    };
    input._submit = opts.onsubmit || null;
    input.addEventListener('input', () => {
      field.value = input.value;
      if (opts.onchange) opts.onchange(field.value);
    });
    input.addEventListener('focus', () => el.classList.add('native'));
    input.addEventListener('blur', () => el.classList.remove('native'));
    el.addEventListener('click', (e) => {
      if (e.target !== input) field.edit();
    });
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
