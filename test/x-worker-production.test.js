'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workerRoot = path.join(root, 'runtime', 'python', 'workers');
const pythonCommand = process.platform === 'win32'
  ? path.join(root, 'runtime', 'python', 'python', 'python.exe')
  : (process.env.PYTHON || 'python3');

test('X production worker is covered with injected offline collector doubles', () => {
  const result = spawnSync(pythonCommand, ['test_x_worker_live.py'], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Ran 5 tests/);
});
