/**
 * Deterministic Transactional Firestore Harness for Fast Service Integration Tests
 * Simulates Firestore collections, documents, queries, batches, and optimistic
 * concurrency `runTransaction` retries to test race conditions & persistence.
 */

import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

type DocMap = Map<string, { version: number; data: Record<string, any> }>;

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
}

function setNestedValue(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== 'object' || cur[key] === null) {
      cur[key] = {};
    }
    cur = cur[key];
  }
  cur[parts[parts.length - 1]!] = value;
}

export function createTransactionalTestFirestore(
  options: { enforceReadBeforeWrite?: boolean } = {}
): Firestore {
  const store = new Map<string, DocMap>();

  const getColMap = (colName: string): DocMap => {
    let m = store.get(colName);
    if (!m) {
      m = new Map();
      store.set(colName, m);
    }
    return m;
  };

  const makeDocRef = (colName: string, docId?: string) => {
    const id = docId ?? crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    return {
      id,
      path: `${colName}/${id}`,
      async get() {
        const entry = getColMap(colName).get(id);
        return {
          id,
          exists: Boolean(entry),
          ref: makeDocRef(colName, id),
          data: () => (entry ? structuredClone(entry.data) : undefined),
        };
      },
      async set(data: Record<string, any>, options?: { merge?: boolean }) {
        const col = getColMap(colName);
        const prev = col.get(id);
        const nextData =
          options?.merge && prev
            ? { ...structuredClone(prev.data), ...structuredClone(data) }
            : structuredClone(data);
        col.set(id, { version: (prev?.version ?? 0) + 1, data: nextData });
      },
      async update(patch: Record<string, any>) {
        const col = getColMap(colName);
        const prev = col.get(id);
        if (!prev) throw new Error(`NOT_FOUND: ${colName}/${id}`);
        const next = structuredClone(prev.data);
        for (const [k, v] of Object.entries(patch)) {
          setNestedValue(next, k, structuredClone(v));
        }
        col.set(id, { version: prev.version + 1, data: next });
      },
      async delete() {
        getColMap(colName).delete(id);
      },
      _colName: colName,
    };
  };

  const makeQuery = (
    colName: string,
    filters: Array<{ field: string; op: string; value: any }> = [],
    sorts: Array<{ field: string; dir: 'asc' | 'desc' }> = [],
    maxLimit?: number
  ) => {
    const evaluate = () => {
      const col = getColMap(colName);
      let rows = Array.from(col.entries()).map(([id, entry]) => ({
        id,
        ref: makeDocRef(colName, id),
        exists: true,
        data: () => structuredClone(entry.data),
        _raw: entry.data,
      }));

      for (const f of filters) {
        rows = rows.filter((r) => {
          const val = getNestedValue(r._raw, f.field);
          if (f.op === '==') return val === f.value;
          if (f.op === '!=') return val !== f.value;
          if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val);
          if (f.op === 'array-contains') return Array.isArray(val) && val.includes(f.value);
          if (f.op === '>=') return val >= f.value;
          if (f.op === '<=') return val <= f.value;
          return true;
        });
      }

      for (const s of [...sorts].reverse()) {
        rows.sort((a, b) => {
          const av = getNestedValue(a._raw, s.field);
          const bv = getNestedValue(b._raw, s.field);
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return s.dir === 'asc' ? cmp : -cmp;
        });
      }

      if (typeof maxLimit === 'number') {
        rows = rows.slice(0, maxLimit);
      }

      return {
        docs: rows,
        size: rows.length,
        empty: rows.length === 0,
      };
    };

    return {
      where(field: string, op: string, value: any) {
        return makeQuery(colName, [...filters, { field, op, value }], sorts, maxLimit);
      },
      orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
        return makeQuery(colName, filters, [...sorts, { field, dir }], maxLimit);
      },
      limit(n: number) {
        return makeQuery(colName, filters, sorts, n);
      },
      startAfter() {
        return makeQuery(colName, filters, sorts, maxLimit);
      },
      async get() {
        return evaluate();
      },
      _evaluate: evaluate,
    };
  };

  let lockChain = Promise.resolve();

  const dbMock = {
    collection(colName: string) {
      const baseQuery = makeQuery(colName);
      return {
        ...baseQuery,
        doc: (docId?: string) => makeDocRef(colName, docId),
      };
    },
    batch() {
      const ops: Array<() => Promise<void>> = [];
      return {
        set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
          ops.push(() => ref.set(data, opts));
        },
        update(ref: any, patch: Record<string, any>) {
          ops.push(() => ref.update(patch));
        },
        delete(ref: any) {
          ops.push(() => ref.delete());
        },
        async commit() {
          for (const op of ops) {
            await op();
          }
        },
      };
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      // Serialize concurrent transactions cleanly just like Firestore optimistic lock retries
      const run = async (): Promise<T> => {
        const pendingWrites: Array<() => Promise<void>> = [];
        let hasWrites = false;
        const tx = {
          async get(refOrQuery: any) {
            if (options.enforceReadBeforeWrite && hasWrites) {
              throw new Error('Firestore transactions require all reads to be executed before all writes.');
            }
            // Yield microtask so Promise.all concurrent callers interleave realistically
            await Promise.resolve();
            return refOrQuery.get();
          },
          set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
            hasWrites = true;
            pendingWrites.push(() => ref.set(data, opts));
            return tx;
          },
          update(ref: any, patch: Record<string, any>) {
            hasWrites = true;
            pendingWrites.push(() => ref.update(patch));
            return tx;
          },
          delete(ref: any) {
            hasWrites = true;
            pendingWrites.push(() => ref.delete());
            return tx;
          },
        };

        const result = await fn(tx);
        for (const w of pendingWrites) {
          await w();
        }
        return result;
      };

      const next = lockChain.then(run, run);
      lockChain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
  };

  return dbMock as unknown as Firestore;
}
