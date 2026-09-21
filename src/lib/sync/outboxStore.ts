import type { StoredOp } from './outbox';

export interface OutboxDriver {
  transaction<T>(work: (rows: Map<string, StoredOp>) => T): Promise<T>;
  getAll(): Promise<StoredOp[]>;
}

export class IdbDriver implements OutboxDriver {
  private dbp: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('vyact_outbox', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('ops')) request.result.createObjectStore('ops', { keyPath: 'opId' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => { this.dbp = null; reject(request.error); };
    });
    return this.dbp;
  }

  async transaction<T>(work: (rows: Map<string, StoredOp>) => T): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('ops', 'readwrite');
      const store = transaction.objectStore('ops');
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Outbox transaction aborted'));
      transaction.onerror = () => { failure ??= transaction.error; };
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const original = new Map<string, StoredOp>(request.result.map(row => [row.opId, row]));
          const rows = new Map(original);
          result = work(rows);
          for (const key of original.keys()) if (!rows.has(key)) store.delete(key);
          for (const [key, row] of rows) if (original.get(key) !== row) store.put(row);
        } catch (error) { failure = error; transaction.abort(); }
      };
    });
  }
  async getAll(): Promise<StoredOp[]> { return this.transaction(rows => [...rows.values()]); }
  async close(): Promise<void> {
    if (this.dbp) (await this.dbp).close();
    this.dbp = null;
  }
}

export class MemoryDriver implements OutboxDriver {
  private rows = new Map<string, StoredOp>();
  async transaction<T>(work: (rows: Map<string, StoredOp>) => T): Promise<T> {
    const next = new Map(this.rows);
    const result = work(next);
    this.rows = next;
    return result;
  }
  async getAll(): Promise<StoredOp[]> { return [...this.rows.values()]; }
}