import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { managedPath } from './paths.ts';
import type { Product, Asset, Task } from './types.ts';

export class Store {
  root: string;
  db: DatabaseSync;
  constructor(root: string) {
    this.root = path.resolve(root);
    for (const dir of ['数据记录', '商品素材', '固定素材', '制作任务', '缓存']) fs.mkdirSync(path.join(this.root, dir), { recursive: true });
    this.db = new DatabaseSync(path.join(this.root, '数据记录', 'app.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,product_id TEXT,kind TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,completed INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
  }
  products(): Product[] { return this.db.prepare('SELECT data FROM products ORDER BY rowid').all().map(row => JSON.parse(String(row.data))); }
  product(id: string): Product | null { const row = this.db.prepare('SELECT data FROM products WHERE id=?').get(id); return row ? JSON.parse(String(row.data)) : null; }
  putProduct(data: Product) { this.db.prepare('INSERT INTO products(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.productId, JSON.stringify(data)); return data; }
  assets(productId?: string): Asset[] {
    const rows = productId === undefined ? this.db.prepare('SELECT data FROM assets ORDER BY rowid').all() : this.db.prepare('SELECT data FROM assets WHERE product_id=? ORDER BY rowid').all(productId);
    return rows.map(row => JSON.parse(String(row.data)));
  }
  asset(id: string): Asset | null { const row = this.db.prepare('SELECT data FROM assets WHERE id=?').get(id); return row ? JSON.parse(String(row.data)) : null; }
  putAsset(data: Asset) { this.db.prepare('INSERT INTO assets(id,product_id,kind,status,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,kind=excluded.kind,status=excluded.status,data=excluded.data').run(data.id, data.productId || null, data.kind, data.status, JSON.stringify(data)); return data; }
  tasks(): Task[] { return this.db.prepare('SELECT data FROM tasks ORDER BY updated_at DESC').all().map(row => JSON.parse(String(row.data))); }
  task(id: string): Task | null { const row = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id); return row ? JSON.parse(String(row.data)) : null; }
  putTask(data: Task) { data.updatedAt = new Date().toISOString(); this.db.prepare('INSERT INTO tasks(id,completed,updated_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed=excluded.completed,updated_at=excluded.updated_at,data=excluded.data').run(data.id, data.completed ? 1 : 0, data.updatedAt, JSON.stringify(data)); return data; }
  setting<T = unknown>(id: string, value?: T): T | null {
    if (value !== undefined) { this.db.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(value)); return value; }
    const row = this.db.prepare('SELECT data FROM settings WHERE id=?').get(id); return row ? JSON.parse(String(row.data)) : null;
  }
  path(relative: string) { return managedPath(this.root, relative); }
  taskDir(id: string) { return this.path(path.join('制作任务', id)); }
  close() { this.db.close(); }
  static id() { return randomUUID(); }
}
