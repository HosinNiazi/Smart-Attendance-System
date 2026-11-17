// Small IndexedDB cache for face descriptors computed from legacy photos.
//
// New references already carry their descriptor from the server, but photos
// uploaded before phase 1 have to be decoded once. Caching by the photo
// checksum means that expensive work happens at most once per browser.

const DB_NAME = "hozorban-face-cache";
const STORE_NAME = "descriptors";
const DB_VERSION = 1;

let dbPromise = null;

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

export async function getCachedDescriptor(key) {
  if (!key) return null;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(key);
      request.onsuccess = () => {
        const value = request.result;
        resolve(Array.isArray(value) && value.length === 128 ? value : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedDescriptor(key, descriptor) {
  if (!key || !Array.isArray(descriptor) || descriptor.length !== 128) return;
  const db = await openDatabase();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put(descriptor, key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearDescriptorCache() {
  const db = await openDatabase();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .clear();
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
