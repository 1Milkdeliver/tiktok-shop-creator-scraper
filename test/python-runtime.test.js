'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readManifest, validateManifest, resolvePythonRuntime, verifyPythonRuntime, resolveWorkerEntrypoint,
} = require('../lib/runtime/python-runtime');

function makeRuntime(manifest) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-runtime-'));
  const root = path.join(projectRoot, manifest.developmentDirectory);
  const paths = [manifest.executables.win32, ...manifest.requiredFiles];
  for (const relativePath of paths) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture');
  }
  return { projectRoot, root };
}

test('Python runtime manifest declares every supported platform and worker entrypoint', () => {
  const manifest = readManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.workerEntrypoints).sort(), ['instagram', 'x', 'youtube']);
});

test('runtime validation identifies a complete local bundle and resolves worker paths', () => {
  const manifest = readManifest();
  const fixture = makeRuntime(manifest);
  try {
    const result = verifyPythonRuntime({ manifest, projectRoot: fixture.projectRoot, platform: 'win32' });
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
    assert.equal(result.executable, path.join(fixture.root, manifest.executables.win32));
    assert.equal(
      resolveWorkerEntrypoint('youtube', { manifest, projectRoot: fixture.projectRoot, platform: 'win32' }).workerPath,
      path.join(fixture.root, manifest.workerEntrypoints.youtube),
    );
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('runtime validation fails closed for incomplete or unsafe bundles', () => {
  const manifest = readManifest();
  const fixture = makeRuntime(manifest);
  try {
    fs.rmSync(path.join(fixture.root, manifest.requiredFiles[0]));
    const result = verifyPythonRuntime({ manifest, projectRoot: fixture.projectRoot, platform: 'win32' });
    assert.equal(result.ok, false);
    assert.equal(result.missing[0].relativePath, manifest.requiredFiles[0]);
    assert.throws(() => validateManifest({ ...manifest, requiredFiles: ['../outside'] }), /cannot leave/);
    assert.throws(() => resolvePythonRuntime({ manifest, platform: 'freebsd' }), /Unsupported platform/);
    assert.throws(() => resolvePythonRuntime({ manifest, platform: 'win32', isPackaged: true, resourcesPath: '' }), /resourcesPath/);
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
});
