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
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body bgcolor="#f5f5f7" style="margin:0;padding:0;background-color:#f5f5f7;color:#18181b;font-family:Arial,'Noto Sans Armenian',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f7" style="width:100%;background-color:#f5f5f7;">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
            <tr>
              <td bgcolor="#ffffff" style="padding:24px;background-color:#ffffff;border-radius:16px;">
                <p style="margin:0 0 24px;color:#6d28d9;font-size:15px;line-height:22px;font-weight:700;">Երազահան</p>
                <p style="margin:0 0 14px;color:#18181b;font-size:17px;line-height:26px;font-weight:600;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 24px;color:#27272a;font-size:16px;line-height:24px;">Ձեր ուղարկած երազի պատասխանը պատրաստ է։</p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#7c3aed" style="background-color:#7c3aed;border-radius:12px;">
                      <a href="${escapeHtml(dreamUrl)}" style="display:inline-block;padding:14px 22px;color:#ffffff!important;background-color:#7c3aed;border-radius:12px;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;">Կարդալ պատասխանը</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:22px 0 0;color:#52525b;font-size:14px;line-height:21px;">Կոճակը ձեզ կտանի ձեր երազի ամբողջական պատասխանին։</p>
                <p style="margin:10px 0 0;color:#71717a;font-size:13px;line-height:20px;">
                  <a href="${escapeHtml(dreamUrl)}" style="color:#6d28d9!important;text-decoration:underline;">Եթե կոճակը չի աշխատում, բացեք պատասխանի էջը</a>
                </p>
                <p style="margin:24px 0 0;padding-top:18px;border-top:1px solid #e4e4e7;color:#71717a;font-size:13px;line-height:20px;">Երազահան</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
