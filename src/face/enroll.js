// Enrollment helper: compute the 128-dimension face descriptor (and a small
// quality report) once, when the student photo is uploaded.  The descriptor is
// then stored on the server, so the attendance pages no longer have to
// re-detect every reference photo on every page load.
//
// The same tiny models used by the live scanner are reused here so the
// descriptor space stays identical.

import { FACE_DESCRIPTOR_VERSION } from "./liveness.js";

let modelsPromise = null;

export function loadFaceApi() {
  if (!modelsPromise) {
    modelsPromise = import("@vladmandic/face-api")
      .then(async (faceapi) => {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
          faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
        ]);
        return faceapi;
      })
      .catch((error) => {
        modelsPromise = null;
        throw error;
      });
  }
  return modelsPromise;
}

export const FACE_PHOTO_ERRORS = {
  no_face:
    "در این تصویر چهره‌ای شناسایی نشد؛ عکس روشن و روبه‌رو انتخاب کنید.",
  multiple_faces:
    "در این تصویر بیش از یک چهره دیده می‌شود؛ عکسی با یک نفر انتخاب کنید.",
  too_small:
    "چهره در تصویر خیلی کوچک است؛ نزدیک‌تر از دوربین عکس بگیرید.",
  low_quality:
    "کیفیت تصویر برای ثبت مرجع چهره کافی نیست؛ عکس واضح‌تری انتخاب کنید.",
};

// Returns { descriptor, quality, featureVersion } or throws an Error whose
// message can be shown directly to the user.
export async function buildFaceReference(file) {
  const faceapi = await loadFaceApi();
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await faceapi.fetchImage(objectUrl);
    const results = await faceapi
      .detectAllFaces(
        image,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 320,
          scoreThreshold: 0.45,
        }),
      )
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    if (!results.length) throw new Error(FACE_PHOTO_ERRORS.no_face);
    if (results.length > 1) throw new Error(FACE_PHOTO_ERRORS.multiple_faces);

    const [result] = results;
    const box = result.detection.box;
    if (box.width < 80 || box.height < 80) {
      throw new Error(FACE_PHOTO_ERRORS.too_small);
    }

    const quality = {
      score: Number(result.detection.score.toFixed(4)),
      faces: results.length,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };

    return {
      descriptor: Array.from(result.descriptor),
      quality,
      featureVersion: FACE_DESCRIPTOR_VERSION,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Last-resort sanity check before sending a descriptor to the server.
export function isUsableReference(reference) {
  return Boolean(
    reference &&
      Array.isArray(reference.descriptor) &&
      reference.descriptor.length === 128 &&
      reference.descriptor.every((value) => Number.isFinite(value)),
  );
}
