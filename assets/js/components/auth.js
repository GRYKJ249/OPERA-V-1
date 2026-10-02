import { $, RM } from '../core/utils.js';
import { t } from '../core/i18n.js';
const AU_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** اهتزاز النموذج عند الخطأ (يُلغى لمن يفضّل تقليل الحركة) */
function shake(form) {
    form.classList.remove('shake');
    void form.offsetWidth;
    if (!RM)
        form.classList.add('shake');
}
/** أزرار العين (data-eye): إظهار/إخفاء الحقل المجاور */
function wireEyes(root) {
    root.querySelectorAll('.eye[data-eye]').forEach(btn => {
        const inp = btn.parentElement?.querySelector('input');
        if (!inp)
            return;
        btn.addEventListener('pointerdown', e => e.preventDefault());
        btn.onclick = () => {
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            btn.classList.toggle('on', show);
            btn.setAttribute('aria-pressed', String(show));
            btn.setAttribute('aria-label', t(show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'));
        };
    });
}
/** تحقق مباشر من صيغة البريد: يظهر التنبيه بعد مغادرة الحقل (بتأخير قصير كي لا تنزاح الأزرار تحت الإصبع) */
function wireEmail(em, hint) {
    let touched = false;
    const paint = () => {
        const v = em.value.trim(), ok = AU_EMAIL.test(v), bad = touched && !!v && !ok;
        em.classList.toggle('bad', bad);
        em.classList.toggle('good', !!v && ok);
        em.setAttribute('aria-invalid', String(bad));
        hint.textContent = bad ? t('صيغة البريد الإلكتروني غير صحيحة.') : '';
    };
    em.addEventListener('input', () => { if (AU_EMAIL.test(em.value.trim()))
        touched = true; paint(); });
    em.addEventListener('blur', () => setTimeout(() => { if (document.activeElement === em)
        return; touched = true; paint(); }, 180));
    em.addEventListener('paintnow', () => { touched = true; paint(); });
}
const ERR = {
    bad_request: 'تحقق من البيانات المدخلة.',
    weak_password: 'كلمة المرور يجب ألا تقل عن 8 أحرف.',
    closed: 'التسجيل مغلق حالياً في هذا الموقع.',
    email_exists: 'هذا البريد مسجّل مسبقاً ولا يمكن استخدامه مرة أخرى.',
    rate_limited: 'محاولات كثيرة. حاول لاحقاً.',
    invalid: 'الرمز غير صحيح أو منتهي. اطلب رمزاً جديداً.',
    network: 'تعذّر الاتصال بالخادم. تأكد أنه يعمل ثم أعد المحاولة.',
};
/** يرسل الطلب للخادم مع مؤشر التحميل، ويرجع true عند النجاح */
let lastReply = null; // آخر رد ناجح أو خطأ من الخادم (لقراءة resumed أو رمز الخطأ)
async function send(go, msg, url, body) {
    go.disabled = true;
    go.classList.add('ld');
    msg.textContent = '';
    lastReply = null;
    try {
        const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => null);
        lastReply = j;
        if (r.ok)
            return true;
        msg.textContent = t(ERR[j?.error] ?? ERR.network);
        return false;
    }
    catch {
        msg.textContent = t(ERR.network);
        return false;
    }
    finally {
        go.disabled = false;
        go.classList.remove('ld');
    }
}
function fail(form, msg, field, text) {
    msg.textContent = t(text);
    shake(form);
    field.focus();
}
/** قوة كلمة المرور من 1 إلى 4 (0 إذا كانت فارغة) */
function strength(v) {
    if (!v)
        return 0;
    let s = 0;
    if (v.length >= 8)
        s++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v))
        s++;
    if (/\d/.test(v))
        s++;
    if (/[^A-Za-z0-9]/.test(v) || v.length >= 14)
        s++;
    return Math.max(1, s);
}
/** إنشاء حساب بخطوتين (مثل نسيت كلمة السر): 1) البيانات، 2) رمز التأكيد (6 أرقام) المرسل للبريد */
function initRegister(form) {
    const nm = $('rgn'), em = $('rge');
    const pw = $('rgp'), cf = $('rgc'), tr = $('rgt');
    const hCf = $('rgch'), msg = $('lgm'), sw = $('rgsw'), bar = $('rgsb'), lab = $('rgst');
    const go = form.querySelector('button[type=submit]');
    const lbl = go.querySelector('span');
    const sub = document.querySelector('#registerpg .sub');
    let tCf = false, busy = false, step = 1;
    let code;
    wireEyes(form);
    wireEmail(em, $('rgeh'));
    const paintCf = () => {
        const bad = tCf && !!cf.value && cf.value !== pw.value;
        cf.classList.toggle('bad', bad);
        cf.classList.toggle('good', !!cf.value && cf.value === pw.value);
        hCf.textContent = bad ? t('كلمتا المرور غير متطابقتين.') : '';
    };
    pw.addEventListener('input', () => {
        const s = strength(pw.value);
        sw.hidden = !s;
        bar.dataset.s = String(s);
        lab.textContent = s ? t(['', 'ضعيفة', 'متوسطة', 'جيدة', 'قوية'][s]) : '';
        paintCf();
    });
    cf.addEventListener('input', () => { tCf = true; paintCf(); });
    /** رفض البريد المكرر: رسالة واضحة + روابط الدخول واستعادة كلمة السر */
    const showExists = () => {
        em.classList.add('bad');
        em.setAttribute('aria-invalid', 'true');
        const a = (href, txt) => { const l = document.createElement('a'); l.className = 'lk'; l.href = href; l.textContent = t(txt); return l; };
        msg.append(' ', a('login.html', 'تسجيل الدخول'), ' · ', a('forgot.html', 'نسيت كلمة السر؟'));
        msg.classList.add('err');
        shake(form);
        em.focus();
    };
    /** الخطوة 2: نخفي بقية الحقول والأزرار الاجتماعية ونعرض حقل الرمز */
    const toStep2 = (resumed) => {
        step = 2;
        em.readOnly = true;
        [nm, pw, cf].forEach(i => { i.parentElement.hidden = true; });
        sw.hidden = true;
        hCf.hidden = true;
        tr.closest('label').hidden = true;
        $('rgo').hidden = true;
        $('rgs').hidden = true;
        $('rgnote').hidden = false;
        code = document.createElement('input');
        code.type = 'text';
        code.inputMode = 'numeric';
        code.maxLength = 6;
        code.autocomplete = 'one-time-code';
        code.placeholder = t('رمز التأكيد (6 أرقام)');
        code.setAttribute('aria-label', code.placeholder);
        code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
        const f = document.createElement('div');
        f.className = 'fld';
        f.append(code);
        em.parentElement.after(f);
        lbl.textContent = t('تأكيد الحساب');
        if (sub)
            sub.textContent = t(resumed ? 'هذا البريد بدأ التسجيل سابقاً ولم يُؤكَّد. أرسلنا إليه رمزاً جديداً من 6 أرقام.' : 'أرسلنا رمزاً من 6 أرقام إلى بريدك. أدخله لتأكيد حسابك.');
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'lk';
        again.textContent = t('لم يصلك الرمز؟ أرسله مجدداً');
        again.onclick = () => { send(again, msg, '/api/auth/resend-code', { email: em.value.trim() }).then(ok => { if (ok)
            msg.textContent = t('أرسلنا رمزاً جديداً إن كان الحساب بانتظار التأكيد.'); }); };
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'lk';
        edit.textContent = t('تعديل البيانات');
        edit.onclick = () => { location.href = 'register.html'; };
        form.append(again, edit);
        code.focus();
    };
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (busy)
            return;
        if (step === 2) {
            if (!/^\d{6}$/.test(code.value))
                return fail(form, msg, code, 'أدخل الرمز المكوّن من 6 أرقام.');
            busy = true;
            send(go, msg, '/api/auth/verify-code', { email: em.value.trim(), code: code.value }).then(ok => {
                busy = false;
                if (ok) {
                    msg.classList.remove('err');
                    msg.textContent = t('تم تأكيد حسابك. جارٍ تحويلك لتسجيل الدخول…');
                    setTimeout(() => location.href = 'login.html?verified=1', 1500);
                }
                else
                    msg.classList.add('err');
            });
            return;
        }
        em.dispatchEvent(new Event('paintnow'));
        tCf = true;
        paintCf();
        if (!nm.value.trim())
            return fail(form, msg, nm, 'أدخل اسمك.');
        if (!AU_EMAIL.test(em.value.trim()))
            return fail(form, msg, em, 'أدخل بريداً إلكترونياً صحيحاً.');
        if (pw.value.length < 8)
            return fail(form, msg, pw, 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
        if (cf.value !== pw.value)
            return fail(form, msg, cf, 'كلمتا المرور غير متطابقتين.');
        if (!tr.checked)
            return fail(form, msg, tr, 'وافق على الشروط للمتابعة.');
        busy = true;
        send(go, msg, '/api/auth/register', { name: nm.value.trim(), email: em.value.trim(), password: pw.value, terms: tr.checked }).then(ok => {
            busy = false;
            if (ok) {
                pw.value = '';
                cf.value = '';
                msg.textContent = '';
                toStep2(!!lastReply?.resumed);
            }
            else {
                msg.classList.add('err');
                if (lastReply?.error === 'email_exists')
                    showExists();
            }
        });
    });
    // جاء من صفحة الدخول بحساب لم يُؤكَّد (?verify=البريد): نرسل رمزاً جديداً وننتقل للخطوة 2 مباشرة
    const vf = new URLSearchParams(location.search).get('verify')?.trim() ?? '';
    if (AU_EMAIL.test(vf)) {
        em.value = vf;
        send(go, msg, '/api/auth/resend-code', { email: vf }).then(ok => { if (ok)
            toStep2(true); });
    }
}
/** نسيت كلمة السر بخطوتين: 1) البريد، 2) الرمز المرسل (6 أرقام) + كلمة السر الجديدة */
function initForgot(form) {
    const em = $('fge'), msg = $('lgm');
    const go = form.querySelector('button[type=submit]');
    const lbl = go.querySelector('span');
    const sub = document.querySelector('#forgotpg .sub');
    let busy = false, step = 1;
    let code, pw, again;
    wireEmail(em, $('fgeh'));
    const toStep2 = () => {
        step = 2;
        em.readOnly = true;
        code = document.createElement('input');
        code.type = 'text';
        code.inputMode = 'numeric';
        code.maxLength = 6;
        code.autocomplete = 'one-time-code';
        code.placeholder = t('رمز الاستعادة (6 أرقام)');
        code.setAttribute('aria-label', code.placeholder);
        code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
        pw = document.createElement('input');
        pw.type = 'password';
        pw.autocomplete = 'new-password';
        pw.placeholder = t('كلمة المرور الجديدة');
        pw.setAttribute('aria-label', pw.placeholder);
        const f1 = document.createElement('div');
        f1.className = 'fld';
        f1.append(code);
        const f2 = document.createElement('div');
        f2.className = 'fld';
        f2.append(pw);
        em.parentElement.after(f1, f2);
        lbl.textContent = t('حفظ كلمة المرور');
        if (sub)
            sub.textContent = t('إذا كان البريد مسجلاً وخدمة الإرسال متاحة، سيصلك رمز من 6 أرقام. أدخله مع كلمة المرور الجديدة.');
        again = document.createElement('button');
        again.type = 'button';
        again.className = 'lk';
        again.textContent = t('لم يصلك الرمز؟ أرسله مجدداً');
        again.onclick = () => { send(again, msg, '/api/auth/forgot', { email: em.value.trim() }).then(ok => { if (ok)
            msg.textContent = t('إذا كان البريد مسجلاً وخدمة الإرسال متاحة، سيصلك رمز جديد.'); }); };
        form.append(again);
        code.focus();
    };
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (busy)
            return;
        if (step === 1) {
            em.dispatchEvent(new Event('paintnow'));
            if (!AU_EMAIL.test(em.value.trim()))
                return fail(form, msg, em, 'أدخل بريداً إلكترونياً صحيحاً.');
            busy = true;
            send(go, msg, '/api/auth/forgot', { email: em.value.trim() }).then(ok => {
                busy = false;
                if (ok) {
                    msg.textContent = '';
                    toStep2();
                }
            });
            return;
        }
        if (!/^\d{6}$/.test(code.value))
            return fail(form, msg, code, 'أدخل الرمز المكوّن من 6 أرقام.');
        if (pw.value.length < 8)
            return fail(form, msg, pw, 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
        busy = true;
        send(go, msg, '/api/auth/reset', { email: em.value.trim(), code: code.value, password: pw.value }).then(ok => {
            busy = false;
            if (ok) {
                msg.textContent = t('تم تغيير كلمة المرور. جارٍ تحويلك لتسجيل الدخول…');
                setTimeout(() => location.href = 'login.html', 1500);
            }
        });
    });
    if (matchMedia('(pointer:fine)').matches)
        em.focus();
}
/** صفحتا «مستخدم جديد» و«نسيت كلمة السر» (مربوطة بالخادم /api/auth/*) */
export function initAuth() {
    const rg = document.getElementById('rgf');
    const fg = document.getElementById('fgf');
    if (rg)
        initRegister(rg);
    if (fg)
        initForgot(fg);
}
