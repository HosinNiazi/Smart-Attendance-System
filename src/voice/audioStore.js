const DB_NAME = "smart-attendance-audio";
const STORE = "clips";
let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("ذخیره‌سازی صوت در این مرورگر پشتیبانی نمی‌شود."));
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = null; reject(request.error); };
  });
  return databasePromise;
}

export async function saveClip(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ key, ...value });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getClip(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getProfiles(studentIds) {
  const db = await openDatabase();
  const allowed = new Set(studentIds);
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result.filter((item) => item.kind === "profile" && allowed.has(item.studentId)));
    request.onerror = () => reject(request.error);
  });
}

export async function saveProfileSample(studentId, sample, limit = 3) {
  const key = `profile:${studentId}`;
  const current = await getClip(key);
  const samples = current?.samples || (current?.features ? [{ features: current.features, featureVersion: current.featureVersion, blob: current.blob, savedAt: current.savedAt }] : []);
  samples.push(sample);
  const kept = samples.slice(-limit);
  await saveClip(key, { kind: "profile", studentId, samples: kept, features: kept[kept.length - 1].features, featureVersion: kept[kept.length - 1].featureVersion, savedAt: Date.now() });
}

export async function exportAudioProfiles() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result.filter((item) => item.kind === "profile").map((item) => ({ studentId: item.studentId, samples: (item.samples || [item]).map((sample) => ({ features: sample.features, featureVersion: sample.featureVersion, savedAt: sample.savedAt })) })));
    request.onerror = () => reject(request.error);
  });
}

export async function restoreAudioProfiles(profiles = []) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      request.result.filter((item) => item.kind === "profile").forEach((item) => store.delete(item.key));
      profiles.forEach((profile) => {
        if (!profile?.studentId || !Array.isArray(profile.samples)) return;
        const samples = profile.samples.filter((sample) => Array.isArray(sample.features) && sample.features.length === 24 && sample.features.every(Number.isFinite)).slice(-3);
        if (samples.length) store.put({ key: `profile:${profile.studentId}`, kind: "profile", studentId: profile.studentId, samples, features: samples[samples.length - 1].features, featureVersion: samples[samples.length - 1].featureVersion, savedAt: Date.now() });
      });
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
