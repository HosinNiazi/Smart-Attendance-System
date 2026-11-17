import React, { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, Icon, PanelTitle, SkeletonTable } from "./shared.jsx";
import { fetchFaceEvents } from "../api/client.js";

const number = new Intl.NumberFormat("fa-IR");

function formatTime(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

const REASON_LABELS = {
  disabled: "قابلیت غیرفعال است",
  verification_missing: "شواهد ناقص",
  distance_out_of_range: "فاصلهٔ نامعتبر",
  distance_too_far: "تطبیق ضعیف",
  margin_too_small: "ابهام با نفر دوم",
  liveness_missing: "پلک/فریم ناکافی",
  unknown_reason: "دلایل دیگر",
};

function reasonLabel(reason) {
  return REASON_LABELS[reason] || reason || "—";
}

export function FaceEvents() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [decisionFilter, setDecisionFilter] = useState("all");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await fetchFaceEvents({ limit: 100 });
      setEvents(result.events || []);
      setError("");
    } catch (issue) {
      setError(issue.message || "دریافت رویدادها انجام نشد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ silent: true }), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const all = events || [];
  const visible =
    decisionFilter === "all"
      ? all
      : all.filter((event) => event.decision === decisionFilter);
  const rejected = all.filter((event) => event.decision === "rejected").length;

  return (
    <div className="reports-page">
      <PanelTitle
        eyebrow="حسابرسی تشخیص چهره"
        title="رویدادهای تشخیص چهره"
        description="هر تصمیم ثبت/رد حضور با چهره، همراه با میزان تطبیق، شواهد زنده‌بودن و دستگاه ثبت‌کننده."
        action={
          <button
            type="button"
            className="btn btn-light-outline"
            onClick={() => load()}
          >
            <Icon name="bi-arrow-clockwise" /> به‌روزرسانی
          </button>
        }
      />

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <Icon name="bi-journal-text" />
          </div>
          <div className="stat-copy">
            <span>رویدادهای اخیر</span>
            <strong>{number.format(all.length)}</strong>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">
            <Icon name="bi-slash-circle" />
          </div>
          <div className="stat-copy">
            <span>ردشده‌ها</span>
            <strong>{number.format(rejected)}</strong>
          </div>
        </div>
      </div>

      <div className="report-filter-card">
        <div className="report-filter-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <label>
            نوع تصمیم
            <select
              className="filter-select"
              value={decisionFilter}
              onChange={(event) => setDecisionFilter(event.target.value)}
            >
              <option value="all">همه</option>
              <option value="accepted">پذیرفته‌شده</option>
              <option value="rejected">ردشده</option>
            </select>
          </label>
        </div>
      </div>

      {error && (
        <p className="profile-error" role="alert">
          {error}
        </p>
      )}

      {loading && !events ? (
        <SkeletonTable rows={6} columns={7} />
      ) : visible.length ? (
        <div className="table-responsive">
          <table className="table custom-table align-middle">
            <thead>
              <tr>
                <th>زمان</th>
                <th>دانشجو</th>
                <th>تصمیم</th>
                <th>دلیل رد</th>
                <th>فاصله</th>
                <th>حاشیه</th>
                <th>زنده‌بودن</th>
                <th>فریم</th>
                <th>دستگاه</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id}>
                  <td className="id-cell">{formatTime(event.createdAt)}</td>
                  <td>{event.studentName || "—"}</td>
                  <td>
                    <Badge tone={event.decision === "accepted" ? "success" : "danger"}>
                      {event.decision === "accepted" ? "ثبت شد" : "رد شد"}
                    </Badge>
                  </td>
                  <td>
                    {event.decision === "accepted"
                      ? "—"
                      : reasonLabel(event.reason)}
                  </td>
                  <td>
                    {event.distance == null
                      ? "—"
                      : number.format(Number(event.distance).toFixed(3))}
                  </td>
                  <td>
                    {event.margin == null
                      ? "—"
                      : number.format(Number(event.margin).toFixed(3))}
                  </td>
                  <td>
                    {event.liveness === "blink"
                      ? "پلک"
                      : event.liveness === "teacher_confirm"
                        ? "تأیید استاد"
                        : "—"}
                  </td>
                  <td>{number.format(event.frameCount)}</td>
                  <td className="id-cell">{event.deviceId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon="bi-journal-x"
          title="رویدادی ثبت نشده است"
          text="با اولین تلاش برای ثبت حضور با چهره (موفق یا ناموفق)، تصمیم اینجا نمایش داده می‌شود."
        />
      )}
    </div>
  );
}

export default FaceEvents;
