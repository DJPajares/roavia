import { offlinePackageRecordSchema, type OfflinePackageRecord } from "@roavia/contracts";

const databaseName = "roavia-offline";
const databaseVersion = 1;
const packageStore = "packages";

export interface StoredOfflinePackage {
  downloadedAt: string;
  key: string;
  ownerId: string;
  record: OfflinePackageRecord;
  tripId: string;
}

export interface OfflineStorageEstimate {
  availableBytes: number | null;
  quotaBytes: number | null;
  usageBytes: number | null;
}

export class OfflineStorageError extends Error {
  readonly code: "cancelled" | "quota_exceeded" | "storage_unavailable";

  constructor(code: OfflineStorageError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OfflineStorageError";
    this.code = code;
  }
}

function packageKey(ownerId: string, tripId: string) {
  return `${ownerId}:${tripId}`;
}

function storageUnavailable(message: string, cause?: unknown) {
  return new OfflineStorageError("storage_unavailable", message, { cause });
}

function quotaExceeded(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(
      storageUnavailable("Offline storage is unavailable in this browser or browsing mode."),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(packageStore)) {
        const store = database.createObjectStore(packageStore, { keyPath: "key" });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(storageUnavailable("Roavia could not open offline storage.", request.error)),
    );
    request.addEventListener("blocked", () =>
      reject(storageUnavailable("Roavia offline storage is blocked by another open version.")),
    );
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new DOMException("Aborted", "AbortError")),
    );
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

function parseStoredPackage(value: unknown): StoredOfflinePackage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredOfflinePackage>;
  const record = offlinePackageRecordSchema.safeParse(candidate.record);
  if (
    !record.success ||
    typeof candidate.downloadedAt !== "string" ||
    typeof candidate.key !== "string" ||
    typeof candidate.ownerId !== "string" ||
    typeof candidate.tripId !== "string"
  ) {
    return null;
  }
  return { ...candidate, record: record.data } as StoredOfflinePackage;
}

export async function getOfflinePackage(
  ownerId: string,
  tripId: string,
): Promise<StoredOfflinePackage | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(packageStore, "readonly");
    const value = await requestResult(
      transaction.objectStore(packageStore).get(packageKey(ownerId, tripId)),
    );
    const parsed = parseStoredPackage(value);
    if (value && !parsed) {
      await removeOfflinePackage(ownerId, tripId);
    }
    return parsed;
  } catch (error) {
    throw storageUnavailable("Roavia could not read this offline package.", error);
  } finally {
    database.close();
  }
}

export async function listOfflinePackages(ownerId: string): Promise<StoredOfflinePackage[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(packageStore, "readonly");
    const values = await requestResult(
      transaction.objectStore(packageStore).index("ownerId").getAll(ownerId),
    );
    return values
      .map(parseStoredPackage)
      .filter((value): value is StoredOfflinePackage => value !== null)
      .toSorted((left, right) => right.downloadedAt.localeCompare(left.downloadedAt));
  } catch (error) {
    throw storageUnavailable("Roavia could not list offline packages.", error);
  } finally {
    database.close();
  }
}

export async function clearOfflinePackages(ownerId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(packageStore, "readwrite");
    const store = transaction.objectStore(packageStore);
    const keys = await requestResult(store.index("ownerId").getAllKeys(ownerId));
    for (const key of keys) store.delete(key);
    await transactionComplete(transaction);
  } catch (error) {
    throw storageUnavailable("Roavia could not clear this account's offline packages.", error);
  } finally {
    database.close();
  }
}

export async function saveOfflinePackage(
  ownerId: string,
  record: OfflinePackageRecord,
  options: { downloadedAt?: Date; signal?: AbortSignal } = {},
): Promise<StoredOfflinePackage> {
  if (options.signal?.aborted) {
    throw new OfflineStorageError("cancelled", "The offline download was cancelled.");
  }

  const stored: StoredOfflinePackage = {
    downloadedAt: (options.downloadedAt ?? new Date()).toISOString(),
    key: packageKey(ownerId, record.tripId),
    ownerId,
    record: offlinePackageRecordSchema.parse(record),
    tripId: record.tripId,
  };
  const database = await openDatabase();
  if (options.signal?.aborted) {
    database.close();
    throw new OfflineStorageError("cancelled", "The offline download was cancelled.");
  }
  const transaction = database.transaction(packageStore, "readwrite", { durability: "strict" });
  const abort = () => transaction.abort();
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    transaction.objectStore(packageStore).put(stored);
    await transactionComplete(transaction);
    return stored;
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new OfflineStorageError("cancelled", "The offline download was cancelled.", {
        cause: error,
      });
    }
    if (quotaExceeded(error)) {
      throw new OfflineStorageError(
        "quota_exceeded",
        "This device does not have enough storage for the offline package.",
        { cause: error },
      );
    }
    throw storageUnavailable("Roavia could not save this offline package.", error);
  } finally {
    options.signal?.removeEventListener("abort", abort);
    database.close();
  }
}

export async function removeOfflinePackage(ownerId: string, tripId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(packageStore, "readwrite");
    transaction.objectStore(packageStore).delete(packageKey(ownerId, tripId));
    await transactionComplete(transaction);
  } catch (error) {
    throw storageUnavailable("Roavia could not remove this offline package.", error);
  } finally {
    database.close();
  }
}

export async function estimateOfflineStorage(): Promise<OfflineStorageEstimate> {
  if (!navigator.storage?.estimate) {
    return { availableBytes: null, quotaBytes: null, usageBytes: null };
  }
  const estimate = await navigator.storage.estimate();
  const quotaBytes = estimate.quota ?? null;
  const usageBytes = estimate.usage ?? null;
  return {
    availableBytes:
      quotaBytes === null || usageBytes === null ? null : Math.max(0, quotaBytes - usageBytes),
    quotaBytes,
    usageBytes,
  };
}

export function assertStorageCapacity(
  estimate: OfflineStorageEstimate,
  requiredBytes: number,
): void {
  if (estimate.availableBytes !== null && estimate.availableBytes < requiredBytes) {
    throw new OfflineStorageError(
      "quota_exceeded",
      "This device does not have enough storage for the offline package.",
    );
  }
}
