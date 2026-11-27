// Lightweight SMTP helper for temporary passwords and password-reset links.
// Uses nodemailer when SMTP env vars are configured; otherwise falls back to
// logging the payload so local deployments can still verify the flow.
//
// Production must configure SMTP: temporary passwords are never returned in
// API responses there, so email is the only delivery channel.

import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASSWORD;
const smtpFrom = process.env.SMTP_FROM || smtpUser || "hozorban@example.com";
const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

let transporter = null;
if (smtpHost) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });
}

// Names are user-supplied; keep them from injecting markup into the email HTML.
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function deliver({ toEmail, subject, text, html, logLabel }) {
  if (!transporter) {
    console.log(`[mail] SMTP not configured; ${logLabel} for ${toEmail}`);
    return { ok: true, delivered: false };
  }

  try {
    await transporter.sendMail({ from: smtpFrom, to: toEmail, subject, text, html });
    return { ok: true, delivered: true };
  } catch (error) {
    console.error("[mail] sendMail failed:", error.message);
    return { ok: false, delivered: false, error: error.message };
  }
}

export async function sendPasswordEmail(toEmail, temporaryPassword, teacherName) {
  const subject = "رمز موقت سامانه حضوربان";
  const html = `
    <div style="font-family:Vazir,sans-serif;direction:rtl;text-align:right">
      <h2>سلام ${escapeHtml(teacherName) || ""}،</h2>
      <p>برای دسترسی به پنل خود، از رمز موقت زیر استفاده کنید:</p>
      <p style="font-size:18px;font-weight:bold;letter-spacing:2px">${temporaryPassword}</p>
      <p>پس از ورود، حتماً رمز خود را عوض کنید.</p>
    </div>
  `;
  const text = `سلام ${teacherName || ""}،\n\nرمز موقت شما: ${temporaryPassword}\n\nپس از ورود حتماً رمز خود را عوض کنید.`;

  return deliver({
    toEmail,
    subject,
    text,
    html,
    logLabel: "would send a temporary password",
  });
}

export async function sendPasswordResetEmail(toEmail, resetLink, name) {
  const subject = "بازیابی رمز عبور سامانه حضوربان";
  const html = `
    <div style="font-family:Vazir,sans-serif;direction:rtl;text-align:right">
      <h2>سلام ${escapeHtml(name) || ""}،</h2>
      <p>برای انتخاب رمز عبور جدید روی پیوند زیر بزنید. این پیوند یک‌بارمصرف است و به‌زودی منقضی می‌شود.</p>
      <p><a href="${resetLink}">بازیابی رمز عبور</a></p>
      <p>اگر این درخواست را شما ارسال نکرده‌اید، این ایمیل را نادیده بگیرید؛ رمز فعلی شما تغییر نمی‌کند.</p>
    </div>
  `;
  const text = `سلام ${name || ""}،\n\nبرای بازیابی رمز عبور از این پیوند استفاده کنید:\n${resetLink}\n\nاگر این درخواست را شما ارسال نکرده‌اید، آن را نادیده بگیرید.`;

  return deliver({
    toEmail,
    subject,
    text,
    html,
    logLabel: `would send a password-reset link (${resetLink})`,
  });
}
