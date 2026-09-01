'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.join(__dirname, 'python-runtime-manifest.json');
const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux']);

function readManifest(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  return manifest;
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error('Python runtime manifest must use schemaVersion 1');
  }
  assertSafeRelativePath(manifest.resourceDirectory, 'resourceDirectory');
  assertSafeRelativePath(manifest.developmentDirectory, 'developmentDirectory');
  if (!manifest.executables || typeof manifest.executables !== 'object') {
    throw new Error('Python runtime manifest requires executable paths');
  }
  for (const platform of SUPPORTED_PLATFORMS) {
    assertSafeRelativePath(manifest.executables[platform], `executables.${platform}`);
  }
  if (!Array.isArray(manifest.requiredFiles) || !manifest.requiredFiles.length) {
    throw new Error('Python runtime manifest requires requiredFiles');
  }
  manifest.requiredFiles.forEach((file, index) => assertSafeRelativePath(file, `requiredFiles[${index}]`));
  if (!manifest.workerEntrypoints || typeof manifest.workerEntrypoints !== 'object') {
    throw new Error('Python runtime manifest requires workerEntrypoints');
  }
  for (const [platform, entrypoint] of Object.entries(manifest.workerEntrypoints)) {
    if (!['instagram', 'youtube', 'x'].includes(platform)) {
      throw new Error(`Unsupported Python worker platform: ${platform}`);
    }
    assertSafeRelativePath(entrypoint, `workerEntrypoints.${platform}`);
  }
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw new Error(`Python runtime manifest ${label} must be a relative path`);
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Python runtime manifest ${label} cannot leave the runtime directory`);
  }
}

function resolvePythonRuntime(options = {}) {
  const manifest = options.manifest || readManifest(options.manifestPath);
  const platform = options.platform || process.platform;
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform for packaged Python runtime: ${platform}`);
  }

  const projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');
  const resourceBase = options.resourcesPath || process.resourcesPath;
  if (options.isPackaged && !resourceBase) {
    throw new Error('Packaged Python runtime requires an Electron resourcesPath');
  }
  const root = options.isPackaged
    ? path.join(resourceBase, manifest.resourceDirectory)
    : path.join(projectRoot, manifest.developmentDirectory);
  const executable = path.join(root, manifest.executables[platform]);

  return { manifest, platform, root, executable };
}

function verifyPythonRuntime(options = {}) {
  const runtime = resolvePythonRuntime(options);
  const requiredPaths = [runtime.manifest.executables[runtime.platform], ...runtime.manifest.requiredFiles];
  const missing = requiredPaths
    .map(relativePath => ({ relativePath, path: path.join(runtime.root, relativePath) }))
    .filter(file => !fs.existsSync(file.path));

  return {
    ok: missing.length === 0,
    ...runtime,
    missing,
  };
}

function resolveWorkerEntrypoint(platformId, options = {}) {
  const runtime = resolvePythonRuntime(options);
  const entrypoint = runtime.manifest.workerEntrypoints[platformId];
  if (!entrypoint) {
    throw new Error(`No packaged Python worker is registered for platform: ${platformId}`);
  }
  return {
    ...runtime,
    workerPath: path.join(runtime.root, entrypoint),
  };
}

module.exports = {
  MANIFEST_PATH,
  readManifest,
  validateManifest,
  resolvePythonRuntime,
  verifyPythonRuntime,
  resolveWorkerEntrypoint,
};
