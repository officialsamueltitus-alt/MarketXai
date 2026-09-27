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

export interface EmailOptions {
  /** Main call-to-action button */
  cta?: { label: string; url: string };
  /** Key/value rows shown as a compact table (e.g. a trade setup) */
  rows?: [string, string][];
  /** Small print under the message */
  note?: string;
}

// Fire-and-forget transactional email; failures are logged and never break the request
export async function sendEmail(to: string | undefined | null, subject: string, lines: string[], options: EmailOptions = {}): Promise<void> {
  const t = getTransporter();
  if (!t || !to) return;
  const from = process.env.SMTP_FROM || `MarketX <${process.env.SMTP_USER}>`;
  const siteUrl = (process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '');
  const cta = options.cta || { label: 'Open MarketX', url: siteUrl };
  const para = (l: string) =>
    /^https?:\/\//.test(l)
      ? `<p style="margin:0 0 14px;word-break:break-all"><a href="${escapeHtml(l)}" style="color:#a78bfa">${escapeHtml(l)}</a></p>`
      : `<p style="margin:0 0 14px;line-height:1.6;color:#d4d4d8;font-size:15px">${escapeHtml(l)}</p>`;
  const rows = options.rows?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 18px;border:1px solid #27272a;border-radius:12px;border-collapse:separate;overflow:hidden">
        ${options.rows
          .map(
            ([k, v], i) =>
              `<tr><td style="padding:10px 14px;color:#a1a1aa;font-size:13px;${i ? 'border-top:1px solid #27272a;' : ''}">${escapeHtml(k)}</td><td style="padding:10px 14px;color:#fafafa;font-size:13px;font-weight:600;text-align:right;${i ? 'border-top:1px solid #27272a;' : ''}">${escapeHtml(v)}</td></tr>`
          )
          .join('')}
      </table>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#09090b">
  <div style="background:#09090b;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto">
      <div style="padding:0 4px 18px">
        <img src="${escapeHtml(siteUrl)}/brand/marketx-logo-64.png" width="28" height="28" alt="" style="vertical-align:middle;border:0">
        <span style="vertical-align:middle;margin-left:8px;color:#fafafa;font-size:17px;font-weight:700">Market<span style="color:#a78bfa">X</span></span>
      </div>
      <div style="background:#131316;border:1px solid #27272a;border-radius:20px;padding:28px 24px">
        <h1 style="margin:0 0 16px;color:#fafafa;font-size:20px;line-height:1.35;font-weight:700">${escapeHtml(subject)}</h1>
        ${lines.map(para).join('')}
        ${rows}
        <a href="${escapeHtml(cta.url)}" style="display:inline-block;margin-top:6px;background:#fafafa;color:#09090b;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px">${escapeHtml(cta.label)}</a>
        ${options.note ? `<p style="margin:20px 0 0;color:#71717a;font-size:12px;line-height:1.5">${escapeHtml(options.note)}</p>` : ''}
      </div>
      <p style="margin:18px 4px 0;color:#52525b;font-size:11px;line-height:1.5">You're receiving this because you have a MarketX account. Trading involves risk; MarketX analyses are not financial advice.</p>
    </div>
  </div></body></html>`;
  const text = [
    subject,
    '',
    ...lines,
    ...(options.rows || []).map(([k, v]) => `${k}: ${v}`),
    '',
    `${cta.label}: ${cta.url}`,
    ...(options.note ? ['', options.note] : []),
  ].join('\n');
  try {
    await t.sendMail({ from, to, subject, text, html });
  } catch (err: any) {
    console.warn(`[MarketX Mail] Failed to send "${subject}" to ${to}: ${err?.message || err}`);
  }
}
