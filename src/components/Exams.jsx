import React, { useEffect, useMemo, useState } from "react";
import { Badge, EmptyState, Icon, PanelTitle, StatCard } from "./shared.jsx";
import { JalaliDateInput } from "./JalaliDateInput.jsx";
import {
  cancelExam,
  closeExam,
  createExam,
  deleteExam,
  fetchExamAnalysis,
  fetchExamAttemptDetail,
  fetchExamDetail,
  fetchExamReports,
  fetchExamResults,
  fetchExams,
  grantExamAccommodation,
  publishExam,
  updateExam,
  voidExamAttempt,
} from "../api/client.js";

const STATUS_META = {
  draft: { label: "پیش‌نویس", tone: "neutral", icon: "bi-pencil-square" },
  upcoming: { label: "در انتظار شروع", tone: "info", icon: "bi-hourglass-split" },
  open: { label: "در حال برگزاری", tone: "success", icon: "bi-broadcast" },
  closed: { label: "بسته شده", tone: "neutral", icon: "bi-lock" },
  cancelled: { label: "لغو شده", tone: "danger", icon: "bi-x-circle" },
};

const VISIBILITY_LABELS = {
  immediate: "بلافاصله پس از ثبت",
  after_close: "پس از پایان بازهٔ آزمون",
  hidden: "نمایش داده نشود",
};

const ATTEMPT_STATUS_LABELS = {
  in_progress: "در حال پاسخ‌دهی",
  submitted: "ثبت شده",
  expired: "به پایان رسیده",
  voided: "ابطال شده",
};

// Attempts whose tab-switch counter reaches this threshold are highlighted
// for teacher review. Not an automatic penalty — just a signal.
const SUSPECT_TAB_SWITCHES = 3;

