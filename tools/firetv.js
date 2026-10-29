#!/usr/bin/env node
/*
 * Runs a shell command on the Fire TV over ADB with the launcher's key (the same client the TV's helper uses).
 *
 *   node tools/firetv.js 192.168.1.23 "pm list packages"
 *
 * The first time, the Fire TV asks to allow this key ("Always allow"): accepting it here also allows the TV's helper.
 */
var path = require('path');
var execSync = require('child_process').execSync;
var adb = require(path.join(__dirname, '..', 'service', 'adb.js'));
var keys = JSON.parse(execSync('python3 -c "import sys,json;sys.path.insert(0,\'' + __dirname +
  '\');import build;k,p=build.adb_keys();print(json.dumps({\'key\':k,\'pub\':p}))"').toString());
adb.shell(process.argv[2], process.argv.slice(3).join(' '), keys, function (err, out) {
  if (err) { console.error('Error:', err); process.exit(1); }
  process.stdout.write(out);
});
