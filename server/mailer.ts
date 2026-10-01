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
  // Light, clean layout in every mail app: white card on a soft white page, dark readable text, brand accents.
  // Tables with bgcolor (Outlook ignores div backgrounds) and "light only" so mail apps don't flip it dark.
  const PAGE = '#f6f6f9';
  const CARD = '#ffffff';
  const LINE = '#e9e9f0';
  const INK = '#0f0f14';
  const BODY = '#3f3f46';
  const MUTED = '#71717a';
  const VIOLET = '#7c3aed';
  const para = (l: string) =>
    /^https?:\/\//.test(l)
      ? `<p style="margin:0 0 16px;word-break:break-all;font-size:14px"><a href="${escapeHtml(l)}" style="color:${VIOLET};text-decoration:underline">${escapeHtml(l)}</a></p>`
      : `<p style="margin:0 0 16px;line-height:1.65;color:${BODY};font-size:15px">${escapeHtml(l)}</p>`;
  const rows = options.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 22px;border:1px solid ${LINE};border-radius:14px;border-collapse:separate;overflow:hidden">
        ${options.rows
          .map(
            ([k, v], i) =>
              `<tr><td style="padding:12px 16px;color:${MUTED};font-size:13px;${i ? `border-top:1px solid ${LINE};` : ''}${i % 2 ? 'background:#fbfbfd;' : ''}">${escapeHtml(k)}</td><td style="padding:12px 16px;color:${INK};font-size:13px;font-weight:700;text-align:right;${i ? `border-top:1px solid ${LINE};` : ''}${i % 2 ? 'background:#fbfbfd;' : ''}">${escapeHtml(v)}</td></tr>`
          )
          .join('')}
      </table>`
    : '';
  const html = `<!doctype html><html lang="en" style="color-scheme:light only"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
  <style>:root { color-scheme: light only; supported-color-schemes: light only; } a { color: ${VIOLET}; }</style></head>
  <body bgcolor="${PAGE}" style="margin:0;padding:0;background-color:${PAGE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="width:100%;background-color:${PAGE}"><tr><td align="center" style="padding:32px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%"><tr><td align="left">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 4px 18px"><tr>
        <td style="vertical-align:middle"><img src="${escapeHtml(siteUrl)}/brand/marketx-logo-64.png?v=3" width="34" height="34" alt="" style="display:block;border:0"></td>
        <td style="vertical-align:middle;padding-left:10px;color:${INK};font-size:19px;font-weight:800;letter-spacing:-.3px">Market<span style="color:${VIOLET}">X</span></td>
        <td style="vertical-align:middle;padding-left:8px"><span style="display:inline-block;padding:3px 8px;border-radius:999px;background:#f1edff;color:#6d28d9;font-size:11px;font-weight:700;letter-spacing:.6px">SI</span></td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="width:100%;background-color:${CARD};border:1px solid ${LINE};border-radius:20px;border-collapse:separate;overflow:hidden;box-shadow:0 8px 30px rgba(20,20,40,.06)">
        <tr><td height="5" style="height:5px;line-height:5px;font-size:0;background-color:${VIOLET};background-image:linear-gradient(90deg,#7c3aed,#6366f1 50%,#06b6d4)">&nbsp;</td></tr>
        <tr><td style="padding:30px 28px 28px">
        <h1 style="margin:0 0 18px;color:${INK};font-size:22px;line-height:1.3;font-weight:800;letter-spacing:-.3px">${escapeHtml(subject)}</h1>
        ${
          options.image
            ? (() => {
                // The whole picture always shows (full width, natural height, never cropped); tapping opens the original
                const img = `<img src="cid:${IMAGE_CID}" alt="${escapeHtml(options.image.alt || '')}" width="504" style="display:block;width:100%;max-width:504px;height:auto;border-radius:14px;border:1px solid ${LINE}">`;
                const href = options.image.href && /^https:\/\//.test(options.image.href) ? escapeHtml(options.image.href) : '';
                return href
                  ? `<a href="${href}" target="_blank" style="display:block;text-decoration:none">${img}</a><p style="margin:8px 0 20px;font-size:12px"><a href="${href}" target="_blank" style="color:${VIOLET}">Tap to view the full picture</a></p>`
                  : `<div style="margin:0 0 20px">${img}</div>`;
              })()
            : ''
        }
        ${lines.map(para).join('')}
        ${
          options.code
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 22px;border:1px dashed #c4b5fd;border-radius:14px;border-collapse:separate;background-color:#f7f5ff"><tr><td align="center" style="padding:20px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:3px;white-space:nowrap;color:#4c1d95">${escapeHtml(options.code)}</td></tr></table>`
            : ''
        }
        ${rows}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px"><tr><td bgcolor="${VIOLET}" style="border-radius:12px;background-color:${VIOLET};background-image:linear-gradient(95deg,#7c3aed,#4f46e5)">
          <a href="${escapeHtml(cta.url)}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:12px">${escapeHtml(cta.label)} &rarr;</a>
        </td></tr></table>
        ${options.note ? `<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid ${LINE};color:${MUTED};font-size:13px;line-height:1.55">${escapeHtml(options.note)}</p>` : ''}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr><td align="center" style="padding:22px 10px 0">
        <p style="margin:0 0 8px;font-size:13px;color:${BODY};font-weight:600">MarketX SI &middot; Super Intelligence for traders</p>
        <p style="margin:0 0 12px;font-size:12px">
          <a href="${escapeHtml(siteUrl)}" style="color:${VIOLET};text-decoration:none">marketx.world</a>
          <span style="color:#c4c4cc">&nbsp;&middot;&nbsp;</span>
          <a href="https://x.com/_MarketX" style="color:${VIOLET};text-decoration:none">@_MarketX</a>
          <span style="color:#c4c4cc">&nbsp;&middot;&nbsp;</span>
          <a href="mailto:help.marketx@gmail.com" style="color:${VIOLET};text-decoration:none">Support</a>
        </p>
        <p style="margin:0;color:#a1a1aa;font-size:11px;line-height:1.55">You're receiving this because you have a MarketX account. Trading involves risk; MarketX analyses are not financial advice.</p>
      </td></tr></table>
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
