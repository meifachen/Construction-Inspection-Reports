/**
 * E2E test suite for DailyInspectionReport-Simple.html
 *
 * Focus: regression-test the iPhone "buttons unresponsive" fix and the
 * microphone permission flow added in this session, plus broad coverage
 * of the rest of the app under jsdom.
 *
 * Run: node e2e_simple.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');

// Resolve the HTML next to this script. Works from any checkout/worktree.
const HTML_PATH = path.resolve(__dirname, 'DailyInspectionReport-Simple.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
const failures = [];

let lastTestName = '';
const VERBOSE = process.env.VERBOSE === '1';
function ok(name, cond, info) {
  lastTestName = name;
  if (cond) { pass++; process.stdout.write(VERBOSE ? '\n  ✓ ' + name : '.'); }
  else      { fail++; failures.push(name + (info ? ' — ' + info : ''));
              process.stdout.write(VERBOSE ? '\n  ✗ ' + name + (info ? ' [' + info + ']' : '') : 'F'); }
}
// Hang detector: if no assertion advances for 8 s, dump the last test name.
let hangTimer;
function bumpHang() {
  clearTimeout(hangTimer);
  hangTimer = setTimeout(() => {
    console.log('\n*** HANG after assertion: "' + lastTestName + '"');
    process.exit(3);
  }, 8000);
}
const _origOk = ok;
ok = function(name, cond, info) { _origOk(name, cond, info); bumpHang(); };
function section(title) {
  process.stdout.write('\n\n[' + title + ']\n');
}

// =====================================================================
// 1. STATIC STRUCTURE / SHAPE TESTS  (no JS execution)
// =====================================================================
section('Static structure');

ok('HTML opens with <!DOCTYPE html>', /^<!DOCTYPE html>/i.test(html.trimStart()));
ok('Has <html lang="en">', /<html\s+lang="en"/.test(html));
ok('Has <head> and </head>', /<head>/.test(html) && /<\/head>/.test(html));
ok('Has <body> and </body>', /<body>/.test(html) && /<\/body>/.test(html));

// Viewport — must NOT include user-scalable=no or maximum-scale=1
const viewportMatch = html.match(/<meta\s+name="viewport"[^>]*>/);
ok('Viewport meta present', !!viewportMatch);
if (viewportMatch) {
  ok('Viewport: no user-scalable=no',  !/user-scalable\s*=\s*no/i.test(viewportMatch[0]));
  ok('Viewport: no maximum-scale=1',  !/maximum-scale\s*=\s*1/i.test(viewportMatch[0]));
  ok('Viewport: width=device-width',   /width\s*=\s*device-width/i.test(viewportMatch[0]));
  ok('Viewport: initial-scale=1.0',    /initial-scale\s*=\s*1(\.0)?/i.test(viewportMatch[0]));
}

// Apple PWA hints
ok('apple-mobile-web-app-capable meta', /<meta\s+name="apple-mobile-web-app-capable"/.test(html));

// noscript fallback
ok('Has <noscript> fallback',           /<noscript>/.test(html));
ok('noscript mentions Safari',          /Safari/i.test(html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] || ''));
ok('noscript mentions Chrome',          /Chrome/i.test(html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] || ''));

// Early error handler must be in <head>
const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
const headContent = headMatch ? headMatch[1] : '';
ok('window.onerror registered in <head>',          /window\.onerror\s*=/.test(headContent));
ok('unhandledrejection listener in <head>',        /unhandledrejection/.test(headContent));
ok('window.__showStartupError exposed in <head>',  /window\.__showStartupError/.test(headContent));

// Body should NOT redefine window.onerror (we removed the old block)
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
const bodyContent = bodyMatch ? bodyMatch[1] : '';
const onerrorAssignsInBody = (bodyContent.match(/window\.onerror\s*=/g) || []).length;
ok('No duplicate window.onerror in <body>', onerrorAssignsInBody === 0,
   'found ' + onerrorAssignsInBody + ' assignments');

// safeStorage wrappers
ok('isStorageAvailable() defined',  /function\s+isStorageAvailable\s*\(/.test(html));
ok('safeGetItem() defined',         /function\s+safeGetItem\s*\(/.test(html));
ok('safeSetItem() defined',         /function\s+safeSetItem\s*\(/.test(html));
ok('safeRemoveItem() defined',      /function\s+safeRemoveItem\s*\(/.test(html));

// All required handler functions exist
[
  'newReport', 'showSubmitted', 'goHome', 'resetForm', 'showTab',
  'addCrewRow', 'addEquipRow', 'voiceInput', 'smartDictate',
  'checkVoiceSupport', 'ensureMicPermission', 'initSignature',
  'clearSignature', 'initServiceWorker', '__initApp',
  'loadSettings', 'saveSettings', 'saveDraft', 'loadReport',
  'deleteReport', 'collectFormData', 'populateForm',
  'applyRolePermissions', 'loadPunchListFromStorage'
].forEach(fn => {
  const re = new RegExp('function\\s+' + fn + '\\s*\\(');
  ok('Function defined: ' + fn, re.test(html));
});

// onclick handlers on home-screen buttons
ok('Home button: newReport()',     /onclick="newReport\(\)"/.test(html));
ok('Home button: showSubmitted()', /onclick="showSubmitted\(\)"/.test(html));
ok('Home button: goHome()',        /onclick="goHome\(\)"/.test(html));

// Service worker safety: no blob URL registration of a worker
ok('No URL.createObjectURL(new Blob) for service worker',
   !/registerServiceWorker\s*\([^)]*createObjectURL/i.test(html) &&
   !/serviceWorker\.register\s*\(\s*URL\.createObjectURL/i.test(html));
ok('initServiceWorker only acts under https:',
   /location\.protocol\s*===\s*['"]https:['"]/.test(
     (html.match(/function\s+initServiceWorker\s*\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0]));

// Microphone code paths
const checkVoiceFn = (html.match(/function\s+checkVoiceSupport\s*\(\s*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
ok('checkVoiceSupport: HTTPS / secureContext check',
   /isSecureContext|https:|localhost|127\.0\.0\.1/.test(checkVoiceFn));
ok('checkVoiceSupport: detects iOS in error path',
   /iPad|iPhone|iPod/.test(checkVoiceFn));

const ensureMicFn = (html.match(/function\s+ensureMicPermission\s*\(\s*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
ok('ensureMicPermission uses navigator.mediaDevices',
   /navigator\.mediaDevices/.test(ensureMicFn));
ok('ensureMicPermission stops tracks after grant',
   /getTracks\(\)\.forEach/.test(ensureMicFn));
ok('ensureMicPermission handles NotAllowedError',
   /NotAllowedError/.test(ensureMicFn));
ok('ensureMicPermission handles NotFoundError',
   /NotFoundError/.test(ensureMicFn));
ok('ensureMicPermission handles NotReadableError',
   /NotReadableError/.test(ensureMicFn));

const voiceInputFn = (html.match(/function\s+voiceInput\s*\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
ok('voiceInput calls ensureMicPermission()',
   /ensureMicPermission\s*\(\s*\)/.test(voiceInputFn));
ok('voiceInput handles service-not-allowed',
   /service-not-allowed/.test(voiceInputFn));
ok('voiceInput handles audio-capture',
   /audio-capture/.test(voiceInputFn));

// New: protocol guard in checkVoiceSupport (Samsung-via-WhatsApp regression)
ok('checkVoiceSupport: rejects content:// (WhatsApp)',
   /content:/.test(checkVoiceFn) && /whatsapp/i.test(checkVoiceFn));
ok('checkVoiceSupport: rejects file:// with helpful message',
   /file:/.test(checkVoiceFn));

// New: fallback button wiring + diagnostics (iPhone unresponsive-button regression)
ok('wireHomeButtons() defined',
   /function\s+wireHomeButtons\s*\(/.test(html));
ok('renderDiagnostics() defined',
   /function\s+renderDiagnostics\s*\(/.test(html));
ok('Home buttons have IDs (btnNewReport / btnShowSubmitted)',
   /id="btnNewReport"/.test(html) && /id="btnShowSubmitted"/.test(html));
ok('Diagnostics block (#diagBlock) present',
   /id="diagBlock"/.test(html));

const smartDictateFn = (html.match(/async\s+function\s+smartDictate\s*\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
ok('smartDictate calls ensureMicPermission()',
   /ensureMicPermission/.test(smartDictateFn));

// =====================================================================
// 2. JS SYNTAX CHECK on each inline <script>
// =====================================================================
section('Inline script syntax');

const scripts = [];
{
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m; while ((m = re.exec(html))) scripts.push(m[1]);
}
ok('Found 3 inline <script> blocks', scripts.length === 3, 'got ' + scripts.length);

scripts.forEach((src, i) => {
  const tmp = path.join(__dirname, '_block_' + i + '.js');
  fs.writeFileSync(tmp, src);
  let okSyntax = true, msg = '';
  try { execSync('node --check "' + tmp + '"', { stdio: 'pipe' }); }
  catch (e) { okSyntax = false; msg = (e.stderr || e.stdout || '').toString().split('\n')[0]; }
  fs.unlinkSync(tmp);
  ok('Inline script ' + i + ' parses', okSyntax, msg);
});

// =====================================================================
// 3. RUNTIME TESTS via JSDOM
// =====================================================================
section('Runtime');

function buildDom(opts) {
  opts = opts || {};
  const dom = new JSDOM(html, {
    url: opts.url || 'https://localhost/test.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      // ----- localStorage mock (with optional throw) -----
      const store = {};
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: (k) => {
            if (opts.storageThrows) throw new Error('SecurityError');
            return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          },
          setItem: (k, v) => {
            if (opts.storageThrows) throw new Error('SecurityError');
            store[k] = String(v);
          },
          removeItem: (k) => { delete store[k]; },
          clear: () => { Object.keys(store).forEach(k => delete store[k]); },
          get length() { return Object.keys(store).length; },
          key: (i) => Object.keys(store)[i] || null
        }
      });

      // ----- SpeechRecognition mock -----
      if (opts.noSpeech) {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
      } else {
        const Mock = function () {
          this.continuous = false; this.interimResults = false; this.lang = '';
          this.onresult = null; this.onend = null; this.onerror = null;
        };
        Mock.prototype.start = function () {
          window.__lastRecognitionStarted = true;
          if (opts.recognitionFails) {
            const err = opts.recognitionFails;
            setTimeout(() => { if (this.onerror) this.onerror({ error: err }); }, 5);
          } else if (this.onend) {
            setTimeout(() => this.onend(), 5);
          }
        };
        Mock.prototype.stop = function () { if (this.onend) this.onend(); };
        window.SpeechRecognition = window.webkitSpeechRecognition = Mock;
      }

      // ----- mediaDevices.getUserMedia mock -----
      if (opts.noMediaDevices) {
        // simulate older browser
        if (window.navigator) {
          try { delete window.navigator.mediaDevices; } catch (e) {}
        }
      } else {
        Object.defineProperty(window.navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia: () => {
              if (opts.gumError) {
                const err = new Error(opts.gumError);
                err.name = opts.gumError;
                return Promise.reject(err);
              }
              return Promise.resolve({
                getTracks: () => [{ stop: () => { window.__trackStopped = true; } }]
              });
            }
          }
        });
      }

      // Pretend secure context (so checkVoiceSupport passes)
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });

      // CDN libs are loaded via <script src="https://...">. JSDOM won't fetch them
      // by default; stub the symbols we touch so missing CDN doesn't break runtime.
      window.jspdf = { jsPDF: function () { this.text = () => {}; this.save = () => {}; this.output = () => 'blob:'; this.addImage = () => {}; this.autoTable = () => {}; } };
      window.qrcode = function () { return { addData: () => {}, make: () => {}, createDataURL: () => 'data:' }; };

      // Capture console errors raised inside the page (filter jsdom's known
      // unimplemented APIs that don't reflect real-world Safari behavior).
      window.__pageErrors = [];
      const origErr = console.error;
      const JSDOM_UNIMPLEMENTED = /Not implemented:\s*(HTMLCanvasElement|HTMLMediaElement|window\.scrollTo|Window'?s? scrollTo|scrollIntoView)/i;
      console.error = function () {
        const msg = Array.from(arguments).join(' ');
        if (!JSDOM_UNIMPLEMENTED.test(msg)) {
          try { window.__pageErrors.push(msg); } catch (e) {}
        }
        if (opts.echo) origErr.apply(console, arguments);
      };

      // jsdom doesn't implement scrollIntoView / HTMLCanvasElement getContext.
      // Stub them so the app's init code doesn't throw under test.
      window.Element.prototype.scrollIntoView = function () {};
      window.HTMLCanvasElement.prototype.getContext = function () {
        return {
          fillRect: () => {}, clearRect: () => {}, beginPath: () => {},
          moveTo: () => {}, lineTo: () => {}, stroke: () => {}, arc: () => {},
          drawImage: () => {}, strokeStyle: '', lineWidth: 1, lineCap: '',
          lineJoin: '', strokeRect: () => {}, getImageData: () => ({ data: [] }),
          putImageData: () => {}, fillText: () => {}, save: () => {},
          restore: () => {}, translate: () => {}, scale: () => {}, rotate: () => {}
        };
      };
      window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
    }
  });
  return dom;
}

// Wait for init (DOMContentLoaded fallback uses setTimeout(__initApp, 0))
function waitInit(window) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function poll() {
      if (window.__initDone || Date.now() - start > 1500) return resolve();
      setTimeout(poll, 10);
    })();
  });
}

(async () => {

  // ----- Run #1: happy path under HTTPS, all APIs available
  {
    const dom = buildDom();
    const w = dom.window;
    await waitInit(w);

    ok('Init ran (window.__initDone === true)', w.__initDone === true);
    ok('Home screen visible by default', w.document.getElementById('homeScreen').style.display !== 'none');
    ok('Report form hidden by default',  w.document.getElementById('reportForm').style.display === 'none');
    ok('Report date input pre-filled',
       (w.document.getElementById('reportDate').value || '').length >= 8);

    // Click "New Daily Report"
    w.newReport();
    ok('newReport(): home hidden',     w.document.getElementById('homeScreen').style.display === 'none');
    ok('newReport(): form shown',      w.document.getElementById('reportForm').style.display === 'block');
    ok('newReport(): currentReportId set', /^report_\d+/.test(w.eval('currentReportId') || ''));
    ok('newReport(): 3 crew rows added',
       w.document.querySelectorAll('#crewBody tr').length === 3,
       'got ' + w.document.querySelectorAll('#crewBody tr').length);
    ok('newReport(): 2 owned-equip rows added',
       w.document.querySelectorAll('#ownedEquipBody tr').length === 2,
       'got ' + w.document.querySelectorAll('#ownedEquipBody tr').length);

    // Click "Home"
    w.goHome();
    ok('goHome(): home shown again',  w.document.getElementById('homeScreen').style.display === 'block');
    ok('goHome(): form hidden again', w.document.getElementById('reportForm').style.display === 'none');

    // showSubmitted with empty drafts
    w.showSubmitted();
    const sub = w.document.getElementById('submittedList');
    ok('showSubmitted(): list visible', sub.style.display === 'block');
    ok('showSubmitted(): empty-state text',
       /No submitted/i.test(w.document.getElementById('submittedContainer').textContent || ''));

    // showSubmitted with one submitted draft
    const draft = {
      id: 'r1', status: 'submitted',
      projectName: 'Washington Park', reportDate: '2026-05-06', inspector: 'Meifa'
    };
    w.localStorage.setItem('fieldreport_drafts', JSON.stringify({ r1: draft }));
    w.showSubmitted();
    ok('showSubmitted(): renders submitted item',
       /Washington Park/.test(w.document.getElementById('submittedContainer').textContent || ''));

    // Tab navigation
    w.showTab(2);
    ok('showTab(2): tab2 active',
       w.document.getElementById('tab2').classList.contains('active'));

    // Voice support check (mic available, secure context, mock SR)
    ok('checkVoiceSupport() === true under HTTPS w/ SR', w.checkVoiceSupport() === true);

    // ensureMicPermission resolves true when getUserMedia grants
    const granted = await w.ensureMicPermission();
    ok('ensureMicPermission(): resolves true on grant', granted === true);
    ok('ensureMicPermission(): track stopped after grant', w.__trackStopped === true);

    // voiceInput on a real field — should call SpeechRecognition.start (after 80ms delay)
    w.__lastRecognitionStarted = false;
    w.voiceInput('projectName');
    await new Promise(r => setTimeout(r, 200));
    ok('voiceInput(): recognition started after permission', w.__lastRecognitionStarted === true);

    // voiceInput on a missing field — must NOT throw
    let threw = false;
    try { w.voiceInput('definitelyNotAField'); } catch (e) { threw = true; }
    ok('voiceInput(missing field): does not throw', !threw);

    // safeGetItem / safeSetItem round-trip
    w.safeSetItem('k1', 'v1');
    ok('safeSetItem then safeGetItem returns value', w.safeGetItem('k1') === 'v1');
    w.safeRemoveItem('k1');
    ok('safeRemoveItem clears value', w.safeGetItem('k1') === null);

    // Settings save / load round-trip
    w.document.getElementById('settCompany').value  = 'TestCo';
    w.document.getElementById('settInspector').value = 'Meifa';
    w.document.getElementById('settProject').value   = 'WP1';
    w.document.getElementById('settLogo').value      = '';
    w.document.getElementById('settOwner').value     = 'City';
    w.document.getElementById('settEngineer').value  = 'CivilCo';
    w.saveSettings();
    w.document.getElementById('settCompany').value = '';
    w.loadSettings();
    ok('Settings round-trip: company',  w.document.getElementById('contractor').value === 'TestCo');

    // collectFormData smoke test
    const data = w.collectFormData();
    ok('collectFormData() returns object', typeof data === 'object' && !!data);
    ok('collectFormData() captures crew array', Array.isArray(data.crew));
    ok('collectFormData() captures payItems',  Array.isArray(data.payItems));
    ok('collectFormData() captures checklists', !!data.checklists);

    // No errors raised on the page
    ok('No console.error during happy-path run',
       w.__pageErrors.length === 0,
       'errors: ' + JSON.stringify(w.__pageErrors).slice(0, 200));

    // No startup error banner shown
    ok('No #startupError banner visible',
       !w.document.getElementById('startupError'));

    // Diagnostic readout populated
    ok('diagJS shows ok',
       /ok/.test(w.document.getElementById('diagJS').textContent));
    ok('diagInit shows ok',
       /ok/.test(w.document.getElementById('diagInit').textContent));
    ok('diagProto shows current protocol',
       /https?:/.test(w.document.getElementById('diagProto').textContent));
    ok('diagSR detects SpeechRecognition',
       /yes/.test(w.document.getElementById('diagSR').textContent));

    // Backup click path: dispatch a synthetic click on the home buttons after
    // wiping the inline onclick attribute. Mirrors the WebView-strips-inline-handlers case.
    {
      // Reset to home first
      w.goHome();
      const btn = w.document.getElementById('btnNewReport');
      btn.removeAttribute('onclick');
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      ok('Backup click handler routes to newReport()',
         w.document.getElementById('reportForm').style.display === 'block');
    }

    dom.window.close();
  }

  // ----- Run #2: storage throws (file:// / private mode simulation)
  {
    const dom = buildDom({ storageThrows: true });
    const w = dom.window;
    await waitInit(w);

    ok('Init survives when localStorage throws', w.__initDone === true);
    ok('Storage warning banner shown',
       Array.from(w.document.body.children).some(el =>
         /Storage unavailable/i.test(el.textContent || '')
       ));
    // safeGetItem must return null, never throw
    let threw = false, val;
    try { val = w.safeGetItem('foo'); } catch (e) { threw = true; }
    ok('safeGetItem doesn\'t throw when storage broken', !threw);
    ok('safeGetItem returns null when storage broken',  val === null);

    // newReport must still work even with broken storage
    threw = false;
    try { w.newReport(); } catch (e) { threw = true; }
    ok('newReport() works even with broken storage', !threw);
    ok('Form shown after newReport() (broken storage)',
       w.document.getElementById('reportForm').style.display === 'block');

    dom.window.close();
  }

  // ----- Run #3: no SpeechRecognition (simulate Safari iOS)
  {
    const dom = buildDom({ noSpeech: true });
    const w = dom.window;
    await waitInit(w);

    ok('checkVoiceSupport() returns false when SR missing', w.checkVoiceSupport() === false);

    // voiceInput must not throw and must not blow up the rest of the app
    let threw = false;
    try { w.voiceInput('projectName'); } catch (e) { threw = true; }
    ok('voiceInput() doesn\'t throw when SR missing', !threw);

    // Buttons should still work
    w.newReport();
    ok('newReport() still works when SR missing',
       w.document.getElementById('reportForm').style.display === 'block');

    dom.window.close();
  }

  // ----- Run #4: getUserMedia denied
  {
    const dom = buildDom({ gumError: 'NotAllowedError' });
    const w = dom.window;
    await waitInit(w);

    const ok1 = await w.ensureMicPermission();
    ok('ensureMicPermission(): false on NotAllowedError', ok1 === false);

    // voiceInput should not start recognition when permission denied
    w.__lastRecognitionStarted = false;
    w.voiceInput('projectName');
    await new Promise(r => setTimeout(r, 200));
    ok('voiceInput(): recognition NOT started after deny', w.__lastRecognitionStarted === false);

    dom.window.close();
  }

  // (content:// and file:// branches are covered by static-source tests above —
  // jsdom's window.location is immutable so we can't simulate them at runtime.)

  // ----- Run #5: older browser (no mediaDevices)
  {
    const dom = buildDom({ noMediaDevices: true });
    const w = dom.window;
    await waitInit(w);

    const ok1 = await w.ensureMicPermission();
    ok('ensureMicPermission(): true when mediaDevices missing (legacy fallback)', ok1 === true);

    w.__lastRecognitionStarted = false;
    w.voiceInput('projectName');
    await new Promise(r => setTimeout(r, 200));
    ok('voiceInput(): recognition starts on legacy browser', w.__lastRecognitionStarted === true);

    dom.window.close();
  }

  // ----- Run #6: error handler surfaces banner
  {
    const dom = buildDom();
    const w = dom.window;
    await waitInit(w);

    w.__showStartupError('synthetic test error');
    ok('__showStartupError() creates #startupError', !!w.document.getElementById('startupError'));
    ok('__showStartupError() shows the message',
       /synthetic test error/.test(
         (w.document.getElementById('startupError').innerHTML || '')));

    dom.window.close();
  }

  // ----- Run #7: __initApp idempotency
  {
    const dom = buildDom();
    const w = dom.window;
    await waitInit(w);

    const tabsBefore = w.document.querySelectorAll('.nav-tab').length;
    w.__initApp();      // call again
    w.__initApp();      // and again
    const tabsAfter = w.document.querySelectorAll('.nav-tab').length;
    ok('__initApp() is idempotent (no duplicate handlers/elements)',
       tabsBefore === tabsAfter);

    dom.window.close();
  }

  // =====================================================================
  // SUMMARY
  // =====================================================================
  console.log('\n\n────────────────────────────────────────');
  console.log('  PASS: ' + pass + '   FAIL: ' + fail);
  console.log('────────────────────────────────────────');
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  - ' + f));
  }
  process.exit(fail === 0 ? 0 : 1);

})().catch(e => {
  console.error('\n\nFATAL test runner error after: "' + lastTestName + '"');
  console.error('Error:', e && e.stack ? e.stack : e);
  setTimeout(() => process.exit(2), 50);
});
