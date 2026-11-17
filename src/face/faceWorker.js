// Face-detection Web Worker (phase 3+ / option B).
//
// Running face-api on the UI thread made the classroom camera stutter on weak
// machines. This worker owns the models and the per-frame inference; the main
// thread only draws boxes and writes attendance.
//
// Protocol (all messages are plain JSON):
//   -> { type: "detect",  id, bitmap }   // ImageBitmap, ownership transferred
//   <- { type: "result",  id, faces: [{ box, descriptor, eyeRatio }] }
//   -> { type: "describe", id, url }
//   <- { type: "described", id, descriptor|null }
//   -> { type: "ping", id }
//   <- { type: "ready", id }
//   <- { type: "error", id, message }    // for any failed request

import * as faceapi from "@vladmandic/face-api";
import { eyeAspectRatio } from "./liveness.js";

// tfjs cannot detect its environment inside a module worker (no `document`),
// so it must be told explicitly before any model load or inference. `initialize`
// fails in a worker (neither browser nor node), so a manual env is installed.
if (typeof document === "undefined") {
  faceapi.env.setEnv({
    Canvas: typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas : undefined,
    // instanceof checks inside face-api/tfjs require these to be *objects*;
    // dummy classes keep the checks safe (they simply never match).
    Image: class ImageStub {},
    Video: class VideoStub {},
    CanvasRenderingContext2D: class CtxStub {},
    createCanvasElement: () =>
      new OffscreenCanvas(0, 0),
    createImageElement: () => {
      throw new Error("DOM images are not available in the face worker");
    },
    ImageData: typeof ImageData !== "undefined" ? ImageData : undefined,
    fetch: (...args) => fetch(...args),
    readFile: async () => {
      throw new Error("readFile is not available in the face worker");
    },
  });
}

const modelsPromise = (async () => {
  // WebGL (via OffscreenCanvas) is what the main thread already uses and is
  // orders of magnitude faster; cpu is only the last resort.
  for (const backend of ["cpu", "webgl"]) {
    try {
      const ok = await faceapi.tf.setBackend(backend);
      if (ok) break;
    } catch {
      // try the next backend
    }
  }
  await faceapi.tf.ready();
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
  ]);
  self.postMessage({ type: "ready" });
})().catch((error) => {
  // Tell the client immediately so it switches to the main-thread fallback
  // instead of waiting out the startup timeout.
  self.postMessage({ type: "fatal", message: String(error?.message || error) });
  throw error;
});

// face-api returns class instances (Box, Point); the structured clone only
// carries data across reliably as plain objects, so everything is mapped out.
function plainBox(box) {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function eyeRatioOf(landmarks) {
  if (!landmarks) return null;
  const toPoints = (points) => points.map((point) => ({ x: point.x, y: point.y }));
  const left = eyeAspectRatio(toPoints(landmarks.getLeftEye()));
  const right = eyeAspectRatio(toPoints(landmarks.getRightEye()));
  if (left == null || right == null) return null;
  return {
    left,
    right,
    mean: (left + right) / 2,
    min: Math.min(left, right),
    max: Math.max(left, right),
  };
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    await modelsPromise;

    if (message.type === "ping") {
      self.postMessage({ type: "ready", id: message.id });
      return;
    }

    if (message.type === "detect") {
      const results = await faceapi
        .detectAllFaces(
          message.bitmap,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.5,
          }),
        )
        .withFaceLandmarks(true)
        .withFaceDescriptors();
      message.bitmap?.close?.();
      self.postMessage({
        type: "result",
        id: message.id,
        faces: results.map((result) => ({
          box: plainBox(result.detection.box),
          descriptor: Array.from(result.descriptor),
          eyeRatio: eyeRatioOf(result.landmarks),
        })),
      });
      return;
    }

    if (message.type === "describe") {
      const image = await faceapi.fetchImage(message.url);
      const result = await faceapi
        .detectSingleFace(
          image,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.45,
          }),
        )
        .withFaceLandmarks(true)
        .withFaceDescriptor();
      self.postMessage({
        type: "described",
        id: message.id,
        descriptor: result ? Array.from(result.descriptor) : null,
      });
      return;
    }
  } catch (error) {
    message.bitmap?.close?.();
    self.postMessage({
      type: "error",
      id: message.id,
      message: String(error?.message || error),
      stack: error?.stack ? String(error.stack).slice(0, 1200) : null,
    });
  }
};
