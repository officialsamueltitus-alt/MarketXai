import nodemailer, { Transporter } from 'nodemailer';

// Gmail SMTP: SMTP_USER is the Gmail address, SMTP_PASS a Google "App password"
// (Google Account → Security → 2-Step Verification → App passwords).
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass: pass.replace(/\s+/g, '') },
  });
  return transporter;
}

export function isMailerConfigured(): boolean {
  return getTransporter() !== null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Fire-and-forget transactional email; failures are logged and never break the request
export async function sendEmail(to: string | undefined | null, subject: string, lines: string[]): Promise<void> {
  const t = getTransporter();
  if (!t || !to) return;
  const from = process.env.SMTP_FROM || `MarketX <${process.env.SMTP_USER}>`;
  const siteUrl = process.env.APP_URL || 'https://marketx.world';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#0b1020;color:#e2e8f0;padding:24px;border-radius:12px;max-width:520px">
      <h2 style="margin:0 0 12px;color:#fff">${escapeHtml(subject)}</h2>
      ${lines.map(l => `<p style="margin:0 0 10px;line-height:1.5">${escapeHtml(l)}</p>`).join('')}
      <p style="margin:18px 0 0"><a href="${escapeHtml(siteUrl)}" style="color:#38bdf8">Open MarketX</a></p>
    </div>`;
  try {
    await t.sendMail({ from, to, subject, text: lines.join('\n\n') + `\n\n${siteUrl}`, html });
  } catch (err: any) {
    console.warn(`[MarketX Mail] Failed to send "${subject}" to ${to}: ${err?.message || err}`);
  }
}
