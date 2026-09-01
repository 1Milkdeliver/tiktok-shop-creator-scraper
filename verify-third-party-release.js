// Read-only release gate for reproducible third-party notices and packaged resources.
// Usage: node verify-third-party-release.js [--resources <Electron resources directory>]
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readManifest, verifyPythonRuntime } = require('./lib/runtime/python-runtime');

const ROOT = __dirname;

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(relativePath, root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resourcePairs(build) {
  return new Map((build.extraResources || []).map(resource => [resource.from, resource.to]));
}

function parsePythonRequirements(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s]+)$/.exec(line);
      assert(match, `invalid pinned Python requirement: ${line}`);
      return { name: normalizePythonPackageName(match[1]), lockedVersion: match[2] };
    });
}

function normalizePythonPackageName(name) {
  return String(name).toLowerCase().replace(/[._-]+/g, '-');
}

function readRuntimePythonPackages(runtimeRoot) {
  const sitePackages = path.join(runtimeRoot, 'site-packages');
  assert(fs.existsSync(sitePackages), 'embedded Python site-packages directory is missing');
  const packages = new Map();
  for (const entry of fs.readdirSync(sitePackages, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue;
    const metadataPath = path.join(sitePackages, entry.name, 'METADATA');
    assert(fs.existsSync(metadataPath), `embedded Python package metadata is missing: ${entry.name}`);
    const metadata = fs.readFileSync(metadataPath, 'utf8');
    const name = /^Name: (.+)$/m.exec(metadata)?.[1];
    const lockedVersion = /^Version: (.+)$/m.exec(metadata)?.[1];
    assert(name && lockedVersion, `embedded Python package metadata is incomplete: ${entry.name}`);
    const key = normalizePythonPackageName(name);
    assert(!packages.has(key), `embedded Python package is installed more than once: ${name}`);
    packages.set(key, { name, lockedVersion });
  }
  return packages;
}

function verifyPythonRuntimePackages(runtimeRoot, pythonPackages) {
  const runtimePackages = readRuntimePythonPackages(runtimeRoot);
  assert(runtimePackages.size === pythonPackages.length,
    'embedded Python site-packages must exactly match the reviewed Python dependency lock');
  for (const entry of pythonPackages) {
    const installed = runtimePackages.get(normalizePythonPackageName(entry.name));
    assert(installed, `embedded Python package is missing: ${entry.name}`);
    assert(installed.lockedVersion === entry.lockedVersion,
      `embedded Python package version mismatch for ${entry.name}`);
  }
  return runtimePackages;
}

function verifySource(projectRoot = ROOT) {
  const packageJson = readJson('package.json', projectRoot);
  const packageLock = readJson('package-lock.json', projectRoot);
  const inventory = readJson('third-party-inventory.json', projectRoot);
  const manifest = readManifest(path.join(projectRoot, 'lib', 'runtime', 'python-runtime-manifest.json'));
  const noticePath = path.join(projectRoot, 'docs', 'THIRD_PARTY_NOTICES.md');

  assert(inventory.schemaVersion === 1, 'third-party inventory must use schemaVersion 1');
  assert(inventory.project.name === packageJson.name, 'third-party inventory project name does not match package.json');
  assert(inventory.project.license === packageJson.license, 'third-party inventory project license does not match package.json');
  assert(sha256(path.join(projectRoot, inventory.generatedFrom.packageLock.path)) === inventory.generatedFrom.packageLock.sha256,
    'package-lock.json changed; update third-party-inventory.json through review');
  assert(sha256(path.join(projectRoot, inventory.generatedFrom.pythonRequirements.path)) === inventory.generatedFrom.pythonRequirements.sha256,
    'runtime/python/requirements.lock changed; update third-party-inventory.json through review');
  const pythonPackages = inventory.generatedFrom.pythonRequirements.thirdPartyPackages;
  assert(Array.isArray(pythonPackages), 'third-party inventory must list the Python worker dependencies');
  const lockedPythonPackages = parsePythonRequirements(path.join(projectRoot, inventory.generatedFrom.pythonRequirements.path));
  const inventoryPythonPackages = new Map(pythonPackages.map(entry => [normalizePythonPackageName(entry.name), entry]));
  assert(inventoryPythonPackages.size === lockedPythonPackages.length,
    'third-party inventory must list every locked Python dependency exactly once');
  for (const lockedPackage of lockedPythonPackages) {
    const entry = inventoryPythonPackages.get(lockedPackage.name);
    assert(entry, `third-party inventory is missing Python dependency ${lockedPackage.name}`);
    assert(entry.lockedVersion === lockedPackage.lockedVersion, `locked Python version mismatch for ${lockedPackage.name}`);
    assert(typeof entry.license === 'string' && entry.license.length > 0,
      `third-party inventory has no license for Python dependency ${lockedPackage.name}`);
  }
  const runtime = manifest.windowsEmbeddedRuntime;
  assert(runtime && runtime.version === '3.11.9' && runtime.architecture === 'amd64', 'Windows embedded Python runtime must be pinned');
  assert(runtime.license === 'PSF-2.0', 'Windows embedded Python runtime license must be recorded');
  assert(inventory.embeddedPythonRuntime && inventory.embeddedPythonRuntime.version === runtime.version,
    'third-party inventory embedded Python version does not match runtime manifest');
  assert(inventory.embeddedPythonRuntime.pythonExeSha256 === runtime.pythonExeSha256,
    'third-party inventory embedded Python checksum does not match runtime manifest');
  const developmentPython = path.join(projectRoot, manifest.developmentDirectory, manifest.executables.win32);
  assert(sha256(developmentPython) === runtime.pythonExeSha256, 'embedded Python executable checksum does not match runtime manifest');

  const inventoryRoots = new Map(inventory.npmProductionRoots.map(entry => [entry.name, entry]));
  const productionNames = Object.keys(packageJson.dependencies || {}).sort();
  assert(inventoryRoots.size === productionNames.length, 'third-party inventory must list every direct production dependency exactly once');
  for (const name of productionNames) {
    const entry = inventoryRoots.get(name);
    const lockEntry = packageLock.packages[`node_modules/${name}`];
    assert(entry, `third-party inventory is missing ${name}`);
    assert(typeof entry.license === 'string' && entry.license.length > 0, `third-party inventory has no license for ${name}`);
    assert(entry.requestedVersion === packageJson.dependencies[name], `requested version mismatch for ${name}`);
    assert(lockEntry && entry.lockedVersion === lockEntry.version, `locked version mismatch for ${name}`);
  }

  const resources = resourcePairs(packageJson.build || {});
  const requiredResources = new Map([
    ['LICENSE', 'LICENSE'],
    ['docs/THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['third-party-inventory.json', 'third-party-inventory.json'],
    ['runtime/python', manifest.resourceDirectory],
  ]);
  for (const [from, to] of requiredResources) {
    assert(resources.get(from) === to, `build.extraResources must include ${from} as ${to}`);
  }
  assert(fs.existsSync(noticePath), 'third-party notices document is missing');
  const notices = fs.readFileSync(noticePath, 'utf8');
  for (const name of productionNames) assert(notices.includes(name), `third-party notices do not mention ${name}`);
  for (const entry of pythonPackages) assert(notices.includes(entry.name), `third-party notices do not mention Python dependency ${entry.name}`);
  for (const requiredFile of manifest.requiredFiles) {
    assert(fs.existsSync(path.join(projectRoot, manifest.developmentDirectory, requiredFile)), `Python source resource is missing: ${requiredFile}`);
  }
  verifyPythonRuntimePackages(path.join(projectRoot, manifest.developmentDirectory), pythonPackages);
  return { packageJson, inventory, manifest };
}

function verifyPackagedResources(resourcesPath, projectRoot = ROOT) {
  const { manifest, inventory } = verifySource(projectRoot);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party-inventory.json']) {
    assert(fs.existsSync(path.join(resourcesPath, file)), `packaged resource is missing: ${file}`);
  }
  const result = verifyPythonRuntime({
    isPackaged: true,
    resourcesPath,
    platform: process.platform,
    manifest,
  });
  assert(result.ok, `packaged Python runtime is incomplete: ${result.missing.map(file => file.relativePath).join(', ')}`);
  assert(sha256(result.executable) === manifest.windowsEmbeddedRuntime.pythonExeSha256,
    'packaged embedded Python executable checksum does not match runtime manifest');
  verifyPythonRuntimePackages(result.root, inventory.generatedFrom.pythonRequirements.thirdPartyPackages);
  return result;
}

function main(args) {
  if (args.length === 0) {
    verifySource();
    console.log('verify-third-party-release: source configuration OK');
    return;
  }
  if (args.length === 2 && args[0] === '--resources' && args[1]) {
    verifyPackagedResources(path.resolve(args[1]));
    console.log('verify-third-party-release: source and packaged resources OK');
    return;
  }
  throw new Error('usage: node verify-third-party-release.js [--resources <Electron resources directory>]');
}

module.exports = { verifySource, verifyPackagedResources, readRuntimePythonPackages, verifyPythonRuntimePackages };

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`verify-third-party-release: ${error.message}`); process.exitCode = 1; }
}
