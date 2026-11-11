import React, { useEffect, useRef, useState } from "react";
import { Icon, PanelTitle, Badge, EmptyState, StudentAvatar } from "../components/shared.jsx";
import { JalaliDateInput } from "../components/JalaliDateInput.jsx";
import { saveClip } from "./audioStore.js";

const PHRASE = "امروز برای حضور در کلاس جمله ثابت را واضح می‌خوانم";
const LIMIT_MS = 60_000;
const FEATURE_VERSION = 2;
const FEATURE_BINS = 24;

function fftPower(input) {
  const n = input.length, real = Float64Array.from(input), imag = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size, stepReal = Math.cos(angle), stepImag = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wr = 1, wi = 0;
      for (let j = 0; j < size / 2; j++) {
        const even = start + j, odd = even + size / 2;
        const tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
        real[even] += tr; imag[even] += ti;
        [wr, wi] = [wr * stepReal - wi * stepImag, wr * stepImag + wi * stepReal];
      }
    }
  }
  return real.map((value, index) => value * value + imag[index] * imag[index]);
}

// Local prototype descriptor only; it is not a speaker-recognition biometric model.
async function audioFeatures(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("پردازش صدا در این مرورگر پشتیبانی نمی‌شود.");
  const context = new AudioContextClass();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > 60) throw new Error("مدت فایل صوتی نباید بیشتر از ۶۰ ثانیه باشد.");
    if (audio.duration < 1) throw new Error("فایل صوتی خیلی کوتاه است؛ حداقل یک ثانیه صدا لازم است.");
    const channelCount = audio.numberOfChannels;
    const sourceStep = Math.max(1, Math.round(audio.sampleRate / 16_000));
    const sampleRate = audio.sampleRate / sourceStep;
    const length = Math.ceil(audio.length / sourceStep);
    const samples = new Float32Array(length);
    for (let channel = 0; channel < channelCount; channel++) {
      const input = audio.getChannelData(channel);
      for (let i = 0; i < length; i++) samples[i] += input[i * sourceStep] / channelCount;
    }
    const frame = 512, stride = 256, bins = FEATURE_BINS;
    const sums = new Float64Array(bins);
    let frames = 0, voicedSeconds = 0, clipped = 0;
    const bandEdges = Array.from({ length: bins + 1 }, (_, band) => Math.max(1, Math.floor((80 * (Math.min(7600, sampleRate / 2 - 1) / 80) ** (band / bins)) * frame / sampleRate)));
    for (let start = 0; start + frame <= samples.length; start += stride) {
      const windowed = new Float32Array(frame);
      let power = 0;
      for (let n = 0; n < frame; n++) {
        const sample = samples[start + n];
        power += sample * sample;
        if (Math.abs(sample) > 0.985) clipped++;
        windowed[n] = sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * n / (frame - 1)));
      }
      if (Math.sqrt(power / frame) < 0.004) continue;
      const spectrum = fftPower(windowed);
      for (let band = 0; band < bins; band++) {
        const from = Math.min(frame / 2 - 1, bandEdges[band]), to = Math.max(from + 1, Math.min(frame / 2, bandEdges[band + 1]));
        let energy = 0;
        for (let k = from; k < to; k++) energy += spectrum[k];
        sums[band] += Math.log1p(energy / (to - from));
      }
      frames++; voicedSeconds += stride / sampleRate;
    }
    if (voicedSeconds < 0.65 || frames < 20) throw new Error("صدای واضح کافی دریافت نشد. حداقل یک ثانیه با فاصلهٔ مناسب از میکروفون صحبت کنید.");
    if (clipped / length > 0.08) throw new Error("صدا بیش از حد بلند و بریده ضبط شده؛ کمی از میکروفون فاصله بگیرید.");
    const values = Array.from(sums, (value) => value / frames);
    const mean = values.reduce((sum, value) => sum + value, 0) / bins;
    const centered = values.map((value) => value - mean);
    const norm = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(norm) || norm < 1e-8) throw new Error("کیفیت صدای ضبط‌شده برای مقایسه کافی نیست.");
    return centered.map((value) => value / norm);
  } finally { await context.close(); }
}

