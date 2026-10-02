/**
 * قوالب البريد. بريد HTML يدعم CSS المضمَّن (inline) فقط وتخطيط الجداول؛
 * أغلب برامج البريد (Gmail وغيره) تمنع JavaScript والخطوط الخارجية، لذلك لا نستخدمهما هنا.
 * نرسل نسخة نصية بسيطة معه (text) للبرامج التي لا تعرض HTML.
 */
const C = { bg: '#05071a', card: '#0b0f2b', fg: '#eef1ff', mut: '#9aa3c7', ln: '#26305f', a: '#6f7bff', b: '#22e3c4', warn: '#ffb547' };
const FONT = "Tahoma,'Segoe UI',Arial,sans-serif";
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** قالب مشترك: شعار + عنوان + محتوى + تذييل */
function shell(o: { preheader: string; title: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
    <tr><td align="center" style="padding:0 0 18px;font-family:${FONT};font-size:30px;font-weight:700;letter-spacing:1px;color:${C.fg};direction:ltr;">Op<span style="color:${C.b};">era</span></td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.ln};border-radius:20px;padding:30px 24px;font-family:${FONT};color:${C.fg};text-align:right;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.5;font-weight:700;color:${C.fg};">${esc(o.title)}</h1>
      ${o.body}
    </td></tr>
    <tr><td align="center" style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:1.8;color:${C.mut};">رسالة آلية من Opera — لا ترد عليها.<br>© 2026 Opera</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** رسالة رمز استعادة كلمة السر */
export function resetCodeEmail(code: string, minutes: number): { subject: string; text: string; html: string } {
  const safe = esc(code);
  const body = `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.9;color:${C.mut};">طلبتَ استعادة كلمة السر. أدخل الرمز التالي في صفحة الاستعادة مع كلمة السر الجديدة:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${C.bg};border:1px solid ${C.b};border-radius:14px;padding:18px 8px;">
        <div dir="ltr" style="font-family:'Courier New',Consolas,monospace;font-size:38px;line-height:1.2;font-weight:700;letter-spacing:10px;color:${C.b};text-align:center;-webkit-user-select:all;user-select:all;">${safe}</div>
      </td></tr></table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.9;color:${C.mut};text-align:center;">اضغط مطولاً على الرمز لنسخه &middot; صالح لمدة <strong style="color:${C.fg};">${minutes} دقيقة</strong> ويُستخدم مرة واحدة.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td style="border-right:3px solid ${C.warn};background:#ffb5471a;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.9;color:${C.fg};">لا تشارك هذا الرمز مع أي أحد. فريق Opera لن يطلبه منك أبداً. وإن لم تطلب الاستعادة فتجاهل الرسالة، حسابك بأمان.</td></tr></table>`;
  return {
    subject: 'رمز استعادة كلمة السر في Opera',
    text: `رمز استعادة كلمة السر:\n\n${code}\n\nالرمز صالح ${minutes} دقيقة. أدخله في صفحة الاستعادة مع كلمة السر الجديدة.\n\nإن لم تطلب ذلك تجاهل الرسالة ولا تشارك الرمز مع أحد.`,
    html: shell({ preheader: `رمزك: ${code} — صالح ${minutes} دقيقة`, title: 'رمز استعادة كلمة السر', body }),
  };
}

/** رسالة رمز تأكيد الحساب الجديد */
export function verifyCodeEmail(code: string, minutes: number): { subject: string; text: string; html: string } {
  const safe = esc(code);
  const body = `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.9;color:${C.mut};">أهلاً بك في Opera. أدخل الرمز التالي في صفحة إنشاء الحساب لتأكيد بريدك:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${C.bg};border:1px solid ${C.b};border-radius:14px;padding:18px 8px;">
        <div dir="ltr" style="font-family:'Courier New',Consolas,monospace;font-size:38px;line-height:1.2;font-weight:700;letter-spacing:10px;color:${C.b};text-align:center;-webkit-user-select:all;user-select:all;">${safe}</div>
      </td></tr></table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.9;color:${C.mut};text-align:center;">اضغط مطولاً على الرمز لنسخه &middot; صالح لمدة <strong style="color:${C.fg};">${minutes} دقيقة</strong> ويُستخدم مرة واحدة.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td style="border-right:3px solid ${C.warn};background:#ffb5471a;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.9;color:${C.fg};">لا تشارك هذا الرمز مع أي أحد. وإن لم تنشئ حساباً في Opera فتجاهل الرسالة.</td></tr></table>`;
  return {
    subject: 'رمز تأكيد حسابك في Opera',
    text: `رمز تأكيد حسابك في Opera:\n\n${code}\n\nالرمز صالح ${minutes} دقيقة. أدخله في صفحة إنشاء الحساب.\n\nإن لم تنشئ حساباً تجاهل الرسالة ولا تشارك الرمز مع أحد.`,
    html: shell({ preheader: `رمزك: ${code} — صالح ${minutes} دقيقة`, title: 'تأكيد حسابك', body }),
  };
}
