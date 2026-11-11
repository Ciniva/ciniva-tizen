// src/verify.js accepts exactly what a key signed, and nothing else.
'use strict';
const assert = require('assert');
global.window = global;
const nacl = (global.nacl = require('../src/vendor/nacl-fast.min.js'));
require('../src/verify.js');
const V = window.CinivaVerify;

const keys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const pub = Buffer.from(keys.publicKey).toString('base64');
const files = [['css/app.css', 'body { color: red; }'], ['js/app.js', 'C.boot(); // ü']];
const manifest = JSON.stringify({ version: '9.0.0', shell: 1, css: [[files[0][0], V.sha512(files[0][1])]], js: [[files[1][0], V.sha512(files[1][1])]] });
const sign = (text, k) => Buffer.from(nacl.sign.detached(Buffer.from(text, 'utf8'), (k || keys).secretKey)).toString('base64');
const signed = { manifest: manifest, signature: sign(manifest) };

const m = V.manifest(signed, pub);
assert.strictEqual(m && m.version, '9.0.0', 'a signed manifest is accepted');
assert.ok(V.files(m, files), 'the signed files match');

assert.strictEqual(V.manifest(signed), null, 'the release key does not accept a test signature');
assert.strictEqual(V.manifest({ manifest: manifest.replace('9.0.0', '9.0.1'), signature: signed.signature }, pub), null, 'an edited manifest is refused');
assert.strictEqual(V.manifest({ manifest: manifest, signature: sign(manifest, nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8))) }, pub), null, 'another key is refused');
assert.strictEqual(V.manifest({ manifest: manifest }, pub), null, 'an unsigned manifest is refused');
assert.strictEqual(V.manifest(undefined, pub), null, 'no signature at all is refused');
assert.strictEqual(V.manifest({ manifest: '{"version":"1"}', signature: sign('{"version":"1"}') }, pub), null, 'a signed manifest without file hashes is refused');

assert.ok(!V.files(m, [files[0], ['js/app.js', 'evil();']]), 'a changed file is refused');
assert.ok(!V.files(m, [files[0]]), 'a missing file is refused');
assert.ok(!V.files(m, [files[1], files[0]]), 'files out of order are refused');
assert.ok(!V.files(m, files.concat([['js/extra.js', '']])), 'an extra file is refused');
console.log('OK: interface signatures');
