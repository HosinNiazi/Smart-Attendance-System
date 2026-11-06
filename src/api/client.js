const API_BASE = import.meta.env.VITE_API_URL || '/api';
const tokenKey = 'smart-attendance:api-token';
const userKey = 'smart-attendance:api-user';

export function getApiToken() { return sessionStorage.getItem(tokenKey) || ''; }
export function clearApiToken() { sessionStorage.removeItem(tokenKey); sessionStorage.removeItem(userKey); }
export function getApiUser() {
  try { return JSON.parse(sessionStorage.getItem(userKey) || 'null'); } catch { return null; }
}
export function setApiUser(user) {
  try { sessionStorage.setItem(userKey, JSON.stringify(user || null)); } catch { /* ignore */ }
}

export async function api(path, options = {}) {
  const token = getApiToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || 'ارتباط با سرور ناموفق بود.');
  return payload;
}

export async function signIn(email, password) {
  const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  sessionStorage.setItem(tokenKey, result.token);
  setApiUser(result.user);
  return result;
}

export function browserSnapshot() {
  const read = (key, fallback) => {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  };
  return {
    students: read('smart-attendance:students', []),
    courses: read('smart-attendance:courses', []),
    attendance: read('smart-attendance:attendance', []),
    sessionHistory: read('smart-attendance:sessions', {}),
    settings: read('smart-attendance:settings', {}),
  };
}

export function migrateBrowserSnapshot() {
  return api('/migrations/browser-snapshot', { method: 'POST', body: JSON.stringify(browserSnapshot()) });
}

export async function fetchBootstrap() {
  return api('/bootstrap');
}

/* ---- Domain helpers: every mutation goes through the API so the database is
   the single source of truth. ---- */

export function createStudent(payload) {
  return api('/students', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateStudent(studentId, payload) {
  return api(`/students/${studentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function uploadStudentPhoto(studentId, file) {
  const form = new FormData();
  form.append('photo', file);
  return api(`/students/${studentId}/photos`, { method: 'POST', body: form });
}
export function saveVoiceSample(studentId, features, featureVersion = 2) {
  return api(`/students/${studentId}/voice-samples`, { method: 'POST', body: JSON.stringify({ features, featureVersion }) });
}
export function createCourse(payload) {
  return api('/courses', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateCourse(courseId, payload) {
  return api(`/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function createSession(payload) {
  return api('/sessions', { method: 'POST', body: JSON.stringify(payload) });
}
export function finalizeSession(sessionId) {
  return api(`/sessions/${sessionId}/finalize`, { method: 'POST' });
}
export function upsertAttendance(payload) {
  return api('/attendance', { method: 'PUT', body: JSON.stringify(payload) });
}
export function saveSettingsPayload(payload) {
  return api('/settings', { method: 'PUT', body: JSON.stringify(payload) });
}
export function createRegistration(payload) {
  return api('/registrations', { method: 'POST', body: JSON.stringify(payload) });
}
export function fetchRegistrations() {
  return api('/registrations');
}
export function approveRegistration(id) {
  return api(`/registrations/${id}/approve`, { method: 'PATCH' });
}
export function rejectRegistration(id) {
  return api(`/registrations/${id}/reject`, { method: 'PATCH' });
}
