import nodemailer, { Transporter } from 'nodemailer';
import { createMailQueue, MailPriority } from './mailQueue';
import { perWorker } from './workers';

// One paced queue for all outgoing mail (see mailQueue.ts). Gmail allows roughly 20 messages/minute sustained.
const mailQueue = createMailQueue({
  perMinute: perWorker(Math.max(1, Math.floor(Number(process.env.SMTP_MAX_PER_MINUTE) || 20))),
  concurrency: 2,
  lowBacklogMax: 300,
  lowPerRecipientMs: 5 * 60 * 1000,
});
export const mailQueueStats = () => mailQueue.stats();

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

const IMAGE_CID = 'announcement-image@marketx';

export interface EmailOptions {
  /** Main call-to-action button */
  cta?: { label: string; url: string };
  /** Key/value rows shown as a compact table (e.g. a trade setup) */
  rows?: [string, string][];
  /** Small print under the message */
  note?: string;
  /** A one-time code shown large and monospaced (e.g. an access pass code) */
  code?: string;
  /** 'low' for activity mail (paced, deduplicated, droppable); everything else is 'high' */
  priority?: MailPriority;
  /** A picture embedded in the message (sent as an inline attachment, so it shows without loading remote images);
   *  href opens the full original when tapped */
  image?: { data: Buffer; contentType: string; alt?: string; href?: string };
}

