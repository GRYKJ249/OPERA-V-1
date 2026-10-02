import { $, ls } from '../core/utils.js';
import { t } from '../core/i18n.js';
const KEY = 'op-oai-key', MODEL = 'op-oai-model';
type Msg = { role: 'user' | 'assistant'; content: string };
/** دردشة مع OpenAI API مباشرة من المتصفح: المفتاح يكتبه الزائر ويبقى على جهازه فقط */
export function initChat(root: HTMLElement | null = document.getElementById('chat')): void {
    if (!root)
        return;
    root.innerHTML = `<div class="ch">
<details class="chk"><summary>${t('إعدادات الاتصال')}</summary>
<p>${t('اكتب مفتاح OpenAI API ليعمل الدردشة. يُحفظ على جهازك فقط ويُرسل إلى OpenAI مباشرة.')}</p>
<input id="chkey" type="password" dir="ltr" autocomplete="off" placeholder="sk-..." aria-label="API key">
<input id="chmod" type="text" dir="ltr" autocomplete="off" placeholder="gpt-4o-mini" aria-label="${t('النموذج')}">
<div class="chb"><button type="button" class="btn pri" id="chsv">${t('حفظ')}</button><button type="button" class="btn" id="chcl">${t('مسح المفتاح')}</button></div></details>
<div class="chm" id="chm" role="log" aria-live="polite"></div>
<form class="chf" id="chf"><textarea id="chin" rows="1" placeholder="${t('اكتب رسالتك...')}" aria-label="${t('اكتب رسالتك...')}"></textarea><button class="btn pri" id="chsd">${t('إرسال')}</button></form>
<button type="button" class="chnew" id="chnew">${t('محادثة جديدة')}</button></div>`;
    const key = $('chkey') as HTMLInputElement, mod = $('chmod') as HTMLInputElement, box = $('chm')!, inp = $('chin') as HTMLTextAreaElement, sd = $('chsd') as HTMLButtonElement;
    key.value = ls(KEY) || '';
    mod.value = ls(MODEL) || '';
    const details = root.querySelector('details')!;
    if (!key.value)
        details.open = true;
    let hist: Msg[] = [], busy = false;
    const add = (role: string, text: string) => {
        const d = document.createElement('div');
        d.className = 'cm ' + role;
        d.dir = 'auto';
        d.textContent = text;
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
        return d;
    };
    $('chsv')!.onclick = () => { ls(KEY, key.value.trim()); ls(MODEL, mod.value.trim()); details.open = false; };
    $('chcl')!.onclick = () => { key.value = ''; ls(KEY, ''); details.open = true; };
    $('chnew')!.onclick = () => { hist = []; box.textContent = ''; };
    const send = async () => {
        const text = inp.value.trim();
        if (!text || busy)
            return;
        const k = key.value.trim();
        if (!k) {
            details.open = true;
            add('err', t('أدخل مفتاح API أولاً.'));
            return;
        }
        ls(KEY, k);
        ls(MODEL, mod.value.trim());
        busy = true;
        sd.disabled = true;
        inp.value = '';
        hist.push({ role: 'user', content: text });
        add('me', text);
        const out = add('bot', '…');
        let acc = '';
        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k },
                body: JSON.stringify({ model: mod.value.trim() || 'gpt-4o-mini', messages: hist, stream: true })
            });
            if (!res.ok || !res.body) {
                out.className = 'cm err';
                out.textContent = res.status === 401 ? t('المفتاح غير صحيح أو منتهي.') : res.status === 429 ? t('تجاوزت الحد المسموح أو لا يوجد رصيد.') : t('حدث خطأ') + ' (' + res.status + ')';
                hist.pop();
                return;
            }
            const rd = res.body.getReader(), dec = new TextDecoder();
            let buf = '';
            for (;;) {
                const { done, value } = await rd.read();
                if (done)
                    break;
                buf += dec.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() || '';
                for (const l of lines) {
                    if (!l.startsWith('data:'))
                        continue;
                    const d = l.slice(5).trim();
                    if (d === '[DONE]')
                        continue;
                    try {
                        acc += JSON.parse(d).choices?.[0]?.delta?.content || '';
                    }
                    catch { /* */ }
                    out.textContent = acc || '…';
                    box.scrollTop = box.scrollHeight;
                }
            }
            hist.push({ role: 'assistant', content: acc });
        }
        catch {
            out.className = 'cm err';
            out.textContent = t('تعذّر الاتصال بـ OpenAI.');
            hist.pop();
        }
        finally {
            busy = false;
            sd.disabled = false;
            inp.focus();
        }
    };
    $('chf')!.addEventListener('submit', e => { e.preventDefault(); send(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
}
