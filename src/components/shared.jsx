import React from 'react';
export class AppErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error("Application render failed", error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="fatal-error-screen" dir="rtl" role="alert"><span><i className="bi bi-exclamation-triangle" /></span><h1>صفحه با خطا روبه‌رو شد</h1><p>اطلاعات ذخیره‌شده پاک نشده است. صفحه را دوباره بارگذاری کنید؛ اگر مشکل ادامه داشت، نسخهٔ پشتیبان را بازیابی کنید.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>بارگذاری دوباره</button></main>;
  }
}
export function Icon({ name, className = "" }) {
  return <i className={`bi ${name} ${className}`} aria-hidden="true" />;
}
export function Badge({ children, tone = "success" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
export function PanelTitle({ eyebrow, title, description, action }) {
  return (
    <div className="panel-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function StatCard({ icon, label, value, detail, trend, color = "blue" }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>
        <Icon name={icon} />
      </div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>
          {trend && <b>{trend}</b>} {detail}
        </small>
      </div>
      <div className="stat-decoration" />
    </div>
  );
}
export function EmptyState({ icon = "bi-inbox", title, text }) {
  return (
    <div className="empty-state">
      <span>
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

