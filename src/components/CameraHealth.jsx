import React, { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, Icon, PanelTitle, SkeletonCards, StatCard } from "./shared.jsx";
import { fetchCameraHealth } from "../api/client.js";

const number = new Intl.NumberFormat("fa-IR");
const percent = new Intl.NumberFormat("fa-IR", {
  style: "percent",
  maximumFractionDigits: 0,
});

function formatCount(value) {
  return number.format(Number(value) || 0);
}

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

export function CameraHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await fetchCameraHealth();
      setData(result);
      setError("");
    } catch (issue) {
      setError(issue.message || "دریافت وضعیت دوربین‌ها انجام نشد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ silent: true }), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = data?.summary;
  const devices = data?.devices || [];

  return (
    <div className="reports-page">
      <PanelTitle
        eyebrow="پایش دوربین"
        title="سلامت دوربین‌های تشخیص چهره"
        description="آخرین گزارش هر دستگاه، نرخ تشخیص چهره و نتیجهٔ اعتبارسنجی‌های ۲۴ ساعت گذشته."
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

      {loading && !data ? (
        <SkeletonCards count={4} />
      ) : (
        <div className="stat-grid">
          <StatCard
            icon="bi-camera-video"
            label="دوربین‌های فعال"
            value={`${formatCount(summary?.online)} از ${formatCount(summary?.devices)}`}
            detail="گزارشی در ۲ دقیقهٔ گذشته"
            color="blue"
          />
          <StatCard
            icon="bi-bullseye"
            label="نرخ تشخیص چهره"
            value={percent.format(Number(summary?.avgDetectionRate) || 0)}
            detail="میانگین دستگاه‌های فعال"
            color="green"
          />
          <StatCard
            icon="bi-speedometer2"
            label="سرعت پردازش"
            value={`${number.format(Math.round(Number(summary?.avgFps) || 0))} fps`}
            detail="فریم بر ثانیه"
            color="purple"
          />
          <StatCard
            icon="bi-check2-circle"
            label="ثبت‌های ۲۴ ساعت"
            value={formatCount(summary?.accepted24h)}
            detail={`${formatCount(summary?.rejected24h)} مورد رد شد`}
            color="orange"
          />
        </div>
      )}

      {error && (
        <p className="profile-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !devices.length && !error ? (
        <EmptyState
          icon="bi-camera-video-off"
          title="هنوز گزارشی از دوربین‌ها نرسیده است"
          text="صفحهٔ «تشخیص چهره» یا «دوربین کلاس» را باز کنید تا وضعیت دوربین هر ۱۵ ثانیه به این داشبورد ارسال شود."
        />
      ) : null}

      {devices.length ? (
        <div className="table-responsive">
          <table className="table custom-table align-middle">
            <thead>
              <tr>
                <th>دستگاه</th>
                <th>وضعیت</th>
                <th>دوربین</th>
                <th>مدل</th>
                <th>فریم اسکن‌شده</th>
                <th>چهرهٔ یافته</th>
                <th>ناشناس</th>
                <th>نرخ تشخیص</th>
                <th>fps</th>
                <th>تأخیر</th>
                <th>ثبت / رد (۲۴ ساعت)</th>
                <th>آخرین گزارش</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.deviceId}>
                  <td className="id-cell">{device.deviceId}</td>
                  <td>
                    <Badge tone={device.online ? "success" : "neutral"}>
                      {device.online ? "آنلاین" : "آفلاین"}
                    </Badge>
                  </td>
                  <td>{device.cameraState || "—"}</td>
                  <td>{device.modelStatus || "—"}</td>
                  <td>{formatCount(device.framesScanned)}</td>
                  <td>{formatCount(device.facesDetected)}</td>
                  <td>{formatCount(device.unknownFaces)}</td>
                  <td>
                    {device.detectionRate == null
                      ? "—"
                      : percent.format(Number(device.detectionRate))}
                  </td>
                  <td>
                    {device.fps == null
                      ? "—"
                      : number.format(Number(device.fps).toFixed(1))}
                  </td>
                  <td>
                    {device.latencyMs == null
                      ? "—"
                      : `${number.format(Math.round(Number(device.latencyMs)))} ms`}
                  </td>
                  <td>
                    <Badge tone="success">{formatCount(device.accepted24h)}</Badge>{" "}
                    <Badge tone={device.rejected24h ? "warning" : "neutral"}>
                      {formatCount(device.rejected24h)}
                    </Badge>
                  </td>
                  <td>{formatTime(device.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default CameraHealth;
