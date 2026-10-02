import { applyLang, initLangSwitch } from './core/i18n.js';
import { initLock } from './core/lock.js';
import { initNav } from './core/nav.js';
import { buildGallery, initGalleryFx } from './components/gallery.js';
import { initWords, initScroll, initTrail } from './components/ui.js';
import { initHearts, initFeatures } from './components/features.js';
import { initChat } from './components/chat.js';
import { initLogin } from './components/login.js';
import { initAuth } from './components/auth.js';
import { initSocial } from './components/social.js';
import { buildShapes } from './effects/shapes.js';
import { initParticles } from './effects/particles.js';
import { initRobot } from './effects/robot.js';

// 1) قفل الزوم والتحريك الجانبي، 2) لغة الجهاز (ترجمة الصفحة قبل أي كود يقرأ نصوصها)
initLock(); initNav(); applyLang(); initLangSwitch();

// المعرض أولاً ليراقبه مراقب الظهور (يعمل فقط في صفحة المعرض)
const hasGallery = !!document.getElementById('ga');
if (hasGallery) buildGallery();
buildShapes(); initWords(); initScroll();
if (hasGallery) initGalleryFx();
initHearts();
// المؤثرات الثلاثية الأبعاد اختيارية: لو فشلت (جهاز بلا WebGL مثلاً) لا يتوقف باقي الموقع
const safe = (f: () => void) => { try { f(); } catch (e) { console.warn('[opera]', e); } };
safe(initParticles); safe(initRobot);
initTrail();
initChat(); initFeatures();
initLogin(); initAuth(); initSocial();
