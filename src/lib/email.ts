import type { SiteConfig } from './config-schema';
import { escapeHtml } from './format';

/**
 * Optional branded email via Resend (https://resend.com). When RESEND_API_KEY is not set
 * the storefront relies on eSimDistributor's white-labelled email (`sendEmail: true`).
 */

export interface EmailSettings {
  resendApiKey: string;
  from: string;
}

export async function sendEmail(
  settings: EmailSettings,
  msg: { to: string; subject: string; html: string; text: string; replyTo?: string },
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<void> {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: settings.from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      reply_to: msg.replyTo,
    }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

export function orderLinkEmail(config: SiteConfig, opts: { planName: string; orderNumber: string; link: string }) {
  const brand = escapeHtml(config.brandName);
  const plan = escapeHtml(opts.planName);
  const link = escapeHtml(opts.link);
  const color = config.primaryColor;
  const subject = `Your ${config.brandName} eSIM is ready — order ${opts.orderNumber}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;padding:28px">
<tr><td>
${config.logoUrl && /^https?:/.test(config.logoUrl) ? `<img src="${escapeHtml(config.logoUrl)}" alt="${brand}" height="36" style="display:block;margin-bottom:20px">` : `<p style="font-size:20px;font-weight:700;margin:0 0 20px">${brand}</p>`}
<h1 style="font-size:22px;margin:0 0 12px">Your eSIM is ready</h1>
<p style="margin:0 0 8px">Thanks for your order <strong>${escapeHtml(opts.orderNumber)}</strong> — <strong>${plan}</strong>.</p>
<p style="margin:0 0 20px">Open your order page to scan the QR code and follow the install steps. Install the eSIM before you travel; the plan starts when it first connects at your destination.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View my eSIM</a></p>
<p style="font-size:13px;color:#555;margin:0 0 4px">Keep this email: the link is your private access to the QR code.</p>
<p style="font-size:13px;color:#555;margin:0">Need help? Reply to this email or write to <a href="mailto:${escapeHtml(config.supportEmail)}">${escapeHtml(config.supportEmail)}</a>.</p>
</td></tr></table>
<p style="font-size:12px;color:#777;margin:16px 0 0">${escapeHtml(config.legal.companyName)} · ${escapeHtml(config.legal.address)}</p>
</td></tr></table></body></html>`;
  const text = `Your eSIM is ready (order ${opts.orderNumber}, ${opts.planName}).

Open your order page to scan the QR code and follow the install steps:
${opts.link}

Keep this email: the link is your private access to the QR code.
Help: ${config.supportEmail}
${config.legal.companyName}, ${config.legal.address}`;
  return { subject, html, text };
}
