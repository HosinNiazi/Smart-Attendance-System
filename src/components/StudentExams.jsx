import React, { useEffect, useMemo, useRef, useState } from "react";
import { Badge, EmptyState, Icon, PanelTitle } from "./shared.jsx";
import {
  fetchExamAttempt,
  fetchMyExams,
  saveExamAnswers,
  startExam,
  submitExam,
} from "../api/client.js";

const faNumber = (value) =>
  Number(value || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

const VISIBILITY_LABELS = {
  immediate: "نتیجه بلافاصله پس از ثبت نمایش داده می‌شود.",
  after_close: "نتیجه پس از پایان بازهٔ آزمون نمایش داده می‌شود.",
  hidden: "نتیجه توسط استاد اعلام می‌شود.",
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${faNumber(minutes).padStart(2, "۰")}:${String(remainder).padStart(2, "0").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])}`;
}

function examWindowInfo(exam, now) {
  const from = new Date(exam.availableFrom).getTime();
  const until = new Date(exam.availableUntil).getTime();
  if (now < from) return { label: "شروع نشده", tone: "info", icon: "bi-hourglass-split" };
  if (now >= until) return { label: "پایان یافته", tone: "neutral", icon: "bi-lock" };
  return { label: "قابل شروع", tone: "success", icon: "bi-broadcast" };
}

function StudentResultView({ result, exam, title, onExit }) {
  const visible = result.scoreVisible;
  return (
    <div className="student-exam-result">
      <div className={`student-exam-result-icon ${visible ? "success" : "info"}`}>
        <Icon name={visible ? "bi-check2-circle" : "bi-hourglass-split"} />
      </div>
      <h2>{title || "نتیجهٔ آزمون"}</h2>
      <p>{result.exam?.title || exam?.title}</p>
      {visible ? (
        <>
          <div className="student-exam-score-grid">
            <div><span>درصد</span><strong>{faNumber(result.attempt.percent)}٪</strong></div>
            <div><span>نمره از ۲۰</span><strong>{faNumber(result.attempt.scoreOutOf20)}</strong></div>
            <div><span>پاسخ صحیح</span><strong>{faNumber(result.attempt.correctCount)}</strong></div>
            <div><span>نتیجه</span><strong>{result.attempt.passed ? "قبول" : "مردود"}</strong></div>
          </div>
          <div className="student-exam-review">
            {(result.questions || []).map((question, index) => (
              <article key={question.id}>
                <div className="student-exam-review-head">
                  <strong>{faNumber(index + 1)}. {question.prompt}</strong>
                  <Badge tone={
                    question.selectedOptionId == null ? "neutral"
                    : question.options.find((option) => option.id === question.selectedOptionId)?.isCorrect ? "success"
                    : "danger"
                  }>
                    {question.selectedOptionId == null
                      ? "بی‌پاسخ"
                      : question.options.find((option) => option.id === question.selectedOptionId)?.isCorrect
                        ? "صحیح"
                        : "غلط"}
                  </Badge>
                </div>
                <div className="student-exam-review-options">
                  {question.options.map((option) => (
                    <span
                      key={option.id}
                      className={`${option.isCorrect ? "is-correct" : ""} ${question.selectedOptionId === option.id ? "is-selected" : ""}`}
                    >
                      {option.text}
                      {option.isCorrect && <Icon name="bi-check-lg" />}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="student-exam-hidden-note">
          <Icon name="bi-eye-slash" />
          <span>{VISIBILITY_LABELS[result.exam?.resultsVisibility || exam?.resultsVisibility] || "نتیجه بعداً اعلام می‌شود."}</span>
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={onExit}>
        <Icon name="bi-arrow-right" /> بازگشت به فهرست آزمون‌ها
      </button>
    </div>
  );
}

function StudentRunner({ initial, onExit, notify }) {
  const [data, setData] = useState(initial);
  const [answers, setAnswers] = useState(() => {
    const map = {};
    for (const answer of initial.answers || []) {
      if (answer.selectedOptionId) map[answer.questionId] = answer.selectedOptionId;
    }
    return map;
  });
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(
    () => (new Date(initial.attempt.expiresAt).getTime() - Date.now()) / 1000,
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const tabSwitchesRef = useRef(0);
  const fullscreenExitsRef = useRef(0);
  const answersRef = useRef(answers);
  const submittedRef = useRef(false);
  const dirtyRef = useRef(false);

  answersRef.current = answers;
  const questions = data.questions || [];
  const attempt = data.attempt;
  const exam = data.exam;
  const currentQuestion = questions[current];

  const answerPayload = () =>
    questions.map((question) => ({
      questionId: question.id,
      selectedOptionId: answersRef.current[question.id] || null,
    }));

  async function autoSave() {
    if (submittedRef.current) return;
    setSaving(true);
    try {
      await saveExamAnswers(attempt.id, answerPayload(), {
        tabSwitches: tabSwitchesRef.current,
        fullscreenExits: fullscreenExitsRef.current,
      });
      setSavedAt(new Date().toISOString());
    } catch (saveError) {
      setError(saveError.message || "ذخیرهٔ خودکار پاسخ‌ها انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    answersRef.current = answers;
    dirtyRef.current = true;
    const timer = setTimeout(() => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        autoSave();
      }
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = (new Date(attempt.expiresAt).getTime() - Date.now()) / 1000;
      setRemaining(next);
      if (next <= 0) {
        clearInterval(timer);
        finish(true);
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt.expiresAt]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden" && !submittedRef.current) {
        tabSwitchesRef.current += 1;
      }
    }
    function onFullscreenChange() {
      if (!document.fullscreenElement && !submittedRef.current) {
        fullscreenExitsRef.current += 1;
      }
    }
    function onBeforeUnload(event) {
      if (submittedRef.current) return undefined;
      event.preventDefault();
      event.returnValue = "";
      return "";
    }
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  async function finish(auto = false) {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const payload = await submitExam(attempt.id, answerPayload(), {
        tabSwitches: tabSwitchesRef.current,
        fullscreenExits: fullscreenExitsRef.current,
      });
      setResult(payload);
    } catch (submitError) {
      submittedRef.current = false;
      setError(submitError.message || "ثبت نهایی آزمون انجام نشد.");
      if (auto) setTimeout(() => finish(true), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  function confirmSubmit() {
    const unanswered = questions.length - Object.keys(answers).length;
    const message = unanswered
      ? `${faNumber(unanswered)} سوال بدون پاسخ است. با این حال آزمون ثبت شود؟`
      : "پاسخ‌های خود را نهایی می‌کنید؟ پس از ثبت امکان تغییر نیست.";
    if (!window.confirm(message)) return;
    finish(false);
  }

  if (result) {
    return (
      <StudentResultView
        result={result}
        exam={exam}
        title="آزمون شما ثبت شد"
        onExit={onExit}
      />
    );
  }

  const danger = remaining <= 120;

  return (
    <div className="student-exam-runner">
      <header className="student-exam-runner-head">
        <div>
          <div className="eyebrow">در حال پاسخ‌دهی</div>
          <h2>{exam.title}</h2>
          <p>{exam.courseTitle} {exam.courseCode ? `(${exam.courseCode})` : ""}</p>
        </div>
        <div className={`student-exam-timer ${danger ? "is-danger" : ""}`}>
          <Icon name="bi-stopwatch" />
          <div>
            <span>زمان باقی‌مانده</span>
            <strong>{formatDuration(remaining)}</strong>
          </div>
        </div>
      </header>

      <div className="student-exam-status-bar">
        <span className={`exam-save-state ${saving ? "is-saving" : savedAt ? "is-saved" : ""}`}>
          <Icon name={saving ? "bi-arrow-repeat" : savedAt ? "bi-cloud-check" : "bi-cloud"} />
          {saving ? "در حال ذخیره…" : savedAt ? `ذخیره شد • ${formatDateTime(savedAt)}` : "پاسخ‌ها به‌صورت خودکار ذخیره می‌شوند"}
        </span>
        <span><Icon name="bi-list-ol" /> {faNumber(Object.keys(answers).length)} از {faNumber(questions.length)} پاسخ داده شده</span>
      </div>

      {error && <div className="exam-form-error" role="alert"><Icon name="bi-exclamation-triangle" /> {error}</div>}

      <div className="student-exam-runner-grid">
        <section className="student-exam-question-card">
          {currentQuestion && (
            <>
              <div className="student-exam-question-head">
                <span>سوال {faNumber(current + 1)} از {faNumber(questions.length)}</span>
                <span className="exam-points-chip">بارم {faNumber(currentQuestion.points)}</span>
              </div>
              <h3>{currentQuestion.prompt}</h3>
              <div className="student-exam-options">
                {currentQuestion.options.map((option, optionIndex) => {
                  const selected = answers[currentQuestion.id] === option.id;
                  return (
                    <label key={option.id} className={`student-exam-option ${selected ? "is-selected" : ""}`}>
                      <input
                        type="radio"
                        name={`question-${currentQuestion.id}`}
                        checked={selected}
                        onChange={() =>
                          setAnswers((currentAnswers) => ({
                            ...currentAnswers,
                            [currentQuestion.id]: option.id,
                          }))
                        }
                      />
                      <span className="student-exam-option-letter">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span className="student-exam-option-text">{option.text}</span>
                      <Icon name={selected ? "bi-check-circle-fill" : "bi-circle"} />
                    </label>
                  );
                })}
              </div>
              <div className="student-exam-question-nav">
                <button
                  type="button"
                  className="btn btn-light"
                  disabled={current === 0}
                  onClick={() => setCurrent((index) => Math.max(0, index - 1))}
                >
                  <Icon name="bi-arrow-right" /> قبلی
                </button>
                <button
                  type="button"
                  className="btn btn-light"
                  onClick={() => {
                    setAnswers((currentAnswers) => {
                      const next = { ...currentAnswers };
                      delete next[currentQuestion.id];
                      return next;
                    });
                  }}
                >
                  <Icon name="bi-eraser" /> پاک کردن پاسخ
                </button>
                {current < questions.length - 1 ? (
                  <button type="button" className="btn btn-primary" onClick={() => setCurrent((index) => Math.min(questions.length - 1, index + 1))}>
                    بعدی <Icon name="bi-arrow-left" />
                  </button>
                ) : (
                  <button type="button" className="btn btn-success" onClick={confirmSubmit} disabled={submitting}>
                    <Icon name="bi-check2-all" /> ثبت نهایی آزمون
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="student-exam-palette">
          <h4><Icon name="bi-grid-3x3-gap" /> نقشهٔ سوالات</h4>
          <div className="student-exam-palette-grid">
            {questions.map((question, index) => {
              const answered = Boolean(answers[question.id]);
              return (
                <button
                  key={question.id}
                  type="button"
                  className={`${index === current ? "is-current" : ""} ${answered ? "is-answered" : ""}`}
                  onClick={() => setCurrent(index)}
                  aria-label={`سوال ${index + 1}${answered ? " پاسخ داده شده" : " بی‌پاسخ"}`}
                >
                  {faNumber(index + 1)}
                </button>
              );
            })}
          </div>
          <div className="student-exam-palette-legend">
            <span><i className="answered" /> پاسخ داده شده</span>
            <span><i className="current" /> سوال جاری</span>
          </div>
          <button type="button" className="btn btn-primary student-exam-submit-all" onClick={confirmSubmit} disabled={submitting}>
            <Icon name={submitting ? "bi-hourglass-split" : "bi-send-check"} />
            {submitting ? "در حال ثبت…" : "ثبت نهایی آزمون"}
          </button>
          <p className="student-exam-note">
            <Icon name="bi-shield-check" /> با ثبت نهایی، پاسخ‌های ذخیره‌شده به‌صورت رسمی نمره‌دهی می‌شوند.
          </p>
        </aside>
      </div>
    </div>
  );
}

export function StudentExams({ notify }) {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState("");
  const [runner, setRunner] = useState(null);
  const [resultView, setResultView] = useState(null);
  const [filter, setFilter] = useState("available");
  const [now, setNow] = useState(Date.now());

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMyExams();
      setExams(data.exams || []);
    } catch (loadError) {
      setError(loadError.message || "دریافت آزمون‌ها انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const groups = useMemo(() => {
    const available = [];
    const upcoming = [];
    const finished = [];
    for (const exam of exams) {
      if (exam.attemptStatus === "in_progress" && exam.canResume) available.push(exam);
      else if (exam.canStart) available.push(exam);
      else if (exam.status === "published" && new Date(exam.availableFrom).getTime() > now) upcoming.push(exam);
      else finished.push(exam);
    }
    return { available, upcoming, finished };
  }, [exams, now]);

  async function begin(exam) {
    setStartingId(exam.id);
    setError("");
    try {
      const payload = await startExam(exam.id);
      setRunner(payload);
    } catch (startError) {
      setError(startError.message || "شروع آزمون انجام نشد.");
      await load();
    } finally {
      setStartingId("");
    }
  }

  async function resume(exam) {
    setStartingId(exam.id);
    setError("");
    try {
      const payload = await startExam(exam.id);
      setRunner(payload);
    } catch (resumeError) {
      try {
        const payload = await fetchExamAttempt(exam.attemptId);
        if (payload.attempt?.status === "in_progress") setRunner(payload);
        else if (payload.attempt?.status) setResultView(payload);
        else {
          setError(resumeError.message || "ادامهٔ آزمون امکان‌پذیر نیست.");
          await load();
        }
      } catch (fallbackError) {
        setError(fallbackError.message || "ادامهٔ آزمون امکان‌پذیر نیست.");
      }
    } finally {
      setStartingId("");
    }
  }

  async function openAttempt(exam) {
    if (!exam.attemptId) return;
    setStartingId(exam.id);
    setError("");
    try {
      const payload = await fetchExamAttempt(exam.attemptId);
      if (payload.attempt?.status === "in_progress") setRunner(payload);
      else setResultView(payload);
    } catch (attemptError) {
      setError(attemptError.message || "دریافت برگهٔ آزمون انجام نشد.");
    } finally {
      setStartingId("");
    }
  }

  if (runner) {
    return (
      <section className="student-exams-page">
        <StudentRunner
          initial={runner}
          notify={notify}
          onExit={() => {
            setRunner(null);
            load();
          }}
        />
      </section>
    );
  }

  if (resultView) {
    return (
      <section className="student-exams-page">
        <StudentResultView
          result={resultView}
          exam={resultView.exam}
          title="نتیجهٔ آزمون"
          onExit={() => {
            setResultView(null);
            load();
          }}
        />
      </section>
    );
  }

  const currentGroup =
    filter === "available" ? groups.available
    : filter === "upcoming" ? groups.upcoming
    : groups.finished;

  return (
    <section className="student-exams-page">
      <PanelTitle
        eyebrow="آزمون آنلاین"
        title="آزمون‌های من"
        description="آزمون‌های درس‌های خود را در بازهٔ تعیین‌شده شروع کنید؛ پاسخ‌ها خودکار ذخیره می‌شوند."
        action={
          <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
            <Icon name="bi-arrow-clockwise" /> به‌روزرسانی
          </button>
        }
      />

      <div className="student-exam-tabs">
        <button type="button" className={filter === "available" ? "active" : ""} onClick={() => setFilter("available")}>
          <Icon name="bi-play-circle" /> قابل شرکت
          <span>{faNumber(groups.available.length)}</span>
        </button>
        <button type="button" className={filter === "upcoming" ? "active" : ""} onClick={() => setFilter("upcoming")}>
          <Icon name="bi-hourglass-split" /> در انتظار شروع
          <span>{faNumber(groups.upcoming.length)}</span>
        </button>
        <button type="button" className={filter === "finished" ? "active" : ""} onClick={() => setFilter("finished")}>
          <Icon name="bi-archive" /> گذشته
          <span>{faNumber(groups.finished.length)}</span>
        </button>
      </div>

      {error && <div className="exam-form-error" role="alert"><Icon name="bi-exclamation-triangle" /> {error}</div>}

      {loading ? (
        <div className="exam-loading"><span className="exam-spinner" /> در حال دریافت آزمون‌ها…</div>
      ) : currentGroup.length ? (
        <div className="student-exam-list">
          {currentGroup.map((exam) => {
            const windowInfo = examWindowInfo(exam, now);
            const visible = exam.scoreVisible;
            const inProgress = exam.attemptStatus === "in_progress" && exam.canResume;
            const submitted = ["submitted", "expired"].includes(exam.attemptStatus);
            return (
              <article className="student-exam-card" key={exam.id}>
                <div className="student-exam-card-head">
                  <div className={`student-exam-card-icon ${windowInfo.tone}`}>
                    <Icon name={inProgress ? "bi-pencil-square" : windowInfo.icon} />
                  </div>
                  <div className="student-exam-card-copy">
                    <div className="student-exam-card-title">
                      <h3>{exam.title}</h3>
                      <Badge tone={inProgress ? "warning" : windowInfo.tone}>
                        {inProgress ? "در حال پاسخ‌دهی" : submitted ? "ثبت شده" : windowInfo.label}
                      </Badge>
                    </div>
                    <p>{exam.courseTitle} {exam.courseCode ? `(${exam.courseCode})` : ""} • {exam.teacherName || "—"}</p>
                    {exam.description && <p className="student-exam-description">{exam.description}</p>}
                  </div>
                </div>
                <div className="student-exam-info-grid">
                  <div><span><Icon name="bi-calendar-event" /> شروع</span><strong>{formatDateTime(exam.availableFrom)}</strong></div>
                  <div><span><Icon name="bi-calendar-check" /> پایان</span><strong>{formatDateTime(exam.availableUntil)}</strong></div>
                  <div><span><Icon name="bi-clock" /> مدت</span><strong>{faNumber(exam.durationMinutes)} دقیقه</strong></div>
                  <div><span><Icon name="bi-question-circle" /> سوالات</span><strong>{faNumber(exam.questionCount)} سوال</strong></div>
                </div>
                {visible && submitted && (
                  <div className="student-exam-final-score">
                    <div><span>درصد</span><strong>{exam.percent == null ? "—" : `${faNumber(exam.percent)}٪`}</strong></div>
                    <div><span>نمره از ۲۰</span><strong>{exam.scoreOutOf20 == null ? "—" : faNumber(exam.scoreOutOf20)}</strong></div>
                    <div><span>نتیجه</span><strong>{exam.passed == null ? "—" : exam.passed ? "قبول" : "مردود"}</strong></div>
                  </div>
                )}
                {!visible && submitted && (
                  <p className="student-exam-note"><Icon name="bi-eye-slash" /> {VISIBILITY_LABELS[exam.resultsVisibility] || "نتیجه بعداً اعلام می‌شود."}</p>
                )}
                {visible && exam.attemptId && !submitted && exam.attemptStatus === "expired" && (
                  <p className="student-exam-note"><Icon name="bi-info-circle" /> زمان آزمون به پایان رسیده و برگهٔ شما ثبت شده است.</p>
                )}
                <div className="student-exam-card-actions">
                  {inProgress ? (
                    <button type="button" className="btn btn-warning" onClick={() => resume(exam)} disabled={startingId === exam.id}>
                      <Icon name="bi-arrow-repeat" /> {startingId === exam.id ? "در حال بارگذاری…" : "ادامهٔ آزمون"}
                    </button>
                  ) : exam.canStart ? (
                    <button type="button" className="btn btn-primary" onClick={() => begin(exam)} disabled={startingId === exam.id}>
                      <Icon name="bi-play-fill" /> {startingId === exam.id ? "در حال شروع…" : "شروع آزمون"}
                    </button>
                  ) : submitted ? (
                    <button
                      type="button"
                      className="btn btn-light"
                      disabled={!exam.attemptId || startingId === exam.id}
                      onClick={() => openAttempt(exam)}
                    >
                      <Icon name="bi-file-earmark-text" /> مشاهدهٔ برگه
                    </button>
                  ) : (
                    <span className="student-exam-note"><Icon name="bi-lock" /> خارج از بازهٔ مجاز آزمون</span>
                  )}
                  <span className="student-exam-visibility">
                    <Icon name="bi-shield-lock" /> {VISIBILITY_LABELS[exam.resultsVisibility] || ""}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="content-card">
          <EmptyState
            icon="bi-journal-x"
            title="آزمونی در این بخش نیست"
            description="با انتشار آزمون توسط استاد، آزمون در این بخش نمایش داده می‌شود."
          />
        </div>
      )}
    </section>
  );
}

export default StudentExams;
