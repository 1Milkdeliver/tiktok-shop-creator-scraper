'use strict';
// Reuse the locally verified v1.3.1 Electron runtime and native dependencies.
// No download, credential, user-data copy, or in-place overwrite.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const asar = require('@electron/asar');
(async () => {
  const original = path.resolve(process.argv[2] || '');
  const root = path.resolve(__dirname,'..');
  if (!fs.existsSync(path.join(original,'resources','app.asar'))) throw new Error('Pass the verified original app directory');
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const output = path.join(root,'dist','contacts-' + stamp);
  const source = path.join(output,'source'), app = path.join(output,'app');
  fs.mkdirSync(source,{recursive:true}); fs.mkdirSync(app,{recursive:true});
  asar.extractAll(path.join(original,'resources','app.asar'),source);
  // Allowlist only application source; never copy tests, reports, databases, or Cookie files.
  for (const file of ['main.js','preload.js','index.html','package.json','logo.png','icon-256.png','lib']) fs.cpSync(path.join(root,file),path.join(source,file),{recursive:true});
  for (const entry of fs.readdirSync(original,{withFileTypes:true})) {
    if (['resources','logs','output'].includes(entry.name)) continue;
    fs.cpSync(path.join(original,entry.name),path.join(app,entry.name),{recursive:true});
  }
  fs.mkdirSync(path.join(app,'resources'));
  for (const entry of fs.readdirSync(path.join(original,'resources'),{withFileTypes:true})) {
    if (['app.asar','app.asar.unpacked'].includes(entry.name)) continue;
    fs.cpSync(path.join(original,'resources',entry.name),path.join(app,'resources',entry.name),{recursive:true});
  }
  const packed = path.join(app,'resources','app.asar');
  await asar.createPackageWithOptions(source,packed,{unpack:'**/*.node'});
  const files = asar.listPackage(packed);
  for (const file of ['lib/contact-fields.js','lib/contact-ui.js','lib/partner-contacts.js','lib/database/index.js']) {
    if (!files.some(f=>f.replace(/\\/g,'/')==='/'+file)) throw new Error('Missing packaged module: '+file);
  }
  const report = {version:require('../package.json').version, app, source, asarSha256:crypto.createHash('sha256').update(fs.readFileSync(packed)).digest('hex'), nativeModulePresent:fs.existsSync(path.join(app,'resources','app.asar.unpacked','node_modules','sqlite3','build','Release','node_sqlite3.node'))};
  if (!report.nativeModulePresent) throw new Error('Missing native SQLite module');
  fs.writeFileSync(path.join(output,'build-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
