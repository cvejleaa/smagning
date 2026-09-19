// End-to-end-test mod Firebase-emulatorerne: to brugere (admin og medlem) gennemgår hele
// forløbet i browseren, og Firestore-reglerne efterprøves direkte via REST med brugernes tokens.
// Kør: npm run emulators (i ét vindue) og npm run test:e2e (i et andet).
// Kræver Chromium: npx playwright install chromium – eller sæt CHROME_PATH til en eksisterende Chrome. I sandkasser uden adgang
// til Firebase-CDN'en serveres SDK-filerne fra npm-pakken 'firebase' i stedet.
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5000';
const PROJECT = 'smagning-286ed';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(ok ? '✅' : '❌', name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
import fs from 'node:fs';
async function newPage() {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 900 } });
  // CDN'en kan ikke nås fra sandkassen: servér de identiske filer fra npm-pakken firebase@10.12.0
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\/(.*)/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL(`../node_modules/firebase/${file}`, import.meta.url)) });
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('   [browser]', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message));
  return page;
}
async function signup(page, name, email) {
  await page.goto(BASE + '/#/');
  await page.waitForSelector('#signup');
  await page.fill('#signup [name=name]', name);
  await page.fill('#signup [name=email]', email);
  await page.fill('#signup [name=password]', 'hemmelig1');
  await page.click('#signup button[type=submit]');
  await page.waitForSelector('#logout', { timeout: 15000 });
}
async function idToken(email) {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'hemmelig1', returnSecureToken: true }) }).then((r) => r.json());
  return { token: r.idToken, uid: r.localId };
}
const fsGet = (path, token) => fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
const fsPatch = (path, fields, token, mask) => fetch(`${FS}/${path}${mask ? '?' + mask.map((m) => 'updateMask.fieldPaths=' + m).join('&') : ''}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
const fsPost = (path, fields, token) => fetch(`${FS}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });

// --- 1. To brugere oprettes ---
const admin = await newPage();
await signup(admin, 'Anna Admin', 'anna@test.dk');
check('Admin kan oprette sig og lande på forsiden', await admin.locator('h1').textContent() === 'Smagninger');
const member = await newPage();
await signup(member, 'Bo Medlem', 'bo@test.dk');
const A = await idToken('anna@test.dk');
const B = await idToken('bo@test.dk');

// Medlem må ikke gøre sig selv til admin
let r = await fsPatch(`users/${B.uid}`, { role: { stringValue: 'admin' } }, B.token, ['role']);
check('Regler: medlem kan ikke sætte egen rolle til admin', r.status === 403, String(r.status));
// Medlem må ikke oprette smagning
r = await fsPost('tastings', { title: { stringValue: 'Snyd' }, participantIds: { arrayValue: {} }, status: { stringValue: 'tilmelding' } }, B.token);
check('Regler: medlem kan ikke oprette smagning', r.status === 403, String(r.status));
// Ingen "Ny smagning"-knap for medlem
await member.goto(BASE + '/#/'); await sleep(800);
check('UI: medlem ser ingen "Ny smagning"-knap', (await member.locator('#new').count()) === 0);

// Gør Anna til admin via emulator-ejeradgang (svarer til at rette i konsollen)
r = await fsPatch(`users/${A.uid}`, { role: { stringValue: 'admin' } }, 'owner', ['role']);
check('Anna sat til admin via konsol-adgang', r.ok, String(r.status));

// --- 2. Admin opretter smagning og rom ---
await admin.goto(BASE + '/#/'); await admin.reload(); await admin.waitForSelector('#new', { timeout: 10000 });
await admin.click('#new');
await admin.waitForSelector('#tform');
check('Admin: ny smagning åbner redigering', admin.url().includes('#/admin/smagning/'));
const tId = admin.url().split('/').pop();
await admin.fill('#tform [name=title]', 'Romaften i Vejle');
await admin.selectOption('#tform [name=status]', 'igang');
await admin.click('#tform button[type=submit]');
await sleep(800);
await admin.click('#addrum'); await admin.waitForSelector('.rumform');
await admin.click('#addrum'); await sleep(800);
check('Admin: to romme tilføjet', (await admin.locator('.rumform').count()) === 2);
const f1 = admin.locator('.rumform').first();
await f1.locator('[name=name]').fill('Appleton Estate 12');
await f1.locator('[name=distillery]').fill('Appleton Estate');
await f1.locator('[name=country]').fill('Jamaica');
await f1.locator('[name=age]').fill('12 år');
await f1.locator('[name=abv]').fill('43');
await f1.locator('[name=adminNotes]').fill('HEMMELIG NOTE: klassisk jamaicansk, appelsinskal og eg.');
await f1.locator('button[type=submit]').click();
await sleep(800);
check('Admin: rom gemt med navn', await admin.locator('.rumform').first().locator('[name=name]').inputValue() === 'Appleton Estate 12');
const rums = await fsGet(`tastings/${tId}/rums`, A.token).then((r) => r.json());
const rumIds = rums.documents.map((d) => d.name.split('/').pop());
const rum1 = rums.documents.find((d) => d.fields.order.integerValue === '1');
const r1 = rum1.name.split('/').pop();
check('Blind: publicName er "Rom nr. 1" selv om navnet er sat', rum1.fields.publicName.stringValue === 'Rom nr. 1', rum1.fields.publicName.stringValue);
await admin.screenshot({ path: 'tests/screenshots/shot-admin.png', fullPage: true });

