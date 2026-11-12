const STATUS_TO_FA = {
  unmarked: "ثبت‌نشده",
  present: "حاضر",
  late: "تأخیر",
  absent: "غایب",
  excused: "غیبت موجه",
  left_early: "خروج زودهنگام",
};

const STATUS_TO_EN = Object.fromEntries(
  Object.entries(STATUS_TO_FA).map(([key, value]) => [value, key]),
);

const WEEKDAYS = {
  saturday: "شنبه",
  sunday: "یکشنبه",
  monday: "دوشنبه",
  tuesday: "سه‌شنبه",
  wednesday: "چهارشنبه",
  thursday: "پنجشنبه",
  friday: "جمعه",
};

function formatCourseTime(course) {
  if (!course.weekday) return "زمان تعیین نشده";

  const day = WEEKDAYS[String(course.weekday).toLowerCase()] || course.weekday;
  const start = course.startTime || "--:--";
  const end = course.endTime || "--:--";

  return `${day}، ${start} تا ${end}`;
}

function toFaStatus(status) {
  return STATUS_TO_FA[status] || status || "ثبت‌نشده";
}

function toEnStatus(status) {
  return STATUS_TO_EN[status] || status || "unmarked";
}

function photoUrl(objectKey) {
  return `/uploads/students/${objectKey}`;
}

export function adaptBootstrap(data) {
  const photosByStudent = new Map();
  for (const image of data.faceImages || []) {
    const list = photosByStudent.get(image.studentId) || [];
    list.push(photoUrl(image.objectKey));
    photosByStudent.set(image.studentId, list);
  }

  const students = (data.students || []).map((student) => {
    const faceImages = photosByStudent.get(student.id) || [];
    return {
      id: String(student.studentNumber),
      name: student.fullName,
      major: student.major || "",
      term: student.term || "",
      phone: student.phone || "",
      status: student.status === "inactive" ? "غیرفعال" : "فعال",
      databaseId: student.id,
      faceImages,
      faceImage: faceImages[0] || "",
    };
  });

  const studentByDatabaseId = new Map(
    students.map((student) => [student.databaseId, student.id]),
  );

  const courses = (data.courses || []).map((course) => ({
    id: course.code,
    title: course.title,
    teacher: course.teacherName || "",
    teacherUserId: course.teacherUserId || "",
    weekday: course.weekday || "",
    startTime: course.startTime || "",
    endTime: course.endTime || "",
    time: formatCourseTime(course),
    room: course.room || "",
    studentIds: (course.studentIds || [])
      .map((id) => studentByDatabaseId.get(id))
      .filter(Boolean),
    count: (course.studentIds || []).length,
    databaseId: course.id,
  }));

  const courseByDatabaseId = new Map(
    courses.map((course) => [course.databaseId, course]),
  );

  const sessions = {};
  const sessionByDatabaseId = new Map();

  for (const session of data.sessions || []) {
    const course = courseByDatabaseId.get(session.courseId);
    if (!course) continue;

    const date =
      typeof session.date === "string"
        ? session.date.slice(0, 10)
        : new Date(session.date).toISOString().slice(0, 10);

    const key = `${course.title}::${date}`;

    sessions[key] = {
      id: key,
      course: course.title,
      date,
      teacher: session.teacherName || course.teacher,
      startTime: session.startTime,
      endTime: session.endTime,
      graceMinutes: session.graceMinutes,
      openBeforeMinutes: session.openBeforeMinutes,
      closeAfterMinutes: session.closeAfterMinutes,
      started: session.status === "started" || session.status === "finalized",
      finalized: session.status === "finalized",
      cancelled: session.status === "cancelled",
      status: session.status,
      liveStatus: session.liveStatus || "scheduled",
      startedAt: session.startedAt || null,
      endedAt: session.endedAt || null,
      studentIds: (session.studentIds || [])
        .map((id) => studentByDatabaseId.get(id))
        .filter(Boolean),
      databaseId: session.id,
    };

    sessionByDatabaseId.set(session.id, key);
  }

  const attendance = (data.attendance || [])
    .map((record) => {
      const studentId = studentByDatabaseId.get(record.studentId);
      const sessionId = sessionByDatabaseId.get(record.sessionId);
      const student = students.find((item) => item.id === studentId);
      const session = sessions[sessionId];

      return {
        id: studentId || "",
        name: student?.name || "",
        course: session?.course || "",
        sessionId: sessionId || "",
        sessionDate: session?.date || "",
        time: record.checkedAt
          ? new Intl.DateTimeFormat("fa-IR", {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(record.checkedAt))
          : "—",
        status: toFaStatus(record.status),
        method: record.method || "manual",
        history: [],
        databaseId: record.id,
        databaseSessionId: record.sessionId,
      };
    })
    .filter((record) => record.id && record.sessionId);

  // Voice profiles are grouped back into the shape VoiceAttendance expects.
  const voiceProfilesByStudent = new Map();
  for (const sample of data.voiceSamples || []) {
    const frontendId = studentByDatabaseId.get(sample.studentId);
    if (!frontendId || !Array.isArray(sample.features)) continue;
    const profile = voiceProfilesByStudent.get(frontendId) || {
      studentId: frontendId,
      samples: [],
    };
    profile.samples.push({
      features: sample.features,
      featureVersion: Number(sample.featureVersion) || 2,
      savedAt: sample.createdAt ? new Date(sample.createdAt).getTime() : Date.now(),
    });
    voiceProfilesByStudent.set(frontendId, profile);
  }
  const voiceProfiles = [...voiceProfilesByStudent.values()].map((profile) => ({
    ...profile,
    samples: profile.samples.slice(-3),
    features: profile.samples.at(-1)?.features,
    featureVersion: profile.samples.at(-1)?.featureVersion,
  }));

  const settings = data.settings
    ? {
        name: data.settings.systemName || "حضوربان",
        lateAfter: String(data.settings.lateAfterMinutes ?? 10),
        notifications: data.settings.notificationsEnabled !== false,
        faceRecognition: data.settings.faceRecognitionEnabled !== false,
      }
    : null;

  return { students, courses, attendance, sessionHistory: sessions, settings, voiceProfiles };
}

export { toFaStatus, toEnStatus };
