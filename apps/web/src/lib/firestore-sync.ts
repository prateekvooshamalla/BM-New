import {
  collection,
  onSnapshot,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { auth, callBackendFunction, db } from '@/lib/firebase';

export interface SubscribeTenantCollectionOptions<T> {
  orgId: string;
  collectionName: string;
  projectId?: string | null;
  extraConstraints?: QueryConstraint[];
  filter?: (item: T) => boolean;
  sort?: (a: T, b: T) => number;
  onData: (items: T[]) => void;
}

/**
 * Real-time tenant collection subscription that avoids composite-index-blocking `orderBy`
 * clauses (sorting deterministically in memory) and automatically falls back to the
 * authenticated `getOrganizationCollectionSnapshot` server callable if client snapshot
 * fails due to rule/index propagation.
 */
export function subscribeTenantCollection<T = Record<string, unknown>>(
  opts: SubscribeTenantCollectionOptions<T>
): () => void {
  const {
    orgId,
    collectionName,
    projectId,
    extraConstraints = [],
    filter,
    sort,
    onData,
  } = opts;

  let disposed = false;

  const trimmedOrgId = typeof orgId === 'string' ? orgId.trim() : '';
  if (!trimmedOrgId) {
    onData([]);
    return () => {
      disposed = true;
    };
  }

  const applyTransform = (raw: T[]) => {
    if (disposed) return;
    let next = filter ? raw.filter(filter) : [...raw];
    if (sort) {
      next = next.sort(sort);
    }
    onData(next);
  };

  const constraints: QueryConstraint[] = [where('orgId', '==', trimmedOrgId)];
  if (projectId && typeof projectId === 'string' && projectId.trim()) {
    constraints.push(where('projectId', '==', projectId.trim()));
  }
  constraints.push(...extraConstraints);

  const q = query(collection(db, collectionName), ...constraints);

  const unsub = onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as T);
      applyTransform(list);
    },
    async () => {
      if (disposed) return;
      if (!auth.currentUser || !trimmedOrgId) return;
      try {
        const res = await callBackendFunction<
          { orgId: string; collectionName: string; projectId?: string | null },
          { items: T[] }
        >('getOrganizationCollectionSnapshot', {
          orgId: trimmedOrgId,
          collectionName: collectionName.trim(),
          projectId: projectId && typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null,
        });
        applyTransform(res.items ?? []);
      } catch {
        // Keep existing UI state if offline
      }
    }
  );

  return () => {
    disposed = true;
    unsub();
  };
}

export function sortDescByIso<T>(field: keyof T): (a: T, b: T) => number {
  return (a, b) =>
    String(b[field] ?? '').localeCompare(String(a[field] ?? ''));
}

export function sortAscByIso<T>(field: keyof T): (a: T, b: T) => number {
  return (a, b) =>
    String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
}
