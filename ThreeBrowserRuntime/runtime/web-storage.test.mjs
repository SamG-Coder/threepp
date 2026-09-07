import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentStorage } from './web-storage.mjs';

test('local storage survives host recreation and follows the loaded document origin', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-'));
  try {
    let url = 'https://example.test/a';
    const storage = new PersistentStorage(directory, () => url);
    storage.setItem('quality', 'High'); storage.setItem('number', 3);
    const restarted = new PersistentStorage(directory, () => 'https://example.test/b');
    assert.equal(restarted.getItem('quality'), 'High');
    assert.equal(restarted.getItem('number'), '3');
    url = 'https://other.test/a'; assert.equal(storage.length, 0);
    storage.setItem('quality', 'Low');
    url = 'https://example.test/a'; assert.equal(storage.getItem('quality'), 'High');
    storage.removeItem('number'); assert.equal(storage.length, 1);
    storage.clear();
    assert.equal(new PersistentStorage(directory, () => url).length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
