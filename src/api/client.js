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

export async function signIn(email, password, facultyId) {
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      ...(facultyId ? { facultyId } : {}),
    }),
  });
  sessionStorage.setItem(tokenKey, result.token);
  setApiUser(result.user);
  return result;
}

export function fetchFaculties() {
  return api('/faculties');
}

export async function switchFaculty(facultyId) {
  const result = await api('/auth/switch-faculty', {
    method: 'POST',
    body: JSON.stringify({ facultyId }),
  });
  sessionStorage.setItem(tokenKey, result.token);
  setApiUser(result.user);
  return result;
}

export async function changePassword(currentPassword, newPassword) {
  const result = await api('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  setApiUser(result.user);
  return result;
}

/* ---- Teacher management (faculty admin only) ---- */
export function fetchLoginHistory() {
  return api('/auth/login-history');
}

export function fetchTeachers() {
  return api('/teachers');
}
export function lookupTeacher(email) {
  return api(withQuery('/teachers/lookup', { email }));
}
export function createTeacher(payload) {
  return api('/teachers', { method: 'POST', body: JSON.stringify(payload) });
}
export function addExistingTeacher(email) {
  return api('/teachers/add-existing', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}
export function removeTeacherFromFaculty(userId) {
  return api(`/teachers/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}
export function setTeacherActive(userId, isActive) {
  return api(`/teachers/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
}
export function resetTeacherPassword(userId) {
  return api(`/teachers/${encodeURIComponent(userId)}/reset-password`, { method: 'POST' });
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
export function uploadMyPhoto(file) {
  const form = new FormData();
  form.append('photo', file);
  return api('/me/photo', { method: 'POST', body: form });
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
export function fetchFingerprintCredentials(studentId) {
  const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
  return api(`/fingerprint/credentials${query}`);
}
export function fetchMyFingerprintCredentials() {
  return api('/fingerprint/self');
}
export function startFingerprintRegistration(studentId) {
  return api('/fingerprint/credentials', { method: 'POST', body: JSON.stringify({ studentId }) });
}
export function finishFingerprintRegistration(studentId, response) {
  return api('/fingerprint/credentials/verify', { method: 'POST', body: JSON.stringify({ studentId, response }) });
}
export function startFingerprintAuthentication(sessionId) {
  return api('/fingerprint/authenticate/options', { method: 'POST', body: JSON.stringify({ sessionId }) });
}
export function finishFingerprintAuthentication(sessionId, response) {
  return api('/fingerprint/authenticate/verify', { method: 'POST', body: JSON.stringify({ sessionId, response }) });
}
export function startMyFingerprintRegistration() {
  return api('/fingerprint/self/options', { method: 'POST', body: JSON.stringify({}) });
}
export function finishMyFingerprintRegistration(response) {
  return api('/fingerprint/self/verify', { method: 'POST', body: JSON.stringify({ response }) });
}
export function fetchLeaveRequests() {
  return api('/leave-requests');
}
export function createLeaveRequest(payload, proofFile) {
  if (proofFile) {
    const form = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value != null && value !== '') form.append(key, value);
    });
    form.append('proof', proofFile);
    return api('/leave-requests', { method: 'POST', body: form });
  }
  return api('/leave-requests', { method: 'POST', body: JSON.stringify(payload) });
}
export function reviewLeaveRequest(id, payload) {
  return api(`/leave-requests/${id}/review`, { method: 'POST', body: JSON.stringify(payload) });
}
export function fetchAttendanceObjections() {
  return api('/attendance-objections');
}
export function createAttendanceObjection(payload) {
  return api('/attendance-objections', { method: 'POST', body: JSON.stringify(payload) });
}
export function reviewAttendanceObjection(id, payload) {
  return api(`/attendance-objections/${id}/review`, { method: 'POST', body: JSON.stringify(payload) });
}
export function fetchNotifications() {
  return api('/notifications');
}
export function fetchUnreadNotificationCount() {
  return api('/notifications/unread-count');
}
export function markNotificationRead(id) {
  return api(`/notifications/${id}/read`, { method: 'POST' });
}
export function markAllNotificationsRead() {
  return api('/notifications/read-all', { method: 'POST' });
}
export function importStudents(rows) {
  return api('/import/students', { method: 'POST', body: JSON.stringify({ rows }) });
}
export function importCourses(rows) {
  return api('/import/courses', { method: 'POST', body: JSON.stringify({ rows }) });
}
export function createGroupLeaveRequest(payload) {
  return api('/leave-requests/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
function withQuery(path, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
export function fetchAttendanceTrend(params) {
  return api(withQuery('/analytics/trend', params));
}
export function fetchCourseAnalytics(params) {
  return api(withQuery('/analytics/courses', params));
}
export function fetchLiveSessions(date) {
  return api(withQuery('/sessions/live', { date }));
}
export function fetchLiveSession(sessionId) {
  return api(`/sessions/${sessionId}/live`);
}
export function startLiveSession(sessionId) {
  return api(`/sessions/${sessionId}/live/start`, { method: 'POST' });
}
export function endLiveSession(sessionId) {
  return api(`/sessions/${sessionId}/live/end`, { method: 'POST' });
}
export function revokeFingerprintCredential(credentialId) {
  return api(`/fingerprint/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
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
export function createTicket(payload) {
  return api('/tickets', { method: 'POST', body: JSON.stringify(payload) });
}
export function fetchTickets() {
  return api('/tickets');
}
export function respondTicket(id, payload) {
  return api(`/tickets/${id}/respond`, { method: 'POST', body: JSON.stringify(payload) });
}
export function closeTicket(id) {
  return api(`/tickets/${id}/close`, { method: 'POST' });
}
