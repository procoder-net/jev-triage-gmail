// End-to-end test: loads the real extension in Chromium, serves test/mock-gmail.html at
// https://mail.google.com, answers Jev calls with a fake responder (no key, no network),
// then runs Check → Learn my inbox → Start and checks the labels that were applied.
//
//   npm test                     run the checks
//   npm run screenshots          also refresh the README images in docs/images/
//
// Needs Playwright with Chromium:  npm install  (then: npx playwright install chromium)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';   // lets us intercept the extension's Jev calls
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const SHOTS = process.argv.includes('--screenshots') ? path.join(ROOT, 'docs', 'images') : null;
const MOCK = fs.readFileSync(path.join(ROOT, 'test', 'mock-gmail.html'), 'utf8');

// Fake Jev: picks answers from keywords in the email text.
function fakeJev(text) {
  const answer = (action, topic, score, unsure = false, personal = 0.05) => ({
    answers: {
      action: { choice: action, probabilities: unsure ? { [action]: 0.5, low: 0.42 } : { [action]: 0.9, low: 0.05 } },
      topic: { choice: topic },
      urgency: { score },
      is_personal: { noul: personal },
    },
  });
  if (/BROKEN/.test(text)) return null;                    // simulates a Jev error for one email
  if (/conference|permission slip/i.test(text)) return answer('reply', 'kids', 3.2, false, 0.95);
  if (/70% off/i.test(text)) return answer('low', 'shopping', 0);
  if (/payment is due/i.test(text)) return answer('action', 'finance', 3.1);
  if (/earnings/i.test(text)) return answer('read', 'finance', 0.2, true);
  if (/Agents/i.test(text)) return answer('read', 'news', 0);
  return answer('fyi', 'shopping', 0);
}

const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? '✓' : '✗'} ${msg}`); };
const shot = async (target, name) => SHOTS && target.screenshot({ path: path.join(SHOTS, name) });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-e2e-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: !process.env.HEADED,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  await ctx.route('https://api.typesafe.ai/**', route => {
    const a = fakeJev(JSON.parse(route.request().postData()).state);
    return a ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) })
             : route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"test failure"}' });
  });
  await ctx.route('https://mail.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: MOCK }));

  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  expect(!!extId, 'extension loads');

  // Options page with a placeholder key (stored only in this throwaway profile).
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.fill('#key', 'demo-key-for-tests');
  await opt.click('#save');
  await shot(opt, '01-options.png');
  await opt.close();

  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', e => failures.push('page error: ' + e.message));
  await page.goto('https://mail.google.com/mail/u/0/?existing=Jev/5-Low,Topic/Shopping#inbox');
  await page.waitForSelector('#jev-pill', { timeout: 15000 });
  expect(true, 'Jev button appears in Gmail');

  await page.click('#jev-pill');
  await page.click('#jev-diag');
  await page.waitForFunction(() => /Labels button/.test(document.querySelector('#jev-status').textContent), null, { timeout: 10000 });
  const check = await page.textContent('#jev-status');
  expect(/rows seen: 12/.test(check) && /checkbox: yes/.test(check) && /Labels button: yes/.test(check), 'Check sees rows, checkbox and Labels button');
  await shot(page, '02-check.png');

  // Learn my inbox
  await page.selectOption('#jev-learn-n', '100');
  await page.click('#jev-learn');
  await page.waitForFunction(() => !document.querySelector('#jev-learn').disabled, null, { timeout: 120000 });
  const sugg = (await page.$$eval('#jev-sugg li', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))).join(' | ');
  expect(/shopmart\.example 3 emails/.test(sugg), 'Learn groups the 3 store emails by domain');
  expect(/school\.example 2 emails Must see/.test(sugg), 'Learn suggests the teacher as Must see');
  await shot(page, '03-learn.png');
  await page.click('#jev-save-rules');

  // Sort all mail, 5 rows per page, a lagging search index, and search opening on the Chat tab.
  await page.goto('https://mail.google.com/mail/u/0/?existing=Jev/5-Low,Topic/Shopping&pagesize=5&lag=1&chattab=1#inbox');
  await page.waitForSelector('#jev-pill');
  await page.click('#jev-pill');
  expect(await page.$eval('#jev-scope', s => s.value) === 'all', 'All mail is the default scope');
  await page.click('#jev-start');
  await page.waitForTimeout(4000);
  await shot(page, '04-running.png');
  const ticker = process.env.DEBUG ? setInterval(async () => console.log('  …', await page.textContent('#jev-status').catch(() => '')), 5000) : null;
  await page.waitForFunction(() => !document.querySelector('#jev-start').disabled, null, { timeout: 480000 });
  if (ticker) clearInterval(ticker);
  const status = await page.textContent('#jev-status');
  const applied = await page.evaluate(() => window.__applied);
  const archived = await page.evaluate(() => window.__archived);
  expect(/All done/.test(status), 'run finishes: ' + status);
  expect(/1 skipped/.test(status), 'a failing email is skipped, not fatal');
  const log = (await page.$$eval('#jev-log li', els => els.map(e => e.innerText))).join(' | ');
  expect(/skipped/.test(log), 'skipped email shown in the log');
  expect((applied.t1 || []).includes('Jev/1-Reply') && applied.t1.includes('Jev/0-Must-See'), 'teacher email → Reply + Must see');
  expect((applied.t3 || []).includes('Jev/2-Action') && applied.t3.includes('Jev/Urgent'), 'payment due → Action + Urgent');
  expect(['t2', 't7', 't8'].every(id => archived.includes(id)), 'store emails archived (aggressive ignore)');
  expect((applied.t4 || []).includes('Jev/Review'), 'unsure answer → Review');
  expect(Object.keys(applied).length === 11, 'all 11 good emails labelled across pages: ' + Object.keys(applied).length);

  await shot(page, '05-done.png');
  if (SHOTS) await page.locator('#jev-panel').screenshot({ path: path.join(SHOTS, '05b-panel.png') });

  // Second run: nothing should be re-done.
  const before = JSON.stringify(await page.evaluate(() => window.__applied));
  await page.click('#jev-start');
  await page.waitForFunction(() => !document.querySelector('#jev-start').disabled, null, { timeout: 120000 });
  const again = JSON.stringify(await page.evaluate(() => window.__applied));
  expect(before === again, 'second Start re-labels nothing (already sorted are skipped)');

  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 320, height: 260 });
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await shot(pop, '06-popup.png');
} finally {
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll end-to-end checks passed.');
