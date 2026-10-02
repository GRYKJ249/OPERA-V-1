import { sendMail } from './mailer.ts';
import { resetCodeEmail } from './mail-templates.ts';
const to = process.argv[2] ?? process.env.OWNER_EMAIL;
if (!to) { console.error('usage: npm run mail:test -- you@example.com'); process.exit(1); }
// رسالة تجريبية بنفس تصميم رسالة رمز الاستعادة (الرمز هنا للتجربة فقط)
const m = resetCodeEmail('123456', 15);
await sendMail(to, 'تجربة: ' + m.subject, m.text, m.html);
console.log('done (check the terminal above for any [mail] error)');