// Transactional email; failures are logged and never break the request. Resolves true when sent.
export async function sendEmail(to: string | undefined | null, subject: string, lines: string[], options: EmailOptions = {}): Promise<boolean> {
  const t = getTransporter();
  if (!t || !to) return false;
  const from = process.env.SMTP_FROM || `MarketX <${process.env.SMTP_USER}>`;
  const siteUrl = (process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '');
  const cta = options.cta || { label: 'Open MarketX', url: siteUrl };
  // Dark in every mail app: tables with bgcolor (Outlook ignores div backgrounds), "dark only" colour scheme (Apple Mail,
  // Outlook.com), a solid gradient image as the background (the Gmail apps recolour background colours but not images),
  // and a Gmail iOS blend fix that keeps the white text white. All writing is white or near white.
  const BG = '#07070b';
  const CARD = '#121218';
  const LINE = '#2a2a35';
  const bgFill = (c: string) => `background-color:${c};background-image:linear-gradient(${c},${c});`;
  const para = (l: string) =>
    /^https?:\/\//.test(l)
      ? `<p style="margin:0 0 14px;word-break:break-all"><a href="${escapeHtml(l)}" style="color:#c4b5fd">${escapeHtml(l)}</a></p>`
      : `<p style="margin:0 0 14px;line-height:1.6;color:#ffffff;font-size:15px">${escapeHtml(l)}</p>`;
  const rows = options.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="width:100%;margin:4px 0 18px;border:1px solid ${LINE};border-radius:12px;border-collapse:separate;${bgFill(BG)}">
        ${options.rows
          .map(
            ([k, v], i) =>
              `<tr><td style="padding:10px 14px;color:#e4e4e7;font-size:13px;${i ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(k)}</td><td style="padding:10px 14px;color:#ffffff;font-size:13px;font-weight:700;text-align:right;${i ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(v)}</td></tr>`
          )
          .join('')}
      </table>`
    : '';
  const html = `<!doctype html><html lang="en" style="color-scheme:dark only;${bgFill(BG)}"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark only"><meta name="supported-color-schemes" content="dark only">
  <style>
    :root { color-scheme: dark only; supported-color-schemes: dark only; }
    body, .mx-bg { background-color: ${BG} !important; }
    .mx-card { background-color: ${CARD} !important; }
    .mx-text, .mx-text p, .mx-text h1, .mx-text td { color: #ffffff !important; }
    u + .body .mx-gs { background: #000; mix-blend-mode: screen; }
    u + .body .mx-gd { background: #000; mix-blend-mode: difference; }
    [data-ogsc] .mx-text, [data-ogsc] .mx-text p, [data-ogsc] .mx-text h1 { color: #ffffff !important; }
    [data-ogsb] .mx-bg { background-color: ${BG} !important; }
    [data-ogsb] .mx-card { background-color: ${CARD} !important; }
  </style></head>
  <body class="body mx-bg" bgcolor="${BG}" style="margin:0;padding:0;${bgFill(BG)}">
  <table role="presentation" class="mx-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="width:100%;${bgFill(BG)}"><tr><td align="center" bgcolor="${BG}" style="padding:28px 12px;${bgFill(BG)}font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td align="left">
      <div style="padding:0 4px 18px">
        <img src="${escapeHtml(siteUrl)}/brand/marketx-logo-64.png" width="28" height="28" alt="" style="vertical-align:middle;border:0">
        <span style="vertical-align:middle;margin-left:8px;color:#ffffff;font-size:17px;font-weight:700">Market<span style="color:#a78bfa">X</span></span>
      </div>
      <table role="presentation" class="mx-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="width:100%;border:1px solid ${LINE};border-radius:20px;border-collapse:separate;${bgFill(CARD)}"><tr><td class="mx-card mx-text" bgcolor="${CARD}" style="padding:28px 24px;border-radius:20px;${bgFill(CARD)}">
        <div class="mx-gs"><div class="mx-gd">
        <h1 style="margin:0 0 16px;color:#ffffff;font-size:20px;line-height:1.35;font-weight:700">${escapeHtml(subject)}</h1>
        </div></div>
        ${
          options.image
            ? (() => {
                // The whole picture always shows (full width, natural height, never cropped); tapping opens the original
                const img = `<img src="cid:${IMAGE_CID}" alt="${escapeHtml(options.image.alt || '')}" width="472" style="display:block;width:100%;max-width:472px;height:auto;border-radius:14px;border:0">`;
                const href = options.image.href && /^https:\/\//.test(options.image.href) ? escapeHtml(options.image.href) : '';
                return href
                  ? `<a href="${href}" target="_blank" style="display:block;text-decoration:none">${img}</a><p style="margin:8px 0 18px;font-size:12px"><a href="${href}" target="_blank" style="color:#c4b5fd">Tap to view the full picture</a></p>`
                  : `<div style="margin:0 0 18px">${img}</div>`;
              })()
            : ''
        }
        <div class="mx-gs"><div class="mx-gd">
        ${lines.map(para).join('')}
        ${
          options.code
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="width:100%;margin:6px 0 20px;border:1px dashed #4b4b5a;border-radius:14px;border-collapse:separate;${bgFill(BG)}"><tr><td align="center" style="padding:18px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#ffffff">${escapeHtml(options.code)}</td></tr></table>`
            : ''
        }
        ${rows}
        </div></div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px"><tr><td bgcolor="#7c3aed" style="border-radius:999px;background-color:#7c3aed;background-image:linear-gradient(95deg,#7c3aed,#4f46e5)">
          <a href="${escapeHtml(cta.url)}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:999px">${escapeHtml(cta.label)}</a>
        </td></tr></table>
        ${options.note ? `<p style="margin:20px 0 0;color:#d4d4d8;font-size:12px;line-height:1.5">${escapeHtml(options.note)}</p>` : ''}
      </td></tr></table>
      <p style="margin:18px 4px 0;color:#a1a1aa;font-size:11px;line-height:1.5">You're receiving this because you have a MarketX account. Trading involves risk; MarketX analyses are not financial advice.</p>
    </td></tr></table>
  </td></tr></table></body></html>`;
  const text = [
    subject,
    '',
    ...lines,
    ...(options.image?.href ? ['', `View the full picture: ${options.image.href}`] : []),
    ...(options.code ? ['', `    ${options.code}`, ''] : []),
    ...(options.rows || []).map(([k, v]) => `${k}: ${v}`),
    '',
    `${cta.label}: ${cta.url}`,
    ...(options.note ? ['', options.note] : []),
  ].join('\n');
  return mailQueue.enqueue(to, options.priority === 'low' || options.priority === 'bulk' ? options.priority : 'high', async () => {
    try {
      const ext = options.image ? options.image.contentType.split('/')[1].replace('jpeg', 'jpg') : '';
      const attachments = options.image
        ? [{ filename: `marketx-announcement.${ext}`, content: options.image.data, contentType: options.image.contentType, cid: IMAGE_CID }]
        : undefined;
      await t.sendMail({ from, to, subject, text, html, ...(attachments ? { attachments } : {}) });
      return true;
    } catch (err: any) {
      console.warn(`[MarketX Mail] Failed to send "${subject}" to ${to}: ${err?.message || err}`);
      return false;
    }
  });
}
