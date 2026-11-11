// Signs the interface the tv-ui plugin serves: writes src/ui.signed.json for the files src/ui.json lists.
//
//   UI_SIGNING_KEY=<base64 seed> node scripts/sign-ui.js   sign (CI, before building the plugin image)
//   node scripts/sign-ui.js new                             new key: seed on stdout, public key on stderr
//
// The public key belongs in src/verify.js; a new key needs a new app release before TVs accept it.
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;
const nacl = (global.nacl = require('../src/vendor/nacl-fast.min.js'));
require('../src/verify.js');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

if (process.argv[2] === 'new') {
  const seed = require('crypto').randomBytes(32);
  process.stderr.write('public key: ' + b64(nacl.sign.keyPair.fromSeed(seed).publicKey) + '\n');
  process.stdout.write(b64(seed));
  process.exit(0);
}

const seed = Buffer.from((process.env.UI_SIGNING_KEY || '').trim(), 'base64');
if (seed.length !== 32) {
  console.error('UI_SIGNING_KEY must be a base64 Ed25519 seed (32 bytes)');
  process.exit(1);
}
const keys = nacl.sign.keyPair.fromSeed(seed);
const src = path.join(__dirname, '..', 'src');
const ui = JSON.parse(fs.readFileSync(path.join(src, 'ui.json'), 'utf8'));
const list = (files) => files.map((f) => [f, window.CinivaVerify.sha512(fs.readFileSync(path.join(src, f), 'utf8'))]);
const manifest = JSON.stringify({ version: ui.version, shell: ui.shell, css: list(ui.css), js: list(ui.js) });
const signed = { manifest: manifest, signature: b64(nacl.sign.detached(Buffer.from(manifest, 'utf8'), keys.secretKey)) };

if (!window.CinivaVerify.manifest(signed)) {
  console.error('signed, but src/verify.js does not accept it: its public key is not ' + b64(keys.publicKey));
  process.exit(1);
}
fs.writeFileSync(path.join(src, 'ui.signed.json'), JSON.stringify(signed) + '\n');
console.log('signed interface ' + ui.version + ' (' + (ui.css.length + ui.js.length) + ' files)');