const faNumber = (value) =>
  Number(value || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function splitLocalIso(value) {
  const date = value ? new Date(value) : new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function combineLocal(date, time) {
  if (!date || !time) return "";
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function buildEmptyOption() {
  return { text: "", isCorrect: false };
}

function buildEmptyQuestion() {
  return {
    prompt: "",
    points: 1,
    options: [buildEmptyOption(), buildEmptyOption(), buildEmptyOption()],
  };
}

function defaultForm(courses) {
  const start = new Date(Date.now() + 60 * 60_000);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  const startParts = splitLocalIso(start.toISOString());
  const endParts = splitLocalIso(end.toISOString());
  return {
    courseId: courses[0]?.databaseId || "",
    title: "",
    description: "",
    startDate: startParts.date,
    startTime: startParts.time,
    endDate: endParts.date,
    endTime: endParts.time,
    durationMinutes: 30,
    passPercent: 50,
    maxAttempts: 1,
    resultsVisibility: "after_close",
    shuffleQuestions: true,
    shuffleOptions: true,
    questions: [buildEmptyQuestion()],
  };
}

function formFromExam(exam, questions) {
  const start = splitLocalIso(exam.availableFrom);
  const end = splitLocalIso(exam.availableUntil);
  return {
    courseId: exam.courseId,
    title: exam.title || "",
    description: exam.description || "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    durationMinutes: exam.durationMinutes || 30,
    passPercent: exam.passPercent ?? 50,
    maxAttempts: exam.maxAttempts || 1,
    resultsVisibility: exam.resultsVisibility || "after_close",
    shuffleQuestions: exam.shuffleQuestions !== false,
    shuffleOptions: exam.shuffleOptions !== false,
    questions: questions?.length
      ? questions.map((question) => ({
          prompt: question.prompt,
          points: Number(question.points) || 1,
          options: (question.options || []).map((option) => ({
            text: option.text,
            isCorrect: option.isCorrect === true,
          })),
        }))
      : [buildEmptyQuestion()],
  };
}

function validateForm(form) {
  if (!form.courseId) return "درس آزمون را انتخاب کنید.";
  if (form.title.trim().length < 2) return "عنوان آزمون را وارد کنید.";
  if (form.questions.length < 1) return "حداقل یک سوال لازم است.";
  if (form.questions.length > 20) return "حداکثر ۲۰ سوال مجاز است.";
  const from = combineLocal(form.startDate, form.startTime);
  const until = combineLocal(form.endDate, form.endTime);
  if (!from || !until) return "تاریخ و ساعت شروع و پایان را کامل کنید.";
  if (new Date(until) <= new Date(from))
    return "پایان بازه باید بعد از شروع آن باشد.";
  if (Number(form.durationMinutes) * 60_000 > new Date(until) - new Date(from))
    return "مدت پاسخ‌دهی نمی‌تواند از طول بازهٔ آزمون بیشتر باشد.";
  for (const [index, question] of form.questions.entries()) {
    if (question.prompt.trim().length < 2)
      return `متن سوال ${index + 1} را کامل کنید.`;
    if (question.options.length < 3 || question.options.length > 5)
      return `سوال ${index + 1} باید بین ۳ تا ۵ گزینه داشته باشد.`;
    if (question.options.some((option) => !option.text.trim()))
      return `متن همهٔ گزینه‌های سوال ${index + 1} را وارد کنید.`;
    if (question.options.filter((option) => option.isCorrect).length !== 1)
      return `برای سوال ${index + 1} دقیقاً یک گزینهٔ صحیح انتخاب کنید.`;
  }
  return "";
}

function toPayload(form) {
  return {
    courseId: form.courseId,
    title: form.title.trim(),
    description: form.description.trim(),
    availableFrom: combineLocal(form.startDate, form.startTime),
    availableUntil: combineLocal(form.endDate, form.endTime),
    durationMinutes: Number(form.durationMinutes),
    passPercent: Number(form.passPercent),
    maxAttempts: Number(form.maxAttempts),
    resultsVisibility: form.resultsVisibility,
    shuffleQuestions: Boolean(form.shuffleQuestions),
    shuffleOptions: Boolean(form.shuffleOptions),
    questions: form.questions.map((question) => ({
      prompt: question.prompt.trim(),
      points: Number(question.points) || 1,
      options: question.options.map((option) => ({
        text: option.text.trim(),
        isCorrect: option.isCorrect,
      })),
    })),
  };
}

async function exportResultsExcel(exam, results, summary) {
  const module = await import("xlsx-js-style");
  const XLSX = module.default || module;
  const header = [
    "ردیف",
    "شماره دانشجویی",
    "نام دانشجو",
    "وضعیت برگه",
    "زمان شروع",
    "زمان ثبت",
    "درصد",
    "نمره از ۲۰",
    "نتیجه",
    "تعداد صحیح",
    "مجموع بارم",
    "تغییر تب",
  ];
  const rows = [
    [`نتایج آزمون: ${exam?.title || ""}`],
    [`درس: ${exam?.courseTitle || "—"}   |   ${formatDateTime(new Date().toISOString())}`],
    [
      `شرکت‌کنندگان: ${faNumber(summary?.studentCount)}   |   ثبت‌شده: ${faNumber(summary?.submittedCount)}   |   قبول: ${faNumber(summary?.passedCount)}   |   میانگین: ${summary?.averagePercent == null ? "—" : `${faNumber(summary.averagePercent)}٪`}`,
    ],
    [],
    header,
  ];
  results.forEach((row, index) => {
    rows.push([
      index + 1,
      String(row.studentNumber || ""),
      row.fullName || "",
      ATTEMPT_STATUS_LABELS[row.attemptStatus] || "شرکت نکرده",
      formatDateTime(row.startedAt),
      formatDateTime(row.submittedAt),
      row.percent == null ? "—" : Number(row.percent),
      row.scoreOutOf20 == null ? "—" : Number(row.scoreOutOf20),
      row.passed == null ? "—" : row.passed ? "قبول" : "مردود",
      row.correctCount == null ? "—" : Number(row.correctCount),
      row.totalPoints == null ? "—" : Number(row.totalPoints),
      Number(row.tabSwitchCount || 0),
    ]);
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 6 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 20 },
    { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 10 },
  ];
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: header.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: header.length - 1 } },
  ];
  const border = {
    top: { style: "thin", color: { rgb: "DCE3EF" } },
    bottom: { style: "thin", color: { rgb: "DCE3EF" } },
    left: { style: "thin", color: { rgb: "DCE3EF" } },
    right: { style: "thin", color: { rgb: "DCE3EF" } },
  };
  for (let column = 0; column < header.length; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 4, c: column })];
    if (cell)
      cell.s = {
        font: { name: "Tahoma", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4361EE" } },
        alignment: { horizontal: "center", vertical: "center", readingOrder: 2 },
        border,
      };
  }
  for (let rowIndex = 5; rowIndex < rows.length; rowIndex += 1) {
    for (let column = 0; column < header.length; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
      if (!cell) continue;
      cell.s = {
        font: { name: "Tahoma", sz: 9, color: { rgb: "1D2939" } },
        alignment: {
          horizontal: column === 2 ? "right" : "center",
          vertical: "center",
          readingOrder: 2,
        },
        border,
      };
    }
  }
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: `نتایج آزمون ${exam?.title || ""}`, Author: "حضوربان" };
  workbook.Workbook = { Views: [{ RTL: true, workbookViewId: "0" }] };
  XLSX.utils.book_append_sheet(workbook, sheet, "نتایج آزمون");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `نتایج-آزمون-${(exam?.title || "exam").replace(/[\\/:*?"<>|]/g, "-")}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function QuestionEditor({ question, index, onChange, onRemove, canRemove }) {
  const update = (patch) => onChange({ ...question, ...patch });
  const updateOption = (optionIndex, patch) => {
    const options = question.options.map((option, current) =>
      current === optionIndex ? { ...option, ...patch } : option,
    );
    update({ options });
  };
  const setCorrect = (optionIndex) => {
    update({
      options: question.options.map((option, current) => ({
        ...option,
        isCorrect: current === optionIndex,
      })),
    });
  };
  const addOption = () => {
    if (question.options.length >= 5) return;
    update({ options: [...question.options, buildEmptyOption()] });
  };
  const removeOption = (optionIndex) => {
    if (question.options.length <= 3) return;
    update({ options: question.options.filter((_, current) => current !== optionIndex) });
  };

  return (
    <article className="exam-question-editor">
      <header>
        <span className="exam-question-number">سوال {faNumber(index + 1)}</span>
        <label className="exam-points-field">
          بارم
          <input
            type="number"
            min="0.25"
            step="0.25"
            className="form-control"
            value={question.points}
            onChange={(event) => update({ points: event.target.value })}
          />
        </label>
        {canRemove && (
          <button
            type="button"
            className="row-action"
            title="حذف سوال"
            onClick={onRemove}
          >
            <Icon name="bi-trash3" />
          </button>
        )}
      </header>
      <label className="form-label">
        متن سوال
        <textarea
          className="form-control"
          rows={2}
          value={question.prompt}
          onChange={(event) => update({ prompt: event.target.value })}
          placeholder="متن سوال را بنویسید…"
        />
      </label>
      <div className="exam-options-editor">
        {question.options.map((option, optionIndex) => (
          <div
            className={`exam-option-row ${option.isCorrect ? "is-correct" : ""}`}
            key={optionIndex}
          >
            <button
              type="button"
              className="exam-correct-toggle"
              title="انتخاب به‌عنوان پاسخ صحیح"
              aria-label={`انتخاب گزینهٔ ${optionIndex + 1} به‌عنوان پاسخ صحیح`}
              aria-pressed={option.isCorrect}
              onClick={() => setCorrect(optionIndex)}
            >
              <Icon name={option.isCorrect ? "bi-check-circle-fill" : "bi-circle"} />
            </button>
            <input
              className="form-control"
              value={option.text}
              onChange={(event) => updateOption(optionIndex, { text: event.target.value })}
              placeholder={`گزینهٔ ${optionIndex + 1}`}
            />
            <button
              type="button"
              className="row-action"
              title="حذف گزینه"
              disabled={question.options.length <= 3}
              onClick={() => removeOption(optionIndex)}
            >
              <Icon name="bi-dash-circle" />
            </button>
          </div>
        ))}
        {question.options.length < 5 && (
          <button type="button" className="exam-add-option" onClick={addOption}>
            <Icon name="bi-plus-circle" /> افزودن گزینه
          </button>
        )}
      </div>
      <small className="exam-hint">
        <Icon name="bi-info-circle" /> یکی از گزینه‌ها را به‌عنوان پاسخ صحیح علامت بزنید.
      </small>
    </article>
  );
}

function ExamEditor({ exam, questions, courses, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() =>
    exam ? formFromExam(exam, questions) : defaultForm(courses),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isEdit = Boolean(exam);

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));
  const updateQuestion = (index, question) =>
    update({
      questions: form.questions.map((current, position) =>
        position === index ? question : current,
      ),
    });
  const addQuestion = () => {
    if (form.questions.length >= 20) return;
    update({ questions: [...form.questions, buildEmptyQuestion()] });
  };
  const removeQuestion = (index) =>
    update({
      questions: form.questions.filter((_, position) => position !== index),
    });

  async function save(event) {
    event.preventDefault();
    const message = validateForm(form);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = toPayload(form);
      if (isEdit) await updateExam(exam.id, payload);
      else await createExam(payload);
      notify(isEdit ? "آزمون به‌روزرسانی شد." : "آزمون به‌صورت پیش‌نویس ذخیره شد.");
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError.message || "ذخیرهٔ آزمون انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" role="presentation">
      <div
        className="custom-modal exam-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "ویرایش آزمون" : "آزمون جدید"}
        dir="rtl"
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">{isEdit ? "ویرایش آزمون" : "طراحی آزمون"}</div>
            <h3>{isEdit ? exam.title : "آزمون جدید"}</h3>
            <p className="exam-modal-subtitle">
              عنوان آزاد، بازهٔ زمانی دقیق و سوالات چندگزینه‌ای را تعیین کنید.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="بستن">
            <Icon name="bi-x-lg" />
          </button>
        </div>
        {error && (
          <div className="exam-form-error" role="alert">
            <Icon name="bi-exclamation-triangle" /> {error}
          </div>
        )}
        <form onSubmit={save} className="exam-editor-form">
          <section className="exam-form-section">
            <h4><Icon name="bi-journal-bookmark" /> مشخصات آزمون</h4>
            <div className="exam-form-grid">
              <label className="form-label">
                درس
                <select
                  className="form-select"
                  value={form.courseId}
                  onChange={(event) => update({ courseId: event.target.value })}
                  disabled={isEdit}
                >
                  <option value="">انتخاب درس…</option>
                  {courses.map((course) => (
                    <option key={course.databaseId || course.id} value={course.databaseId}>
                      {course.title} {course.id ? `(${course.id})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                عنوان آزمون
                <input
                  className="form-control"
                  value={form.title}
                  maxLength={160}
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder="مثلاً میان‌ترم، پایان‌ترم یا آزمون کوتاه"
                />
              </label>
            </div>
            <label className="form-label">
              توضیحات (اختیاری)
              <textarea
                className="form-control"
                rows={2}
                maxLength={2000}
                value={form.description}
                onChange={(event) => update({ description: event.target.value })}
                placeholder="راهنمایی یا توضیحی که دانشجو قبل از شروع آزمون می‌بیند…"
              />
            </label>
          </section>

          <section className="exam-form-section">
            <h4><Icon name="bi-calendar3" /> زمان‌بندی</h4>
            <div className="exam-form-grid exam-form-grid-4">
              <label className="form-label">
                تاریخ شروع
                <JalaliDateInput
                  value={form.startDate}
                  onChange={(date) => update({ startDate: date })}
                  ariaLabel="تاریخ شروع آزمون"
                />
              </label>
              <label className="form-label">
                ساعت شروع
                <input
                  type="time"
                  className="form-control"
                  value={form.startTime}
                  onChange={(event) => update({ startTime: event.target.value })}
                />
              </label>
              <label className="form-label">
                تاریخ پایان
                <JalaliDateInput
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(date) => update({ endDate: date })}
                  ariaLabel="تاریخ پایان آزمون"
                />
              </label>
              <label className="form-label">
                ساعت پایان
                <input
                  type="time"
                  className="form-control"
                  value={form.endTime}
                  onChange={(event) => update({ endTime: event.target.value })}
                />
              </label>
            </div>
            <p className="exam-hint">
              <Icon name="bi-info-circle" />
              دانشجو فقط داخل این بازه می‌تواند آزمون را شروع کند؛ مدت پاسخ‌دهی از لحظهٔ شروع محاسبه می‌شود.
            </p>
          </section>

          <section className="exam-form-section">
            <h4><Icon name="bi-sliders" /> تنظیمات نمره و نمایش</h4>
            <div className="exam-form-grid exam-form-grid-4">
              <label className="form-label">
                مدت پاسخ‌دهی (دقیقه)
                <input
                  type="number"
                  min="1"
                  max="240"
                  className="form-control"
                  value={form.durationMinutes}
                  onChange={(event) => update({ durationMinutes: event.target.value })}
                />
              </label>
              <label className="form-label">
                حد قبولی (درصد)
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="form-control"
                  value={form.passPercent}
                  onChange={(event) => update({ passPercent: event.target.value })}
                />
              </label>
              <label className="form-label">
                تعداد تلاش مجاز
                <select
                  className="form-select"
                  value={form.maxAttempts}
                  onChange={(event) => update({ maxAttempts: event.target.value })}
                >
                  <option value="1">۱ بار</option>
                  <option value="2">۲ بار</option>
                  <option value="3">۳ بار</option>
                </select>
              </label>
              <label className="form-label">
                نمایش نتیجه به دانشجو
                <select
                  className="form-select"
                  value={form.resultsVisibility}
                  onChange={(event) => update({ resultsVisibility: event.target.value })}
                >
                  {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="exam-switches">
              <label className="exam-switch-row">
                <input
                  type="checkbox"
                  checked={form.shuffleQuestions}
                  onChange={(event) => update({ shuffleQuestions: event.target.checked })}
                />
                <span>ترتیب سوالات برای هر دانشجو متفاوت باشد</span>
              </label>
              <label className="exam-switch-row">
                <input
                  type="checkbox"
                  checked={form.shuffleOptions}
                  onChange={(event) => update({ shuffleOptions: event.target.checked })}
                />
                <span>ترتیب گزینه‌ها برای هر دانشجو متفاوت باشد</span>
              </label>
            </div>
          </section>

          <section className="exam-form-section">
            <div className="exam-questions-head">
              <h4><Icon name="bi-list-check" /> سوالات ({faNumber(form.questions.length)} از ۲۰)</h4>
              <button
                type="button"
                className="btn btn-light"
                onClick={addQuestion}
                disabled={form.questions.length >= 20}
              >
                <Icon name="bi-plus-lg" /> افزودن سوال
              </button>
            </div>
            <div className="exam-questions-list">
              {form.questions.map((question, index) => (
                <QuestionEditor
                  key={index}
                  index={index}
                  question={question}
                  canRemove={form.questions.length > 1}
                  onChange={(updated) => updateQuestion(index, updated)}
                  onRemove={() => removeQuestion(index)}
                />
              ))}
            </div>
          </section>

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name={busy ? "bi-hourglass-split" : "bi-check2"} />
              {busy ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ تغییرات" : "ذخیرهٔ پیش‌نویس"}
            </button>
            <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
              انصراف
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResultsModal({ exam, onClose, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resultsTab, setResultsTab] = useState("results");
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [reports, setReports] = useState(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [accommodationTarget, setAccommodationTarget] = useState(null);
  const [accommodationForm, setAccommodationForm] = useState({ extraMinutes: 0, extraAttempts: 0, note: "" });
  const [accommodationBusy, setAccommodationBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await fetchExamResults(exam.id));
    } catch (loadError) {
      setError(loadError.message || "دریافت نتایج انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id]);

  async function openDetail(attemptId) {
    setDetailLoading(true);
    try {
      setDetail(await fetchExamAttemptDetail(exam.id, attemptId));
    } catch (detailError) {
      notify(detailError.message || "دریافت برگهٔ آزمون انجام نشد.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitVoid(event) {
    event.preventDefault();
    if (!voidTarget) return;
    setVoidBusy(true);
    try {
      await voidExamAttempt(exam.id, voidTarget.attemptId, voidReason.trim());
      notify("برگهٔ آزمون ابطال شد و در گزارش فعالیت ثبت گردید.");
      setVoidTarget(null);
      setVoidReason("");
      await load();
    } catch (voidError) {
      notify(voidError.message || "ابطال برگه انجام نشد.");
    } finally {
      setVoidBusy(false);
    }
  }

  async function exportExcel() {
    if (!data) return;
    setExporting(true);
    try {
      await exportResultsExcel(data.exam, data.results || [], data.summary);
    } catch (exportError) {
      notify(exportError.message || "تهیهٔ خروجی اکسل انجام نشد.");
    } finally {
      setExporting(false);
    }
  }

  async function loadAnalysis(force = false) {
    if (analysis && !force) return;
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      setAnalysis(await fetchExamAnalysis(exam.id));
    } catch (analysisLoadError) {
      setAnalysisError(analysisLoadError.message || "دریافت تحلیل سوالات انجام نشد.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function loadReports(force = false) {
    if (reports && !force) return;
    setReportsLoading(true);
    setReportsError("");
    try {
      setReports(await fetchExamReports(exam.id));
    } catch (reportsLoadError) {
      setReportsError(reportsLoadError.message || "دریافت گزارش‌های دانشجویان انجام نشد.");
    } finally {
      setReportsLoading(false);
    }
  }

  function selectTab(tab) {
    setResultsTab(tab);
    if (tab === "analysis") loadAnalysis();
    if (tab === "reports") loadReports();
  }

  function openAccommodation(row) {
    setAccommodationTarget(row);
    setAccommodationForm({
      extraMinutes: Number(row.extraMinutes || 0),
      extraAttempts: Number(row.extraAttempts || 0),
      note: "",
    });
  }

  async function submitAccommodation(event) {
    event.preventDefault();
    if (!accommodationTarget) return;
    setAccommodationBusy(true);
    try {
      await grantExamAccommodation(exam.id, accommodationTarget.studentId, {
        extraMinutes: Number(accommodationForm.extraMinutes) || 0,
        extraAttempts: Number(accommodationForm.extraAttempts) || 0,
        note: accommodationForm.note.trim() || undefined,
      });
      notify("امتیاز ویژهٔ دانشجو ثبت شد.");
      setAccommodationTarget(null);
      await load();
    } catch (accommodationError) {
      notify(accommodationError.message || "ثبت امتیاز ویژه انجام نشد.");
    } finally {
      setAccommodationBusy(false);
    }
  }

  const summary = data?.summary;

  return (
    <div className="modal-backdrop-custom" role="presentation">
      <div className="custom-modal exam-results-modal" role="dialog" aria-modal="true" aria-label="نتایج آزمون" dir="rtl">
        <div className="modal-head">
          <div>
            <div className="eyebrow">نتایج و نظارت</div>
            <h3>{data?.exam?.title || exam.title}</h3>
            <p className="exam-modal-subtitle">
              {data?.exam?.courseTitle || exam.courseTitle} • {formatDateTime(data?.exam?.availableFrom || exam.availableFrom)} تا {formatDateTime(data?.exam?.availableUntil || exam.availableUntil)}
            </p>
          </div>
          <div className="exam-results-head-actions">
            <button type="button" className="btn btn-light" onClick={exportExcel} disabled={!data || exporting}>
              <Icon name="bi-file-earmark-excel" /> {exporting ? "در حال تهیه…" : "خروجی اکسل"}
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="بستن">
              <Icon name="bi-x-lg" />
            </button>
          </div>
        </div>

        <div className="exam-results-tabs" role="tablist" aria-label="بخش‌های نتایج آزمون">
          <button type="button" role="tab" aria-selected={resultsTab === "results"} className={`exam-results-tab ${resultsTab === "results" ? "is-active" : ""}`} onClick={() => selectTab("results")}>
            نتایج
          </button>
          <button type="button" role="tab" aria-selected={resultsTab === "analysis"} className={`exam-results-tab ${resultsTab === "analysis" ? "is-active" : ""}`} onClick={() => selectTab("analysis")}>
            تحلیل سوالات
          </button>
          <button type="button" role="tab" aria-selected={resultsTab === "reports"} className={`exam-results-tab ${resultsTab === "reports" ? "is-active" : ""}`} onClick={() => selectTab("reports")}>
            گزارش‌های دانشجویان{reports ? ` (${faNumber(reports.reports?.length || 0)})` : ""}
          </button>
        </div>

        {resultsTab === "results" && loading && <div className="exam-loading"><span className="exam-spinner" /> در حال دریافت نتایج…</div>}
        {resultsTab === "results" && error && <div className="exam-form-error" role="alert"><Icon name="bi-exclamation-triangle" /> {error}</div>}

        {resultsTab === "results" && !loading && data && (
          <>
            <div className="exam-result-stats">
              <div><span>شرکت‌کنندگان</span><strong>{faNumber(summary?.studentCount)}</strong></div>
              <div><span>برگهٔ ثبت‌شده</span><strong>{faNumber(summary?.submittedCount)}</strong></div>
              <div><span>قبول</span><strong>{faNumber(summary?.passedCount)}</strong></div>
              <div><span>مشکوک</span><strong>{faNumber(summary?.suspiciousCount ?? 0)}</strong></div>
              <div><span>میانگین</span><strong>{summary?.averagePercent == null ? "—" : `${faNumber(summary.averagePercent)}٪`}</strong></div>
            </div>
            <div className="exam-results-table-wrap">
              <table className="custom-table exam-results-table">
                <thead>
                  <tr>
                    <th>دانشجو</th>
                    <th>وضعیت</th>
                    <th>درصد</th>
                    <th>نمره</th>
                    <th>نتیجه</th>
                    <th>تغییر تب</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.results || []).map((row) => {
                    const suspicious = Number(row.tabSwitchCount || 0) >= SUSPECT_TAB_SWITCHES;
                    return (
                    <tr key={row.studentId} className={suspicious ? "is-suspicious" : ""}>
                      <td>
                        <div className="exam-student-cell">
                          <strong>{row.fullName}</strong>
                          <small>{row.studentNumber}</small>
                          {suspicious && <Badge tone="warning">مشکوک</Badge>}
                        </div>
                      </td>
                      <td>
                        <Badge tone={
                          row.attemptStatus === "submitted" ? "success"
                          : row.attemptStatus === "in_progress" ? "info"
                          : row.attemptStatus === "voided" ? "danger"
                          : row.attemptStatus === "expired" ? "warning"
                          : "neutral"
                        }>
                          {ATTEMPT_STATUS_LABELS[row.attemptStatus] || "شرکت نکرده"}
                        </Badge>
                      </td>
                      <td>{row.percent == null ? "—" : `${faNumber(row.percent)}٪`}</td>
                      <td>{row.scoreOutOf20 == null ? "—" : faNumber(row.scoreOutOf20)}</td>
                      <td>
                        {row.passed == null ? "—" : row.passed
                          ? <Badge tone="success">قبول</Badge>
                          : <Badge tone="danger">مردود</Badge>}
                      </td>
                      <td className={`exam-tab-count${suspicious ? " is-high" : ""}`}>{faNumber(row.tabSwitchCount)}</td>
                      <td>
                        <div className="exam-row-actions">
                          <button type="button" className="row-action" title="مهلت یا فرصت اضافه" onClick={() => openAccommodation(row)}>
                            <Icon name="bi-stopwatch" />
                          </button>
                          {row.attemptId && (
                            <button type="button" className="btn btn-light btn-sm" onClick={() => openDetail(row.attemptId)}>
                              <Icon name="bi-eye" /> برگه
                            </button>
                          )}
                          {row.attemptId && row.attemptStatus !== "voided" && (
                            <button type="button" className="row-action" title="ابطال برگه" onClick={() => setVoidTarget(row)}>
                              <Icon name="bi-slash-circle" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {!(data.results || []).length && (
                    <tr><td colSpan={7}><EmptyState icon="bi-inbox" title="نتیجه‌ای ثبت نشده" description="هنوز دانشجویی در این آزمون شرکت نکرده است." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {resultsTab === "analysis" && (
          <div className="exam-analysis">
            {analysisLoading && <div className="exam-loading"><span className="exam-spinner" /> در حال تحلیل سوالات…</div>}
            {analysisError && <div className="exam-form-error" role="alert"><Icon name="bi-exclamation-triangle" /> {analysisError}</div>}
            {analysis && !analysisLoading && (
              <>
                <p className="exam-analysis-meta">
                  تحلیل بر اساس {faNumber(analysis.attemptCount)} برگهٔ ثبت‌شده • درصد پاسخ صحیح از کل برگه‌ها
                </p>
                {(analysis.analysis || []).map((question) => {
                  const pct = question.correctPercent;
                  const tone = pct == null ? "mid" : pct >= 70 ? "good" : pct >= 40 ? "mid" : "low";
                  return (
                    <div className="exam-analysis-row" key={question.id}>
                      <div className="exam-analysis-head">
                        <span className="exam-analysis-q">سوال {faNumber(question.position)}</span>
                        <span className="exam-analysis-prompt">{question.prompt}</span>
                        <span className={`exam-analysis-pct ${tone}`}>{pct == null ? "—" : `${faNumber(pct)}٪`}</span>
                      </div>
                      <div className="exam-analysis-bar" role="presentation"><span className={`exam-analysis-fill ${tone}`} style={{ width: `${pct == null ? 0 : pct}%` }} /></div>
                      <div className="exam-analysis-options">
                        {(question.options || []).map((option) => {
                          const share = question.doneCount
                            ? Math.round((option.selectedCount / question.doneCount) * 1000) / 10
                            : 0;
                          return (
                            <div className={`exam-analysis-option${option.isCorrect ? " is-correct" : ""}`} key={option.id}>
                              <span className="exam-analysis-option-text">
                                {option.isCorrect && <Icon name="bi-check-circle-fill" />} {option.text}
                              </span>
                              <span className="exam-analysis-option-count">{faNumber(option.selectedCount)} نفر ({faNumber(share)}٪)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {!(analysis.analysis || []).length && (
                  <EmptyState icon="bi-inbox" title="تحلیلی در دسترس نیست" description="هنوز برگه‌ای برای این آزمون ثبت نشده است." />
                )}
              </>
            )}
          </div>
        )}

        {resultsTab === "reports" && (
          <div className="exam-reports">
            {reportsLoading && <div className="exam-loading"><span className="exam-spinner" /> در حال دریافت گزارش‌ها…</div>}
            {reportsError && <div className="exam-form-error" role="alert"><Icon name="bi-exclamation-triangle" /> {reportsError}</div>}
            {reports && !reportsLoading && (
              (reports.reports || []).length ? (
                <ul className="exam-reports-list">
                  {reports.reports.map((report) => (
                    <li key={report.id} className="exam-reports-item">
                      <div className="exam-reports-head">
                        <span className="exam-reports-q">سوال {faNumber(report.position)}</span>
                        <span className="exam-reports-student">{report.fullName} <small>{report.studentNumber}</small></span>
                        <time>{formatDateTime(report.createdAt)}</time>
                      </div>
                      <p className="exam-reports-prompt">{report.prompt}</p>
                      <p className="exam-reports-note">{report.note || "بدون توضیح"}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon="bi-flag" title="گزارشی ثبت نشده" description="هنوز دانشجویی سوالی را خطادار گزارش نکرده است." />
              )
            )}
          </div>
        )}

        {resultsTab === "results" && detail && (
          <div className="exam-detail-panel">
            <div className="exam-detail-head">
              <div>
                <div className="eyebrow">برگهٔ پاسخ</div>
                <h4>{detail.student?.name} — {detail.student?.number}</h4>
              </div>
              <button type="button" className="icon-button" onClick={() => setDetail(null)} aria-label="بستن برگه">
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <p className="exam-detail-meta">
              وضعیت: {ATTEMPT_STATUS_LABELS[detail.attempt?.status] || "—"} • درصد: {detail.attempt?.percent == null ? "—" : `${faNumber(detail.attempt.percent)}٪`} • نمره: {detail.attempt?.scoreOutOf20 == null ? "—" : faNumber(detail.attempt.scoreOutOf20)}
            </p>
            <p className="exam-detail-meta exam-detail-integrity">
              تغییر تب: <strong>{faNumber(detail.attempt?.tabSwitchCount)}</strong> • خروج از تمام‌صفحه: <strong>{faNumber(detail.attempt?.integrityFlags?.fullscreenExits ?? 0)}</strong>
              {Number(detail.attempt?.tabSwitchCount || 0) >= SUSPECT_TAB_SWITCHES && <> • <Badge tone="warning">مشکوک</Badge></>}
            </p>
            <ol className="exam-detail-questions">
              {(detail.questions || []).map((question) => {
                const selected = question.answer?.selectedOptionId;
                return (
                  <li key={question.id}>
                    <div className="exam-detail-question-head">
                      <strong>{question.prompt}</strong>
                      <Badge tone={question.answer?.isCorrect ? "success" : question.answer?.selectedOptionId ? "danger" : "neutral"}>
                        {question.answer?.isCorrect ? "صحیح" : question.answer?.selectedOptionId ? "غلط" : "بی‌پاسخ"}
                      </Badge>
                    </div>
                    <div className="exam-detail-options">
                      {question.options.map((option) => (
                        <span
                          key={option.id}
                          className={`exam-detail-option ${option.isCorrect ? "is-correct" : ""} ${selected === option.id ? "is-selected" : ""}`}
                        >
                          {option.text}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {detailLoading && <div className="exam-loading"><span className="exam-spinner" /> در حال دریافت برگه…</div>}

        {accommodationTarget && (
          <form className="exam-void-form" onSubmit={submitAccommodation}>
            <h4><Icon name="bi-stopwatch" /> امتیاز ویژهٔ {accommodationTarget.fullName}</h4>
            <p>مهلت و فرصت اضافه روی برگه‌های بعدی این دانشجو اعمال می‌شود؛ برگه‌های در حال انجام تغییر نمی‌کنند. حذف امتیاز با صفر کردن هر دو مقدار انجام می‌شود.</p>
            <label className="form-label">
              مهلت اضافه (دقیقه)
              <input
                type="number"
                min="0"
                max="180"
                className="form-control"
                value={accommodationForm.extraMinutes}
                onChange={(event) => setAccommodationForm((form) => ({ ...form, extraMinutes: event.target.value }))}
              />
            </label>
            <label className="form-label">
              فرصت اضافه
              <select
                className="form-select"
                value={accommodationForm.extraAttempts}
                onChange={(event) => setAccommodationForm((form) => ({ ...form, extraAttempts: Number(event.target.value) }))}
              >
                <option value={0}>بدون فرصت اضافه</option>
                <option value={1}>۱ فرصت اضافه</option>
                <option value={2}>۲ فرصت اضافه</option>
                <option value={3}>۳ فرصت اضافه</option>
              </select>
            </label>
            <label className="form-label">
              توضیح (اختیاری)
              <input
                type="text"
                className="form-control"
                maxLength={200}
                placeholder="مثلاً: گواهی پزشکی — نارساخوانی"
                value={accommodationForm.note}
                onChange={(event) => setAccommodationForm((form) => ({ ...form, note: event.target.value }))}
              />
            </label>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={accommodationBusy}>
                {accommodationBusy ? "در حال ثبت…" : "ثبت امتیاز ویژه"}
              </button>
              <button type="button" className="btn btn-light" onClick={() => setAccommodationTarget(null)} disabled={accommodationBusy}>انصراف</button>
            </div>
          </form>
        )}

        {voidTarget && (
          <form className="exam-void-form" onSubmit={submitVoid}>
            <h4><Icon name="bi-slash-circle" /> ابطال برگهٔ {voidTarget.fullName}</h4>
            <p>این عملیات نمره را از محاسبات خارج می‌کند و در گزارش فعالیت مدیران ثبت می‌شود.</p>
            <textarea
              className="form-control"
              rows={2}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="دلیل ابطال (حداقل ۳ کاراکتر)"
            />
            <div className="modal-actions">
              <button type="submit" className="btn btn-danger" disabled={voidBusy || voidReason.trim().length < 3}>
                {voidBusy ? "در حال ابطال…" : "ابطال برگه"}
              </button>
              <button type="button" className="btn btn-light" onClick={() => setVoidTarget(null)} disabled={voidBusy}>انصراف</button>
            </div>
          </form>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-light" onClick={onClose}>بستن</button>
        </div>
      </div>
    </div>
  );
}

export function Exams({ courses = [], accessRole = "teacher", notify }) {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [editor, setEditor] = useState(null);
  const [editorQuestions, setEditorQuestions] = useState(null);
  const [resultsExam, setResultsExam] = useState(null);
  const [busyId, setBusyId] = useState("");
  const isAdmin = accessRole === "admin";
  const isTeacher = accessRole === "teacher";

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchExams({
        status: statusFilter,
        courseId: courseFilter,
      });
      setExams(data.exams || []);
    } catch (loadError) {
      setError(loadError.message || "دریافت فهرست آزمون‌ها انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, courseFilter]);

  const stats = useMemo(() => {
    const open = exams.filter((exam) => exam.effectiveStatus === "open").length;
    const upcoming = exams.filter((exam) => exam.effectiveStatus === "upcoming").length;
    const submitted = exams.reduce((sum, exam) => sum + Number(exam.submittedCount || 0), 0);
    return { total: exams.length, open, upcoming, submitted };
  }, [exams]);

  async function runAction(id, action, successMessage) {
    setBusyId(id);
    try {
      await action();
      if (successMessage) notify(successMessage);
      await load();
      return true;
    } catch (actionError) {
      notify(actionError.message || "عملیات انجام نشد.");
      return false;
    } finally {
      setBusyId("");
    }
  }

  async function openEditor(exam) {
    if (!exam) {
      setEditorQuestions(null);
      setEditor({});
      return;
    }
    try {
      const data = await fetchExamDetail(exam.id);
      setEditor(data.exam);
      setEditorQuestions(data.questions || []);
    } catch (detailError) {
      notify(detailError.message || "دریافت اطلاعات آزمون انجام نشد.");
    }
  }

  return (
    <section className="exam-page">
      <PanelTitle
        eyebrow={isAdmin ? "نظارت بر آزمون‌ها" : "مدیریت آزمون‌ها"}
        title="آزمون‌های آنلاین"
        description={
          isAdmin
            ? "همهٔ آزمون‌های اساتید را پایش کنید، نتایج را ببینید و در صورت نیاز برگه‌ها را ابطال کنید."
            : "آزمون چندگزینه‌ای زمان‌دار بسازید، منتشر کنید و نتایج دانشجویان خود را ببینید."
        }
        action={
          isTeacher ? (
            <button type="button" className="btn btn-primary" onClick={() => openEditor(null)}>
              <Icon name="bi-plus-lg" /> آزمون جدید
            </button>
          ) : null
        }
      />

      <div className="exam-stat-grid">
        <StatCard icon="bi-journal-check" label="کل آزمون‌ها" value={faNumber(stats.total)} color="blue" />
        <StatCard icon="bi-broadcast" label="در حال برگزاری" value={faNumber(stats.open)} color="green" />
        <StatCard icon="bi-hourglass-split" label="در انتظار شروع" value={faNumber(stats.upcoming)} color="orange" />
        <StatCard icon="bi-check2-square" label="برگهٔ ثبت‌شده" value={faNumber(stats.submitted)} color="purple" />
      </div>

      <div className="exam-toolbar">
        <div className="exam-filter-group">
          <label>
            <Icon name="bi-funnel" />
            <select className="form-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">همهٔ وضعیت‌ها</option>
              <option value="draft">پیش‌نویس</option>
              <option value="published">منتشرشده</option>
              <option value="closed">بسته شده</option>
              <option value="cancelled">لغو شده</option>
            </select>
          </label>
          <label>
            <Icon name="bi-journal-bookmark" />
            <select className="form-select" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
              <option value="">همهٔ درس‌ها</option>
              {courses.map((course) => (
                <option key={course.databaseId || course.id} value={course.databaseId}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
          <Icon name="bi-arrow-clockwise" /> به‌روزرسانی
        </button>
      </div>

      {error && <div className="exam-form-error" role="alert"><Icon name="bi-exclamation-triangle" /> {error}</div>}

      {loading ? (
        <div className="exam-loading"><span className="exam-spinner" /> در حال دریافت آزمون‌ها…</div>
      ) : exams.length ? (
        <div className="exam-list">
          {exams.map((exam) => {
            const status = STATUS_META[exam.effectiveStatus] || STATUS_META.draft;
            const canEdit = isTeacher && ["draft", "published"].includes(exam.status) && !Number(exam.submittedCount);
            return (
              <article className="exam-card" key={exam.id}>
                <div className="exam-card-main">
                  <div className={`exam-status-icon ${status.tone}`}>
                    <Icon name={status.icon} />
                  </div>
                  <div className="exam-card-copy">
                    <div className="exam-card-title">
                      <h3>{exam.title}</h3>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="exam-card-meta">
                      <span><Icon name="bi-journal-bookmark" /> {exam.courseTitle} {exam.courseCode ? `(${exam.courseCode})` : ""}</span>
                      {isAdmin && <span><Icon name="bi-person-workspace" /> {exam.teacherName || "—"}</span>}
                      <span><Icon name="bi-question-circle" /> {faNumber(exam.questionCount)} سوال</span>
                      <span><Icon name="bi-clock" /> {faNumber(exam.durationMinutes)} دقیقه</span>
                    </p>
                    <p className="exam-card-meta">
                      <span><Icon name="bi-calendar-event" /> {formatDateTime(exam.availableFrom)}</span>
                      <span><Icon name="bi-calendar-check" /> {formatDateTime(exam.availableUntil)}</span>
                      <span><Icon name="bi-people" /> {faNumber(exam.studentCount)} دانشجو</span>
                      <span><Icon name="bi-percent" /> قبولی {faNumber(exam.passPercent)}٪</span>
                    </p>
                    <div className="exam-card-progress">
                      <div>
                        <span>ثبت‌شده</span>
                        <strong>{faNumber(exam.submittedCount)} از {faNumber(exam.studentCount)}</strong>
                      </div>
                      <div>
                        <span>قبول</span>
                        <strong>{faNumber(exam.passedCount)}</strong>
                      </div>
                      <div>
                        <span>میانگین</span>
                        <strong>{exam.averagePercent == null ? "—" : `${faNumber(exam.averagePercent)}٪`}</strong>
                      </div>
                      <div>
                        <span>نمایش نتیجه</span>
                        <strong>{VISIBILITY_LABELS[exam.resultsVisibility] || "—"}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="exam-card-actions">
                  {exam.status === "published" && (isTeacher || isAdmin) && (
                    <button type="button" className="btn btn-light" disabled={busyId === exam.id}
                      onClick={() => runAction(exam.id, () => closeExam(exam.id), "آزمون بسته شد و برگه‌های باز نهایی شدند.")}>
                      <Icon name="bi-lock" /> بستن آزمون
                    </button>
                  )}
                  {exam.status === "draft" && isTeacher && (
                    <button type="button" className="btn btn-primary" disabled={busyId === exam.id}
                      onClick={() => runAction(exam.id, () => publishExam(exam.id), "آزمون منتشر شد و برای دانشجویان اطلاع‌رسانی شد.")}>
                      <Icon name="bi-send" /> انتشار
                    </button>
                  )}
                  {isTeacher && ["draft", "published"].includes(exam.status) && (
                    <button type="button" className="btn btn-light" onClick={() => openEditor(exam)}>
                      <Icon name="bi-pencil-square" /> ویرایش
                    </button>
                  )}
                  <button type="button" className="btn btn-light" onClick={() => setResultsExam(exam)}>
                    <Icon name="bi-bar-chart-line" /> نتایج
                  </button>
                  {["draft", "cancelled"].includes(exam.status) && (
                    <button type="button" className="row-action" title="حذف آزمون" disabled={busyId === exam.id}
                      onClick={() => {
                        if (!window.confirm("این آزمون پیش‌نویس حذف شود؟")) return;
                        runAction(exam.id, () => deleteExam(exam.id), "آزمون حذف شد.");
                      }}>
                      <Icon name="bi-trash3" />
                    </button>
                  )}
                  {!isTeacher && !isAdmin ? null : exam.status === "published" && Number(exam.submittedCount) === 0 && (
                    <button type="button" className="row-action" title="لغو آزمون" disabled={busyId === exam.id}
                      onClick={() => {
                        if (!window.confirm("این آزمون لغو شود؟")) return;
                        runAction(exam.id, () => cancelExam(exam.id), "آزمون لغو شد.");
                      }}>
                      <Icon name="bi-x-circle" />
                    </button>
                  )}
                  {canEdit && exam.status === "published" && (
                    <span className="exam-locked-note"><Icon name="bi-lock" /> سوالات قفل شده‌اند</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="content-card">
          <EmptyState
            icon="bi-journal-x"
            title="هنوز آزمونی ساخته نشده"
            description={isTeacher ? "با دکمهٔ «آزمون جدید» اولین آزمون چندگزینه‌ای خود را بسازید." : "اساتید هنوز آزمونی در این دانشکده ایجاد نکرده‌اند."}
          />
        </div>
      )}

      {editor && (
        <ExamEditor
          exam={editor.id ? editor : null}
          questions={editorQuestions}
          courses={courses}
          notify={notify}
          onClose={() => { setEditor(null); setEditorQuestions(null); }}
          onSaved={load}
        />
      )}
      {resultsExam && (
        <ResultsModal
          exam={resultsExam}
          notify={notify}
          onClose={() => setResultsExam(null)}
        />
      )}
    </section>
  );
}

export default Exams;
