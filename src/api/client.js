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

export async function signIn(identifier, password, facultyId) {
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      identifier,
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
export function fetchAdminActivity(entityType) {
  const qs = entityType ? `?entityType=${encodeURIComponent(entityType)}` : '';
  return api(`/admin/activity${qs}`);
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
// Creating a student also creates their login (username = student number) and
// returns a one-time temporary password that must be changed at first sign-in.
export function provisionStudentAccount(studentId) {
  return api(`/students/${studentId}/account`, { method: 'POST' });
}
export function resetStudentPassword(studentId) {
  return api(`/students/${studentId}/reset-password`, { method: 'POST' });
}
export function provisionMissingStudentAccounts(courseId) {
  return api('/students/provision-missing', {
    method: 'POST',
    body: JSON.stringify(courseId ? { courseId } : {}),
  });
}
export function uploadStudentPhoto(studentId, file, face = null, mode = 'append') {
  const form = new FormData();
  form.append('photo', file);
  if (face?.descriptor) form.append('descriptor', JSON.stringify(face.descriptor));
  if (face?.quality) form.append('quality', JSON.stringify(face.quality));
  if (mode) form.append('mode', mode);
  return api(`/students/${studentId}/photos`, { method: 'POST', body: form });
}
export function uploadMyPhoto(file, face = null) {
  const form = new FormData();
  form.append('photo', file);
  if (face?.descriptor) form.append('descriptor', JSON.stringify(face.descriptor));
  if (face?.quality) form.append('quality', JSON.stringify(face.quality));
  form.append('mode', 'replace');
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
export function fetchFaceEvents(params = {}) {
  const qs = new URLSearchParams();
  if (params.sessionId) qs.set('sessionId', params.sessionId);
  if (params.studentId) qs.set('studentId', params.studentId);
  if (params.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return api(`/face-recognition/events${query ? `?${query}` : ''}`);
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
// ---- exams (teacher / admin) ----
export function fetchExams(params = {}) {
  return api(withQuery('/exams', params));
}
export function fetchExamDetail(id) {
  return api(`/exams/${id}`);
}
export function createExam(payload) {
  return api('/exams', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateExam(id, payload) {
  return api(`/exams/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export function patchExamSchedule(id, payload) {
  return api(`/exams/${id}/schedule`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function publishExam(id) {
  return api(`/exams/${id}/publish`, { method: 'POST' });
}
export function closeExam(id) {
  return api(`/exams/${id}/close`, { method: 'POST' });
}
export function cancelExam(id) {
  return api(`/exams/${id}/cancel`, { method: 'POST' });
}
export function deleteExam(id) {
  return api(`/exams/${id}`, { method: 'DELETE' });
}
export function fetchExamResults(id) {
  return api(`/exams/${id}/results`);
}
export function fetchExamAttemptDetail(examId, attemptId) {
  return api(`/exams/${examId}/attempts/${attemptId}`);
}
export function voidExamAttempt(examId, attemptId, reason) {
  return api(`/exams/${examId}/attempts/${attemptId}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
export function grantExamAccommodation(examId, studentId, payload) {
  return api(`/exams/${examId}/students/${studentId}/accommodation`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
export function fetchExamAnalysis(examId) {
  return api(`/exams/${examId}/analysis`);
}
export function fetchExamReports(examId) {
  return api(`/exams/${examId}/reports`);
}
// ---- exams (student) ----
export function fetchMyExams() {
  return api('/exams/mine');
}
export function startExam(id) {
  return api(`/exams/${id}/start`, { method: 'POST' });
}
export function saveExamAnswers(attemptId, answers, integrity) {
  return api(`/exams/attempts/${attemptId}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ answers, integrity }),
  });
}
export function submitExam(attemptId, answers, integrity) {
  return api(`/exams/attempts/${attemptId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers, integrity }),
  });
}
export function fetchExamAttempt(attemptId) {
  return api(`/exams/attempts/${attemptId}`);
}
export function reportExamQuestion(attemptId, payload) {
  return api(`/exams/attempts/${attemptId}/report`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---- platform (super admin) ----
// The control-plane token lives in its own storage key so "entering" a faculty
// never destroys the platform session. The impersonation token replaces the
// regular API token for the duration of the visit.
const platformTokenKey = 'smart-attendance:platform-token';
const platformUserKey = 'smart-attendance:platform-user';
const impersonationKey = 'smart-attendance:impersonation';

export function getPlatformToken() {
  return sessionStorage.getItem(platformTokenKey) || '';
}
export function getPlatformUser() {
  try {
    return JSON.parse(sessionStorage.getItem(platformUserKey) || 'null');
  } catch {
    return null;
  }
}
export function setPlatformSession(token, user) {
  sessionStorage.setItem(platformTokenKey, token);
  sessionStorage.setItem(platformUserKey, JSON.stringify(user || null));
}
export function clearPlatformSession() {
  sessionStorage.removeItem(platformTokenKey);
  sessionStorage.removeItem(platformUserKey);
}
export function getImpersonation() {
  try {
    return JSON.parse(sessionStorage.getItem(impersonationKey) || 'null');
  } catch {
    return null;
  }
}
export function setImpersonation(value) {
  if (!value) sessionStorage.removeItem(impersonationKey);
  else sessionStorage.setItem(impersonationKey, JSON.stringify(value));
}
export function clearImpersonation() {
  sessionStorage.removeItem(impersonationKey);
}

async function platformApi(path, options = {}) {
  const token = getPlatformToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(payload?.message || 'درخواست پنل سامانه انجام نشد.');
  return payload;
}

export async function platformSignIn(identifier, password) {
  const result = await platformApi('/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
  setPlatformSession(result.token, result.user);
  return result;
}
export function platformChangePassword(currentPassword, newPassword) {
  return platformApi('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
export function fetchPlatformOverview() {
  return platformApi('/platform/overview');
}
export function fetchPlatformFaculties() {
  return platformApi('/platform/faculties');
}
export function createPlatformFaculty(payload) {
  return platformApi('/platform/faculties', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
export function fetchPlatformFaculty(facultyId) {
  return platformApi(`/platform/faculties/${facultyId}`);
}
export function updatePlatformFaculty(facultyId, payload) {
  return platformApi(`/platform/faculties/${facultyId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
export function archivePlatformFaculty(facultyId) {
  return platformApi(`/platform/faculties/${facultyId}/archive`, {
    method: 'POST',
  });
}
export function createFacultyAdmin(facultyId, payload) {
  return platformApi(`/platform/faculties/${facultyId}/admin`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
export function updateFacultyAdmin(facultyId, userId, payload) {
  return platformApi(`/platform/faculties/${facultyId}/admins/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
export function resetFacultyAdminPassword(facultyId, userId) {
  return platformApi(
    `/platform/faculties/${facultyId}/admins/${userId}/reset-password`,
    { method: 'POST' },
  );
}
export async function enterFaculty(facultyId, reason) {
  const result = await platformApi(`/platform/faculties/${facultyId}/enter`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  sessionStorage.setItem(tokenKey, result.token);
  setApiUser(result.user);
  setImpersonation(result.impersonation);
  return result;
}
export async function exitImpersonation() {
  const result = await api('/auth/exit-impersonation', { method: 'POST' });
  clearApiToken();
  clearImpersonation();
  return result;
}
export function fetchPlatformImpersonations() {
  return platformApi('/platform/impersonations');
}
export function revokeImpersonation(sessionId) {
  return platformApi(`/platform/impersonations/${sessionId}`, {
    method: 'DELETE',
  });
}
export function fetchPlatformAdmins() {
  return platformApi('/platform/admins');
}
export function createPlatformAdmin(payload) {
  return platformApi('/platform/admins', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
export function updatePlatformAdmin(userId, payload) {
  return platformApi(`/platform/admins/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
export function resetPlatformAdminPassword(userId) {
  return platformApi(`/platform/admins/${userId}/reset-password`, {
    method: 'POST',
  });
}
export function fetchPlatformAudit(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value);
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return platformApi(`/platform/audit${suffix}`);
}


