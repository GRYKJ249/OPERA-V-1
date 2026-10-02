/**
 * إرسال البريد عبر Resend (https://resend.com) إن وُجد RESEND_API_KEY.
 * بدونه (للتجربة المحلية) تُطبع الرسالة والرابط في الطرفية.
 * MAIL_FROM مثال: "Opera <no-reply@yourdomain.com>"
 */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`\n[mail] إلى: ${to}\n[mail] الموضوع: ${subject}\n${text}\n`);
    return;
  }
  const r = await fetch(process.env.RESEND_API_URL ?? 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM ?? 'Opera <onboarding@resend.dev>', to, subject, text, ...(html ? { html } : {}) }),
  });
  if (!r.ok) console.error(`[mail] فشل الإرسال عبر Resend (HTTP ${r.status})`);
}