// --- 3. Medlem tilmelder sig ---
await member.goto(BASE + '/#/'); await sleep(800);
check('Medlem ser smagningen på forsiden', (await member.locator('.card', { hasText: 'Romaften i Vejle' }).count()) === 1);
await member.locator('.card', { hasText: 'Romaften i Vejle' }).click();
await member.waitForSelector('#join');
await member.click('#join'); await sleep(800);
check('Medlem tilmeldt (knap skifter til Meld fra)', (await member.locator('#join').textContent()) === 'Meld fra');
check('Medlem ser rom som "Rom nr. 1" uden navn', (await member.locator('[data-rum]').first().textContent()).includes('Rom nr. 1') && !(await member.locator('#t').textContent()).includes('Appleton'));

// Regler: private/info kan ikke læses før bedømmelse
r = await fsGet(`tastings/${tId}/rums/${r1}/private/info`, B.token);
check('Regler: medlem kan IKKE læse admin-noter før bedømmelse', r.status === 403, String(r.status));

// --- 4. Medlem bedømmer rom 1 ---
await member.locator('[data-rum]').first().click();
await member.waitForSelector('#rate');
const pageText = await member.locator('#app').textContent();
check('UI: ingen hemmelig note vises før bedømmelse', !pageText.includes('HEMMELIG NOTE') && !pageText.includes('Appleton'));
await member.locator('#rate [name=samlet]').fill('8');
await member.locator('#rate [name=naese]').fill('7');
await member.locator('.tags label', { hasText: 'Vanilje' }).click();
await member.fill('#rate [name=guess]', 'Jamaica');
await member.fill('#rate [name=comment]', 'Dejlig');
await member.click('#rate button[type=submit]');
await member.waitForSelector('.reveal', { timeout: 10000 });
const after = await member.locator('#app').textContent();
check('Afsløring: navn og hemmelig note vises efter bedømmelse', after.includes('Appleton Estate 12') && after.includes('HEMMELIG NOTE'));
check('Samlet vurdering vises når alle (1 af 1) har bedømt', after.includes('8,0') && after.includes('Bo Medlem'));
await member.screenshot({ path: 'tests/screenshots/shot-member-reveal.png', fullPage: true });

// Regler: nu kan private læses, men bedømmelse kan ikke ændres
r = await fsGet(`tastings/${tId}/rums/${r1}/private/info`, B.token);
check('Regler: medlem KAN læse admin-noter efter bedømmelse', r.ok, String(r.status));
r = await fsPatch(`tastings/${tId}/ratings/${r1}_${B.uid}`, { scores: { mapValue: { fields: { samlet: { integerValue: '10' } } } } }, B.token, ['scores']);
check('Regler: bedømmelse kan ikke ændres bagefter', r.status === 403, String(r.status));
// Regler: kan ikke bedømme på en andens vegne
r = await fsPatch(`tastings/${tId}/ratings/${r1}_${A.uid}`, { uid: { stringValue: A.uid }, rumId: { stringValue: r1 }, scores: { mapValue: { fields: { samlet: { integerValue: '1' } } } } }, B.token);
check('Regler: medlem kan ikke oprette bedømmelse for en anden', r.status === 403, String(r.status));
// Rom 2: private stadig lukket
const r2 = rumIds.find((x) => x !== r1);
r = await fsGet(`tastings/${tId}/rums/${r2}/private/info`, B.token);
check('Regler: rom 2 er stadig skjult', r.status === 403, String(r.status));

// --- 5. Rangliste på smagningssiden ---
await member.goto(BASE + `/#/smagning/${tId}`); await sleep(1200);
const tText = await member.locator('#t').textContent();
check('Rangliste viser rom 1 med rigtigt navn og gennemsnit', tText.includes('Rangliste') && tText.includes('Appleton Estate 12') && tText.includes('8,0'));
check('Rom 2 stadig anonym på listen', !tText.includes('Rom nr. 2 (') );
await member.screenshot({ path: 'tests/screenshots/shot-member-tasting.png', fullPage: true });

// --- 6. Admin lukker rom 2 uden bedømmelser; afslutter smagning → medlem kan læse rom 2 ---
r = await fsPatch(`tastings/${tId}`, { status: { stringValue: 'afsluttet' } }, A.token, ['status']);
check('Admin kan afslutte smagningen', r.ok, String(r.status));
r = await fsGet(`tastings/${tId}/rums/${r2}/private/info`, B.token);
check('Regler: efter afslutning kan medlem læse rom 2', r.ok, String(r.status));
r = await fsPatch(`tastings/${tId}`, { participantIds: { arrayValue: { values: [] } } }, B.token, ['participantIds']);
check('Regler: medlem kan ikke afmelde sig efter afslutning', r.status === 403, String(r.status));

await browser.close();
const fails = results.filter((x) => x[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} bestået`);
process.exit(fails.length ? 1 : 0);
