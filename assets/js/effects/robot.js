import { RM } from '../core/utils.js';
import { t } from '../core/i18n.js';
/**
 * مرشد Opera: روبوت كرتوني ثلاثي الأبعاد ثابت في ركن كل الصفحات (مبني من أشكال Three.js بدون ملفات نماذج).
 * يطفو ويرمش ويتابع المؤشر. عند الضغط عليه يلوّح ويفتح قائمة اختصارات تنقل الزائر للأقسام المهمة.
 */
export function initRobot() {
    if (typeof THREE === 'undefined')
        return;
    const wrap = document.createElement('div');
    wrap.id = 'guide';
    const cv = document.createElement('canvas');
    cv.id = 'bot';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gbtn';
    btn.setAttribute('aria-label', t('مساعدة'));
    wrap.append(cv, btn);
    document.body.appendChild(wrap);
    // الفقاعة: ترحيب + اختصارات (الصفحات الفرعية تحت /pages/ فتحتاج بادئة للرجوع للرئيسية)
    const pre = location.pathname.includes('/pages/') ? '../' : '';
    const links = [['المعرض', 'gallery'], ['خدماتي', 'why'], ['الباقات', 'plans'], ['أسئلة', 'faq'], ['تواصل معي', 'contact']];
    const bub = document.createElement('div');
    bub.id = 'gb';
    bub.setAttribute('role', 'dialog');
    bub.innerHTML = `<p>${t('أهلاً! أنا روبوت Opera. وين تحب تروح؟')}</p><div>${links.map(([n, id]) => `<a href="${pre}index.html#${id}">${t(n)}</a>`).join('')}</div>`;
    wrap.appendChild(bub);
    const hint = document.createElement('span');
    hint.className = 'gtip';
    hint.textContent = t('اضغط عليّ للمساعدة');
    wrap.appendChild(hint);
    setTimeout(() => hint.classList.add('on'), 5000);
    setTimeout(() => hint.classList.remove('on'), 11000);
    const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, .1, 50);
    cam.position.set(0, .15, 7.2);
    // الإضاءة
    sc.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1040, .95));
    const key = new THREE.DirectionalLight(0xffffff, .85);
    key.position.set(2.5, 3.5, 4);
    sc.add(key);
    const rimA = new THREE.PointLight(0x22e3c4, 1.1, 14);
    rimA.position.set(-3.5, .5, 2);
    sc.add(rimA);
    const rimB = new THREE.PointLight(0x6f7bff, 1.1, 14);
    rimB.position.set(3.5, -1, 2);
    sc.add(rimB);
    // المواد
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .35, metalness: .15, ...extra });
    const white = mat(0xf2f5ff), blue = mat(0x6f7bff, { roughness: .4 }), dark = mat(0x0b0f2b, { roughness: .15, metalness: .5 });
    const glow = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: .3 });
    const teal = glow(0x22e3c4), amber = glow(0xffb547);
    const mesh = (g, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
        const o = new THREE.Mesh(g, m);
        o.position.set(x, y, z);
        o.scale.set(sx, sy, sz);
        return o;
    };
    const bot = new THREE.Group();
    sc.add(bot);
    // الجسم
    const body = new THREE.Group();
    bot.add(body);
    body.add(mesh(new THREE.SphereGeometry(.62, 32, 24), white, 0, -.55, 0, 1, 1.12, .88));
    body.add(mesh(new THREE.CircleGeometry(.17, 24), teal, 0, -.45, .54)); // لوحة الصدر المضيئة
    body.add(mesh(new THREE.TorusGeometry(.24, .03, 10, 32), blue, 0, -.45, .535));
    // الرأس
    const head = new THREE.Group();
    head.position.y = .55;
    bot.add(head);
    head.add(mesh(new THREE.SphereGeometry(.7, 36, 28), white, 0, 0, 0, 1.18, .92, .98));
    head.add(mesh(new THREE.SphereGeometry(.56, 32, 24), dark, 0, -.02, .3, 1.28, .78, .62)); // الشاشة السوداء
    const eyeL = mesh(new THREE.SphereGeometry(.105, 20, 16), teal, -.27, .02, .7, 1, 1.35, .5);
    const eyeR = mesh(new THREE.SphereGeometry(.105, 20, 16), teal, .27, .02, .7, 1, 1.35, .5);
    head.add(eyeL, eyeR);
    const ear = (x) => { const e = mesh(new THREE.CylinderGeometry(.2, .2, .16, 24), blue, x, 0, 0); e.rotation.z = Math.PI / 2; return e; };
    head.add(ear(-.86), ear(.86));
    head.add(mesh(new THREE.CylinderGeometry(.03, .03, .34, 10), white, 0, .78, 0));
    const tip = mesh(new THREE.SphereGeometry(.09, 16, 12), amber, 0, .98, 0);
    head.add(tip);
    // الذراعان (تطفوان بجانب الجسم) والقاعدة المضيئة
    const armL = new THREE.Group(), armR = new THREE.Group();
    armL.position.set(-.82, -.38, 0);
    armR.position.set(.82, -.38, 0);
    armL.add(mesh(new THREE.SphereGeometry(.17, 20, 16), blue, 0, 0, 0, 1, 1.3, 1));
    armR.add(mesh(new THREE.SphereGeometry(.17, 20, 16), blue, 0, 0, 0, 1, 1.3, 1));
    bot.add(armL, armR);
    const pad = mesh(new THREE.RingGeometry(.42, .55, 40), new THREE.MeshBasicMaterial({ color: 0x22e3c4, transparent: true, opacity: .55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }), 0, -1.55, 0);
    pad.rotation.x = -Math.PI / 2;
    sc.add(pad);
    // التفاعل
    let nx = 0, ny = 0, jump = 0, wave = 0, visible = true;
    const lerp = (a, b, k) => a + (b - a) * k;
    addEventListener('pointermove', e => {
        const b = cv.getBoundingClientRect();
        nx = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / (innerWidth / 2)));
        ny = Math.max(-1, Math.min(1, (e.clientY - (b.top + b.height / 2)) / (innerHeight / 2)));
    });
    const toggle = (open) => {
        const on = open ?? !bub.classList.contains('on');
        bub.classList.toggle('on', on);
        hint.classList.remove('on');
        if (on) {
            jump = 1;
            wave = 1;
        }
    };
    btn.addEventListener('click', () => toggle());
    bub.addEventListener('click', e => { if (e.target.tagName === 'A')
        toggle(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape')
        toggle(false); });
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; });
    const resize = () => {
        const w = cv.clientWidth || 240, h = cv.clientHeight || 240;
        r.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
    };
    resize();
    addEventListener('resize', resize);
    let nextBlink = 2.5, blink = 0;
    const clock = new THREE.Clock();
    const loop = () => {
        requestAnimationFrame(loop);
        if (!visible)
            return;
        const t = clock.getElapsedTime(), k = RM ? .02 : 1;
        jump = Math.max(0, jump - .035);
        wave = Math.max(0, wave - .012);
        const hop = Math.sin(jump * Math.PI) * .55;
        bot.position.y = Math.sin(t * 1.7) * .09 * k + hop;
        bot.rotation.y = lerp(bot.rotation.y, nx * .35, .06);
        head.rotation.y = lerp(head.rotation.y, nx * .5, .08);
        head.rotation.x = lerp(head.rotation.x, ny * .3, .08);
        head.rotation.z = Math.sin(t * 1.1) * .04 * k;
        tip.scale.setScalar(1 + Math.sin(t * 4) * .22 * k);
        pad.material.opacity = .4 + Math.sin(t * 2.4) * .15 * k;
        pad.scale.setScalar(1 - hop * .35);
        armL.rotation.z = Math.sin(t * 1.7 + 1) * .12 * k;
        armR.rotation.z = wave > 0 ? -2.3 + Math.sin(t * 14) * .45 : -Math.sin(t * 1.7) * .12 * k;
        armR.position.y = wave > 0 ? -.05 : -.38;
        armR.position.x = wave > 0 ? .95 : .82;
        if (t > nextBlink) {
            nextBlink = t + 2.2 + Math.random() * 2.8;
            blink = .14;
        }
        blink = Math.max(0, blink - .016);
        const open = blink > 0 ? .1 : (wave > 0 ? .75 : 1.35); // العيون تضيق عند الابتسام
        eyeL.scale.y = eyeR.scale.y = lerp(eyeL.scale.y, open, .35);
        r.render(sc, cam);
    };
    loop();
}
