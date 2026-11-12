// Lightweight SMTP helper for sending temporary passwords.
// Uses nodemailer when SMTP env vars are configured; otherwise falls back to
// logging the payload so local deployments can still verify the flow.

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

export async function sendPasswordEmail(toEmail, temporaryPassword, teacherName) {
  const subject = "رمز موقت سامانه حضوربان";
  const html = `
    <div style="font-family:Vazir,sans-serif;direction:rtl;text-align:right">
      <h2>سلام ${teacherName || ""}،</h2>
      <p>برای دسترسی به پنل خود، از رمز موقت زیر استفاده کنید:</p>
      <p style="font-size:18px;font-weight:bold;letter-spacing:2px">${temporaryPassword}</p>
      <p>پس از ورود، حتماً رمز خود را عوض کنید.</p>
    </div>
  `;
  const text = `سلام ${teacherName || ""}،\n\nرمز موقت شما: ${temporaryPassword}\n\nپس از ورود حتماً رمز خود را عوض کنید.`;

  if (!transporter) {
    console.log(`[mail] SMTP not configured; would send to ${toEmail} with password ${temporaryPassword}`);
    return { ok: true, delivered: false };
  }

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: toEmail,
      subject,
      text,
      html,
    });
    return { ok: true, delivered: true };
  } catch (error) {
    console.error("[mail] sendMail failed:", error.message);
    return { ok: false, delivered: false, error: error.message };
  }
}