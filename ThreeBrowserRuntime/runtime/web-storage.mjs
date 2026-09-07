import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The URL is resolved lazily: the host installs browser globals before loading
// the project's document and learning its original origin.
export class PersistentStorage {
  #directory; #getURL; #file; #values = new Map();
  constructor(directory, getURL) { this.#directory = directory; this.#getURL = getURL; }
  #load() {
    const url = new URL(this.#getURL());
    const scope = url.origin === 'null' ? new URL('.', url).href : url.origin;
    const file = path.join(this.#directory, createHash('sha256').update(scope).digest('hex') + '.json');
    if (file === this.#file) return;
    let entries = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) entries = parsed.filter(e => Array.isArray(e) && e.length === 2 && e.every(v => typeof v === 'string'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    this.#file = file; this.#values = new Map(entries);
  }
  #save(next) {
    fs.mkdirSync(this.#directory, { recursive: true });
    const pending = `${this.#file}.${process.pid}.pending`;
    try {
      fs.writeFileSync(pending, JSON.stringify([...next]), 'utf8');
      fs.renameSync(pending, this.#file);
    } finally { fs.rmSync(pending, { force: true }); }
    this.#values = next;
  }
  get length() { this.#load(); return this.#values.size; }
  key(index) { this.#load(); return [...this.#values.keys()][Number(index) >>> 0] ?? null; }
  getItem(key) { this.#load(); return this.#values.get(String(key)) ?? null; }
  setItem(key, value) {
    this.#load(); key = String(key); value = String(value);
    if (this.#values.get(key) === value) return;
    this.#save(new Map(this.#values).set(key, value));
  }
  removeItem(key) {
    this.#load(); const next = new Map(this.#values);
    if (next.delete(String(key))) this.#save(next);
  }
  clear() { this.#load(); if (this.#values.size) this.#save(new Map()); }
}
