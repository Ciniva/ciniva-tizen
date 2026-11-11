// ui.json lists the UI that boot.js loads and the tv-ui plugin serves: it must match VERSION, name every file, and
// agree with boot.js's fallback list and shell version.
'use strict';
const fs = require('fs');

const ui = JSON.parse(fs.readFileSync('src/ui.json', 'utf8'));
const version = fs.readFileSync('VERSION', 'utf8').trim();
const boot = fs.readFileSync('src/boot.js', 'utf8');
const errors = [];

if (ui.version !== version) errors.push(`ui.json version ${ui.version} is not ${version} (VERSION)`);
for (const f of ui.css.concat(ui.js)) {
  if (!fs.existsSync('src/' + f)) errors.push(`ui.json lists src/${f}, which doesn't exist`);
}
for (const f of fs.readdirSync('src/js')) {
  if (!ui.js.includes('js/' + f)) errors.push(`src/js/${f} is not in ui.json`);
}
if (ui.js[ui.js.length - 1] !== 'js/app.js') errors.push('ui.json must load js/app.js last');

const fallback = boot.slice(boot.indexOf('const FALLBACK'));
if ((fallback.match(/js\/[a-z]+\.js/g) || []).join() !== ui.js.join()) errors.push("boot.js FALLBACK's js list differs from ui.json");
if (!fallback.includes(`version: '${version}'`)) errors.push(`boot.js FALLBACK version is not ${version}`);
const shell = (boot.match(/const SHELL = (\d+);/) || [])[1];
if (String(ui.shell) !== shell || !fallback.includes('shell: ' + shell)) errors.push(`ui.json shell ${ui.shell} and boot.js SHELL ${shell} differ`);

if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}
