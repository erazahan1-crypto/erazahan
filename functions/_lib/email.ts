export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PUBLIC_SITE_URL?: string;
}

interface DreamAnswerNotification {
  recipient: string;
  dreamId: string;
  name?: string | null;
  idempotencyKey: string;
}

export type EmailResult =
  | { ok: true; providerId?: string }
  | { ok: false; reason: 'configuration' | 'provider' };

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const SUBJECT = 'Ձեր երազի պատասխանը պատրաստ է';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const publicDreamUrl = (siteUrl: string, dreamId: string): string | null => {
  try {
    const base = new URL(siteUrl);
    if (!['http:', 'https:'].includes(base.protocol)) return null;
    return new URL(`/chgtnvac-erazner/${encodeURIComponent(dreamId)}/`, base).toString();
  } catch {
    return null;
  }
};

export async function sendDreamAnswerNotification(
  env: EmailEnv,
  notification: DreamAnswerNotification,
): Promise<EmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  const dreamUrl = env.PUBLIC_SITE_URL
    ? publicDreamUrl(env.PUBLIC_SITE_URL, notification.dreamId)
    : null;

  if (!apiKey || !from || !dreamUrl) {
    console.error('dream notification email: configuration is incomplete');
    return { ok: false, reason: 'configuration' };
  }

  const displayName = notification.name?.trim();
  const greeting = displayName ? `Բարև, ${displayName}։` : 'Բարև։';
  const text = `${greeting}\n\nՁեր ուղարկած երազի պատասխանը հրապարակվել է։\n\nԿարդալ պատասխանը՝ ${dreamUrl}\n\nԵրազահան`;
  const html = `<!doctype html>
<html lang="hy">
  <body style="margin:0;background:#0a0817;color:#e2e8f0;font-family:Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
      <div style="border:1px solid rgba(255,255,255,.12);border-radius:16px;background:#131029;padding:24px;">
        <p style="margin:0 0 16px;font-size:17px;line-height:1.6;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#cbd5e1;">Ձեր ուղարկած երազի պատասխանը հրապարակվել է։</p>
        <a href="${escapeHtml(dreamUrl)}" style="display:inline-block;min-height:48px;box-sizing:border-box;border-radius:12px;background:#7c3aed;padding:14px 22px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">Կարդալ պատասխանը</a>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;word-break:break-all;">${escapeHtml(dreamUrl)}</p>
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:13px;color:#94a3b8;">Երազահան</p>
    </div>
  </body>
</html>`;

  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': notification.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [notification.recipient],
        subject: SUBJECT,
        html,
        text,
      }),
    });

    if (!response.ok) {
      console.error('dream notification email: provider request failed', response.status);
      return { ok: false, reason: 'provider' };
    }

    const result = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, providerId: result.id };
  } catch {
    console.error('dream notification email: provider request failed');
    return { ok: false, reason: 'provider' };
  }
}
