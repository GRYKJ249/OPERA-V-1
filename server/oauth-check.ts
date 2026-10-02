import { oauthDiagnostics } from './oauth.ts';
console.log(oauthDiagnostics(process.env.PUBLIC_URL?.trim().replace(/\/+$/, '')).join('\n'));
if (!process.env.PUBLIC_URL) console.log('[oauth] PUBLIC_URL غير مضبوط: ضعه في .env أو Secrets ثم أعد التشغيل');