function encodeWav(chunks, sampleRate) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  writeText(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); writeText(8, "WAVE");
  writeText(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, "data"); view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function score(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== FEATURE_BINS || b.length !== FEATURE_BINS) return -1;
  if (![...a, ...b].every(Number.isFinite)) return -1;
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function rankProfiles(features, profiles) {
  return profiles.map((profile) => {
    const samples = profile.samples?.length ? profile.samples : [profile];
    const scores = samples.filter((sample) => sample.featureVersion === FEATURE_VERSION).map((sample) => score(features, sample.features)).filter((value) => value >= 0);
    return { profile, value: scores.length ? Math.max(...scores) : -1 };
  }).filter((item) => item.value >= 0).sort((a, b) => b.value - a.value);
}

function identifyVoice(features, profiles) {
  const ranked = rankProfiles(features, profiles);
  if (!ranked.length) return { student: null, reason: "نمونهٔ صوتی معتبر وجود ندارد. نمونه‌های قدیمی را دوباره ضبط کنید." };
  const margin = ranked[0].value - (ranked[1]?.value ?? -1);
  if (ranked[0].value < 0.88) return { student: null, reason: "صدا با نمونه‌های ذخیره‌شده تطبیق کافی نداشت؛ واضح‌تر و با همان عبارت ضبط کنید." };
  if (ranked.length > 1 && margin < 0.055) return { student: null, reason: "چند نمونه به صدا نزدیک‌اند؛ برای جلوگیری از ثبت اشتباه، حضور ثبت نشد." };
  return { studentId: ranked[0].profile.studentId };
}

