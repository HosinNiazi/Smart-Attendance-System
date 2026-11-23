// Promise-based client for the face-detection Web Worker.
//
// Everything fails soft: when the worker cannot start (or dies), callers get
// `null` and fall back to the legacy main-thread detection, so a worker bug can
// never take attendance down.

const REQUEST_TIMEOUT_MS = 20000;
// A single detection frame must answer quickly; anything slower than a few
// frames' budget means the worker is effectively unusable and the main thread
// should take over for the rest of the session.
const DETECT_TIMEOUT_MS = 3000;

let worker = null;
let startup = null; // Promise<boolean> — resolves true when the worker answered
let broken = false;
let nextId = 1;
const pending = new Map();

function failPending(reason) {
  for (const { reject } of pending.values())
    reject(new Error(reason));
  pending.clear();
}

function handleMessage(data) {
  if (!data || typeof data !== "object") return;
  if (data.type === "fatal") {
    broken = true;
    failPending(data.message || "worker fatal");
    startup?.resolve(false);
    return;
  }
  if (data.type === "ready") {
    broken = false;
    startup?.resolve(true);
    return;
  }
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  if (data.type === "error") entry.reject(new Error(data.message || "worker"));
  else entry.resolve(data);
}

export function createWorkerClient() {
  if (broken) return false;
  if (worker) return true;
  if (typeof Worker === "undefined") {
    broken = true;
    return false;
  }
  try {
    worker = new Worker(new URL("./faceWorker.js", import.meta.url), {
      type: "module",
    });
  } catch {
    worker = null;
    broken = true;
    return false;
  }
  worker.onmessage = (event) => handleMessage(event.data);
  worker.onerror = () => {
    broken = true;
    failPending("worker crashed");
  };
  startup = { resolve: null };
  startup.promise = new Promise((resolve) => {
    startup.resolve = resolve;
  });
  // A worker that never answers falls back to the main thread.
  setTimeout(() => {
    if (startup) {
      broken = true;
      failPending("worker startup timeout");
      startup.resolve(false);
    }
  }, REQUEST_TIMEOUT_MS).unref?.();
  try {
    worker.postMessage({ type: "ping", id: 0 });
  } catch {
    broken = true;
    return false;
  }
  return true;
}

export async function workerReady() {
  if (!createWorkerClient()) return false;
  return startup.promise;
}

function request(payload, transfer, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("worker timeout"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    // The worker echoes this id back; replacing the placeholder id is what
    // pairs each reply with its pending request.
    worker.postMessage({ ...payload, id }, transfer || []);
  });
}

// Runs one detection frame. `bitmap` ownership is transferred to the worker.
// Resolves null when the worker is unavailable — the caller falls back. One
// failed frame disables the worker for the session: a worker that misses a
// 3-second frame budget (or errors) cannot keep up anyway.
export async function detectFacesInWorker(bitmap) {
  if (!createWorkerClient() || broken) {
    bitmap?.close?.();
    return null;
  }
  try {
    const data = await request(
      { type: "detect", id: 0, bitmap },
      [bitmap],
      DETECT_TIMEOUT_MS,
    );
    return data.faces || [];
  } catch {
    broken = true;
    failPending("worker detection failed");
    return null;
  }
}

// Builds a descriptor for a legacy reference photo, or null when the worker is
// unavailable / finds no face. The caller decides on caching and fallback.
export async function describeReferenceInWorker(url) {
  if (!createWorkerClient() || broken) return null;
  try {
    const data = await request({ type: "describe", id: 0, url });
    return data.descriptor || null;
  } catch {
    return null;
  }
}
