// Checks interface builds from the server before boot.js runs them. Ships only in the package (never downloaded), so a
// server or plugin can't replace the check along with the code.
//
// A signed build is { manifest, signature }: `manifest` is the exact JSON text CI signed with the interface key,
// { version, shell, css: [[path, sha512 hex]], js: [[path, sha512 hex]] }, and `signature` its base64 Ed25519
// signature. Uses tweetnacl (src/vendor), since Chromium 69 has no Ed25519 in WebCrypto.
(function (root) {
  'use strict';

  // Public half of the UI_SIGNING_KEY secret in the ciniva-tizen repository.
  const PUBLIC_KEY = '__UI_PUBLIC_KEY__';

  const utf8 = (text) => new TextEncoder().encode(text);

  function hex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  function sha512(text) {
    return hex(root.nacl.hash(utf8(text)));
  }

  function base64(text) {
    try {
      const bin = atob(text);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) {
      return null;
    }
  }

  const isList = (l) => Array.isArray(l) && l.every((e) => Array.isArray(e) && typeof e[0] === 'string' && /^[0-9a-f]{128}$/.test(e[1]));

  /// The signed manifest as an object, or null when the signature or its shape is wrong.
  function manifest(signed, publicKey) {
    if (!signed || typeof signed.manifest !== 'string' || typeof signed.signature !== 'string') return null;
    const key = base64(publicKey || PUBLIC_KEY);
    const sig = base64(signed.signature);
    if (!key || key.length !== 32 || !sig || sig.length !== 64 || !root.nacl) return null;
    if (!root.nacl.sign.detached.verify(utf8(signed.manifest), sig, key)) return null;
    let m;
    try {
      m = JSON.parse(signed.manifest);
    } catch (e) {
      return null;
    }
    if (!m || typeof m.version !== 'string' || typeof m.shell !== 'number' || !isList(m.css) || !isList(m.js)) return null;
    return m;
  }

  /// True when `files` ([[path, text]] for css then js) are exactly the files the manifest signs, in order.
  function files(m, list) {
    const want = m.css.concat(m.js);
    if (!Array.isArray(list) || list.length !== want.length) return false;
    for (let i = 0; i < want.length; i++) {
      if (!list[i] || list[i][0] !== want[i][0] || typeof list[i][1] !== 'string' || sha512(list[i][1]) !== want[i][1]) return false;
    }
    return true;
  }

  root.CinivaVerify = { manifest: manifest, files: files, sha512: sha512 };
})(window);