function RecordingIndicator({ seconds, level = 0, className = "" }) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return <div className={`voice-recording-indicator ${className}`} role="status" aria-live="polite">
    <span className="voice-live-dot" />
    <span className={`voice-wave${level > 0.02 ? " has-signal" : ""}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>
    <strong>{level > 0.02 ? "صدا دریافت می‌شود" : "در انتظار صدا…"}</strong>
    <time>{minutes}:{remainder}</time>
    <span className="voice-recording-limit">از ۰۱:۰۰</span>
  </div>;
}

function MicrophoneStatus({ status }) {
  const labels = {
    idle: "میکروفون آمادهٔ اتصال است",
    requesting: "در انتظار اجازهٔ میکروفون",
    recording: "میکروفون متصل و در حال ضبط",
    processing: "ضبط تمام شد؛ صدا در حال بررسی است",
    ready: "ضبط صدا با موفقیت پایان یافت",
    blocked: "اجازهٔ میکروفون مسدود شده است",
    error: "میکروفون در دسترس نیست",
  };
  const icons = { idle: "bi-mic", requesting: "bi-hourglass-split", recording: "bi-mic-fill", processing: "bi-soundwave", ready: "bi-check-circle", blocked: "bi-shield-lock", error: "bi-exclamation-circle" };
  return <div className={`voice-mic-status is-${status}`} role="status" aria-live="polite"><Icon name={icons[status] || icons.idle} /><span>{labels[status] || labels.idle}</span></div>;
}

export function VoiceAttendance({ courses, students, attendance, sessionCourse, setSessionCourse, sessionDate, setSessionDate, sessionId, onMarkAttendance, voiceProfiles = [], onSaveVoiceSample }) {
  const profiles = voiceProfiles;
  const [recording, setRecording] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [micStatus, setMicStatus] = useState("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [modalTarget, setModalTarget] = useState(null);
  const [message, setMessage] = useState("ابتدا برای هر دانشجو نمونهٔ صدا ثبت کنید.");
  const streamRef = useRef(null), audioContextRef = useRef(null), sourceRef = useRef(null), processorRef = useRef(null), gainRef = useRef(null), pcmChunksRef = useRef([]), captureActiveRef = useRef(false), timerRef = useRef(null), stopTimeoutRef = useRef(null), startRef = useRef(0), stopRef = useRef(null);
  useEffect(() => () => { captureActiveRef.current = false; clearInterval(timerRef.current); clearTimeout(stopTimeoutRef.current); streamRef.current?.getTracks().forEach((track) => track.stop()); sourceRef.current?.disconnect(); processorRef.current?.disconnect(); gainRef.current?.disconnect(); audioContextRef.current?.close().catch(() => {}); }, []);

  function microphoneErrorMessage(error) {
    switch (error?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return "اجازهٔ میکروفون مسدود است. از تنظیمات کنار نوار آدرس، مجوز Microphone را روی Allow بگذارید؛ سپس صفحه را تازه‌سازی کنید. دسترسی میکروفون به HTTPS یا localhost نیاز دارد.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "میکروفونی پیدا نشد. اتصال میکروفون و انتخاب ورودی صدا در تنظیمات ویندوز را بررسی کنید.";
      case "NotReadableError":
      case "TrackStartError":
        return "میکروفون مشغول برنامهٔ دیگری است. برنامه‌هایی مثل Zoom یا Teams را ببندید و دوباره تلاش کنید.";
      case "OverconstrainedError":
        return "تنظیمات ورودی صدا با میکروفون سازگار نیست. میکروفون پیش‌فرض سیستم را انتخاب کنید.";
      default:
        return `دسترسی میکروفون برقرار نشد (${error?.name || "خطای ناشناخته"}). مجوز سایت و ورودی صدای سیستم را بررسی کنید.`;
    }
  }

  async function handleAudioFile(file) {
    if (!file || !modalTarget) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|webm|ogg|aac|flac)$/i.test(file.name)) { setMessage("لطفاً یک فایل صوتی انتخاب کنید."); return; }
    if (file.size > 15 * 1024 * 1024) { setMessage("حجم فایل باید کمتر از ۱۵ مگابایت باشد."); return; }
    setBusy(true);
    try {
      const features = await audioFeatures(file);
      if (modalTarget === "session") {
        const match = identifyVoice(features, profiles);
        const student = students.find((item) => item.id === match.studentId);
        if (!student) setMessage(match.reason || "صدای دانشجو شناسایی نشد.");
        else if (attendance.some((item) => item.sessionId === sessionId && String(item.id ?? item.studentId) === String(student.id))) setMessage(`حضور ${student.name} قبلاً برای این جلسه ثبت شده است.`);
        else {
          const recorded = onMarkAttendance(student.id, "حاضر", { method: "voice" });
          if (!recorded) setMessage("ثبت حضور انجام نشد؛ جلسه یا بازهٔ مجاز آن را بررسی کنید.");
          else {
            setMessage(`حضور ${student.name} ثبت شد.`);
            try { await saveClip(`session:${sessionId}:${Date.now()}`, { kind: "session", sessionId, blob: file, savedAt: Date.now() }); }
            catch { setMessage(`حضور ${student.name} ثبت شد؛ ذخیرهٔ فایل صوتی در مرورگر انجام نشد.`); }
          }
        }
      } else {
        await onSaveVoiceSample?.(modalTarget, { features, featureVersion: FEATURE_VERSION, savedAt: Date.now() });
        setMessage("نمونهٔ صوتی در دیتابیس ذخیره شد.");
      }
      setModalTarget(null);
    } catch (error) { setMessage(error.message || "پردازش فایل صوتی انجام نشد."); }
    finally { setBusy(false); }
  }

  async function startRecording(studentId = null) {
    if (busy || recording || micStatus === "requesting") return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMicStatus("error");
      setMessage("\u0645\u0631\u0648\u0631\u06af\u0631 \u0627\u062c\u0627\u0632\u0647\u0654 \u0645\u06cc\u06a9\u0631\u0648\u0641\u0648\u0646 \u0646\u0645\u06cc\u200c\u062f\u0647\u062f \u0686\u0648\u0646 \u0635\u0641\u062d\u0647 \u062f\u0631 \u0622\u062f\u0631\u0633 \u0627\u0645\u0646 \u0628\u0627\u0632 \u0646\u0634\u062f\u0647 \u0627\u0633\u062a. \u0628\u0631\u0646\u0627\u0645\u0647 \u0631\u0627 \u0628\u0627 localhost \u06cc\u0627 HTTPS \u0628\u0627\u0632 \u06a9\u0646\u06cc\u062f."); return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !AudioContextClass.prototype.createScriptProcessor) {
      setMicStatus("error"); setMessage("\u0636\u0628\u0637 \u0632\u0646\u062f\u0647 \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0646\u0645\u06cc\u200c\u0634\u0648\u062f. \u0644\u0637\u0641\u0627\u064b Chrome \u06cc\u0627 Edge \u0628\u0647\u200c\u0631\u0648\u0632 \u0631\u0627 \u0627\u0645\u062a\u062d\u0627\u0646 \u06a9\u0646\u06cc\u062f."); return;
    }
    setMicStatus("requesting");
    setMessage("\u062f\u0631\u062e\u0648\u0627\u0633\u062a \u0627\u062c\u0627\u0632\u0647\u0654 \u0645\u06cc\u06a9\u0631\u0648\u0641\u0648\u0646\u2026 \u0627\u06af\u0631 \u067e\u06cc\u0627\u0645 \u0627\u062c\u0627\u0632\u0647 \u0628\u0627\u0632 \u0634\u062f\u060c \u06af\u0632\u06cc\u0646\u0647\u0654 Allow \u0631\u0627 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f.");
    let stream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (error) {
        if (error?.name !== "OverconstrainedError" && error?.name !== "TypeError") throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const track = stream.getAudioTracks().find((item) => item.readyState === "live");
      if (!track) throw new DOMException("No active audio input track was returned", "NotFoundError");
      streamRef.current = stream;
      const context = new AudioContextClass();
      audioContextRef.current = context;
      await context.resume();
      if (context.state !== "running") throw new Error("Audio context did not start");
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      source.connect(processor); processor.connect(silentOutput); silentOutput.connect(context.destination);
      sourceRef.current = source; processorRef.current = processor; gainRef.current = silentOutput;
      pcmChunksRef.current = [];
      captureActiveRef.current = true;
      processor.onaudioprocess = (event) => {
        if (!captureActiveRef.current) return;
        const channel = event.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(channel));
        let power = 0;
        for (let i = 0; i < channel.length; i++) power += channel[i] * channel[i];
        setMicLevel(Math.min(1, Math.sqrt(power / channel.length) * 8));
      };
      startRef.current = Date.now(); setSeconds(0); setRecording(studentId || "session"); setMicStatus("recording");
      setMessage("\u062f\u0631 \u062d\u0627\u0644 \u0636\u0628\u0637 \u0632\u0646\u062f\u0647\u061b \u0639\u0628\u0627\u0631\u062a \u0628\u0627\u0644\u0627 \u0631\u0627 \u0648\u0627\u0636\u062d \u0628\u062e\u0648\u0627\u0646\u06cc\u062f.");
      timerRef.current = setInterval(() => setSeconds(Math.min(60, Math.floor((Date.now() - startRef.current) / 1000))), 250);
      stopRef.current = async () => {
        if (!captureActiveRef.current) return;
        captureActiveRef.current = false;
        clearInterval(timerRef.current); clearTimeout(stopTimeoutRef.current);
        processor.onaudioprocess = null;
        try { source.disconnect(); processor.disconnect(); silentOutput.disconnect(); } catch {}
        stream.getTracks().forEach((item) => item.stop()); streamRef.current = null;
        const sampleRate = context.sampleRate;
        await context.close(); audioContextRef.current = null;
        setRecording(null); setMicLevel(0); setMicStatus("processing");
        const blob = encodeWav(pcmChunksRef.current, sampleRate);
        pcmChunksRef.current = [];
        if (blob.size < 16000) { setMicStatus("error"); setMessage("\u0635\u062f\u0627\u06cc\u06cc \u062b\u0628\u062a \u0646\u0634\u062f. \u0645\u06cc\u06a9\u0631\u0648\u0641\u0648\u0646 \u067e\u06cc\u062f\u0627 \u0634\u062f \u0627\u0645\u0627 \u0648\u0631\u0648\u062f\u06cc \u0635\u062f\u0627 \u062e\u0627\u0644\u06cc \u0628\u0648\u062f. \u0635\u062f\u0627\u06cc \u0648\u0631\u0648\u062f\u06cc \u0633\u06cc\u0633\u062a\u0645 \u0631\u0627 \u0628\u0631\u0631\u0633\u06cc \u06a9\u0646\u06cc\u062f."); return; }
        setBusy(true);
        try {
          const features = await audioFeatures(blob);
          if (studentId) {
            await onSaveVoiceSample?.(studentId, { features, featureVersion: FEATURE_VERSION, savedAt: Date.now() });
            setMessage("نمونهٔ صدا در دیتابیس ذخیره شد. برای دقت بهتر تا سه نمونه با شرایط متفاوت ثبت کنید.");
          } else {
            const match = identifyVoice(features, profiles);
            const student = students.find((item) => item.id === match.studentId);
            if (!student) setMessage(match.reason || "صدای دانشجو شناسایی نشد.");
            else if (attendance.some((item) => item.sessionId === sessionId && String(item.id ?? item.studentId) === String(student.id))) setMessage(`حضور ${student.name} قبلاً برای این جلسه ثبت شده است.`);
            else {
              const recorded = onMarkAttendance(student.id, "حاضر", { method: "voice" });
              if (!recorded) setMessage("ثبت حضور انجام نشد؛ جلسه یا بازهٔ مجاز آن را بررسی کنید.");
              else {
                setMessage(`حضور ${student.name} ثبت شد.`);
                try { await saveClip(`session:${sessionId}:${Date.now()}`, { kind: "session", sessionId, blob, savedAt: Date.now() }); }
                catch { setMessage(`حضور ${student.name} ثبت شد؛ ذخیرهٔ فایل صوتی در مرورگر انجام نشد.`); }
              }
            }
          }
          setMicStatus("ready");
        } catch (error) { setMicStatus("error"); setMessage(error.message || "\u067e\u0631\u062f\u0627\u0632\u0634 \u0635\u062f\u0627 \u0627\u0646\u062c\u0627\u0645 \u0646\u0634\u062f."); }
        finally { setBusy(false); }
      };
      stopTimeoutRef.current = setTimeout(() => stopRef.current?.(), LIMIT_MS);
    } catch (error) {
      captureActiveRef.current = false;
      stream?.getTracks().forEach((item) => item.stop()); streamRef.current = null;
      if (audioContextRef.current) { await audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
      setRecording(null); setMicLevel(0);
      setMicStatus(error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError" ? "blocked" : "error");
      setMessage(microphoneErrorMessage(error));
    }
  }
  const registered = new Set(profiles.filter((profile) => (profile.samples || [profile]).some((sample) => sample.featureVersion === FEATURE_VERSION && score(sample.features, sample.features) >= 0)).map((profile) => profile.studentId));
  const hasStoredProfile = new Set(profiles.map((profile) => profile.studentId));
  const records = attendance.filter((item) => item.sessionId === sessionId);
  return <>
    <PanelTitle eyebrow="حضور و غیاب صوتی" title="تشخیص صدا" description="برای هر دانشجو نمونهٔ مرجع بگیرید و سپس عبارت ثابت را برای ثبت حضور بخوانید." />
    <div className="face-layout voice-attendance-layout">
      <section className="content-card voice-session-card">
        <div className="card-heading"><div><h3>عبارت ثابت (۱۰ واژه)</h3><p>برای ثبت نمونه و حضور همین عبارت را یکسان بخوانید.</p></div><Badge tone="neutral"><Icon name="bi-mic" /> حداکثر ۶۰ ثانیه</Badge></div>
        <blockquote className="voice-phrase" dir="rtl">{PHRASE}</blockquote>
        <div className="voice-session-controls">
          <MicrophoneStatus status={micStatus} />
          <label className="form-label">درس / کلاس</label><select className="form-select" disabled={Boolean(recording) || busy} value={sessionCourse} onChange={(event) => setSessionCourse(event.target.value)}>{courses.map((course) => <option key={course.id} value={course.title}>{course.title}</option>)}</select>
          <label className="form-label" htmlFor="voice-session-date">تاریخ جلسه</label><JalaliDateInput id="voice-session-date" disabled={Boolean(recording) || busy} value={sessionDate} onChange={(next) => setSessionDate(next)} ariaLabel="تاریخ جلسه" />
          {recording === "session" ? <button className="btn btn-danger voice-record-button" onClick={() => stopRef.current?.()}><Icon name="bi-stop-circle" /> توقف ضبط · {seconds} ثانیه</button> : <button className="btn btn-primary voice-record-button" disabled={busy || micStatus === "requesting" || profiles.length === 0 || Boolean(recording)} onClick={() => startRecording()}><Icon name={micStatus === "requesting" ? "bi-hourglass-split" : "bi-mic-fill"} /> {micStatus === "requesting" ? "در انتظار دسترسی میکروفون" : "ضبط زنده و ثبت حضور"}</button>}
          {recording === "session" && <RecordingIndicator seconds={seconds} level={micLevel} />}
          <div className="settings-warning"><Icon name="bi-info-circle" /> این تطبیق آزمایشی است و برای احراز هویت قطعی مناسب نیست. صدا در فضای محلی مرورگر ذخیره می‌شود.</div>
          <p className={busy ? "voice-processing" : "voice-feedback"} role="status" aria-live="polite">{busy ? <><span className="voice-processing-spinner" /> در حال تحلیل صدا…</> : message}</p>
        </div>
      </section>
      <section className="content-card face-roster-card voice-roster-card"><div className="card-heading"><div><h3>نمونه‌های مرجع دانشجویان</h3><p>برای هر دانشجو تا سه نمونه در شرایط متفاوت نگه‌داری می‌شود.</p></div><Badge tone="neutral">{registered.size} از {students.length}</Badge></div>
        <div className="voice-student-list">{students.length ? students.map((student, index) => <article className="face-student voice-student" key={student.id}><div className="face-student-profile"><span className={`voice-avatar-halo ${registered.has(student.id) ? "is-ready" : hasStoredProfile.has(student.id) ? "is-stale" : "is-empty"}`}><StudentAvatar name={student.name} photo={student.faceImage} index={index} /></span><div><strong>{student.name}</strong><small>{student.id}</small><small>{registered.has(student.id) ? "نمونهٔ معتبر ثبت شده" : hasStoredProfile.has(student.id) ? "نمونهٔ قدیمی؛ نیازمند ضبط مجدد" : "نمونه ثبت نشده"}</small></div></div><button className="btn btn-light-outline" disabled={Boolean(recording) || busy} onClick={() => setModalTarget(student.id)}><Icon name="bi-upload" /> {registered.has(student.id) ? "افزودن نمونه" : "ثبت نمونه"}</button></article>) : <EmptyState icon="bi-people" title="دانشجویی برای ثبت نمونه نیست" text="ابتدا فهرست دانشجویان را تکمیل کنید." />}</div>
      </section>
    </div>
    <section className="content-card face-roster-card voice-session-record-card"><div className="card-heading"><div><h3>وضعیت جلسه</h3><p>حضورهای ثبت‌شده در {sessionCourse}</p></div><Badge tone="neutral">{records.length} رکورد</Badge></div>{records.length ? <div className="voice-session-records">{records.map((record) => <div key={record.id}><strong>{record.name}</strong><span>{record.status}</span><small>{record.time}</small></div>)}</div> : <p>هنوز رکوردی برای این جلسه ثبت نشده است.</p>}</section>
    {modalTarget && <div className="modal-backdrop-custom" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !recording && micStatus !== "requesting") setModalTarget(null); }}><section className="custom-modal voice-upload-modal" role="dialog" aria-modal="true" aria-labelledby="voice-modal-title"><div className="modal-head"><div><div className="eyebrow">{modalTarget === "session" ? "ثبت حضور" : "نمونهٔ مرجع دانشجو"}</div><h3 id="voice-modal-title">فایل صوتی را انتخاب کنید</h3></div><button className="icon-button" type="button" disabled={busy || Boolean(recording) || micStatus === "requesting"} aria-label="بستن" onClick={() => setModalTarget(null)}><Icon name="bi-x-lg" /></button></div><p>عبارت زیر را واضح بخوانید. فرمت‌های صوتی رایج تا ۱۵ مگابایت پذیرفته می‌شوند.</p><blockquote className="voice-phrase voice-modal-phrase" dir="rtl">{PHRASE}</blockquote><label className="voice-file-drop"><Icon name="bi-cloud-arrow-up" /><strong>انتخاب فایل صوتی</strong><small>MP3، WAV، M4A، WebM</small><input type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" disabled={busy || Boolean(recording)} onChange={(event) => { handleAudioFile(event.target.files?.[0]); event.target.value = ""; }} /></label><div className="voice-modal-divider"><span>یا ضبط مستقیم</span></div>{recording ? <><RecordingIndicator seconds={seconds} level={micLevel} className="voice-modal-indicator" /><button className="btn btn-danger w-100" onClick={() => stopRef.current?.()}><Icon name="bi-stop-circle" /> توقف و پردازش</button></> : <button className="btn btn-primary w-100" disabled={busy || micStatus === "requesting"} onClick={() => startRecording(modalTarget === "session" ? null : modalTarget)}><Icon name={micStatus === "requesting" ? "bi-hourglass-split" : "bi-mic-fill"} /> {micStatus === "requesting" ? "در انتظار دسترسی میکروفون" : "شروع ضبط میکروفون"}</button>}<div className="modal-actions"><button className="btn btn-light" disabled={busy || Boolean(recording) || micStatus === "requesting"} onClick={() => setModalTarget(null)}>انصراف</button></div>{busy && <p role="status"><span className="voice-processing-spinner" /> در حال پردازش فایل صوتی…</p>}</section></div>}
  </>;
}
