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

// --- 1b. Admin opretter en rom i biblioteket med billede ---
await admin.goto(BASE + '/#/'); await admin.reload(); await admin.waitForSelector('#new', { timeout: 10000 });
await admin.goto(BASE + '/#/bibliotek'); await admin.waitForSelector('#newlib');
await admin.click('#newlib'); await admin.waitForSelector('#libform');
const lf = admin.locator('#libform');
await lf.locator('[name=name]').fill('Appleton Estate 12');
await lf.locator('[name=distillery]').fill('Appleton Estate');
await lf.locator('[name=country]').fill('Jamaica');
await lf.locator('[name=age]').fill('12 år');
await lf.locator('[name=abv]').fill('43');
await lf.locator('[name=adminNotes]').fill('HEMMELIG NOTE: klassisk jamaicansk, appelsinskal og eg.');
await lf.locator('.tags label', { hasText: 'Kraftig' }).click();
await lf.locator('.tags label', { hasText: 'Lang eftersmag' }).click();
await lf.locator('.tags label', { hasText: 'Banan' }).click();
await lf.locator('.addword-input[data-group=aromaer]').fill('Marcipan');
await lf.locator('.addword-btn[data-group=aromaer]').click();
await admin.waitForSelector('#libform .tags[data-group=aromaer] input[value=Marcipan]', { state: 'attached', timeout: 10000 });
check('Egne ord: nyt ord i aromaer vises og er krydset af', await lf.locator('.tags[data-group=aromaer] input[value=Marcipan]').isChecked());
const opts = await fsGet('settings/profileOptions', A.token).then((r) => r.json());
check('Egne ord: gemt i settings/profileOptions', JSON.stringify(opts).includes('Marcipan'));
r = await fsPatch('settings/profileOptions', { aromaer: { arrayValue: { values: [{ stringValue: 'Snyd' }] } } }, B.token, ['aromaer']);
check('Regler: medlem kan ikke ændre ordlisterne', r.status === 403, String(r.status));
check('Bibliotek: markering slår til visuelt', await lf.locator('.tags label', { hasText: 'Banan' }).evaluate((el) => el.classList.contains('on')));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await lf.locator('.imgfile').setInputFiles({ name: 'flaske.png', mimeType: 'image/png', buffer: png });
await admin.waitForFunction(() => document.querySelector('#libform [name=imageData]').value.startsWith('data:image/jpeg'), null, { timeout: 10000 });
check('Bibliotek: billede skaleret og lagt i formularen', true);
await lf.locator('button[type=submit]').click();
await admin.waitForSelector('#list [data-id]', { timeout: 10000 });
check('Bibliotek: rommen vises i listen', (await admin.locator('#list').textContent()).includes('Appleton Estate 12'));
const libId = await admin.locator('#list [data-id]').first().getAttribute('data-id');
const media = await fsGet(`rumLibrary/${libId}/media/image`, A.token).then((r) => r.json());
check('Bibliotek: billede gemt som JPEG data-URL', (media.fields?.data?.stringValue || '').startsWith('data:image/jpeg'));
r = await fsGet(`rumLibrary/${libId}`, B.token);
check('Regler: medlem kan ikke læse biblioteket', r.status === 403, String(r.status));

// --- 2. Admin opretter smagning og rom ---
await admin.goto(BASE + '/#/'); await admin.waitForSelector('#new', { timeout: 10000 });
await admin.click('#new');
await admin.waitForSelector('#tform');
check('Admin: ny smagning åbner redigering', admin.url().includes('#/admin/smagning/'));
const tId = admin.url().split('/').pop();
await admin.fill('#tform [name=title]', 'Romaften i Vejle');
await admin.selectOption('#tform [name=status]', 'igang');
await admin.click('#tform button[type=submit]');
await sleep(800);
await admin.waitForSelector('#libpick');
await admin.selectOption('#libpick', libId);
await admin.click('#addlib'); await admin.waitForSelector('.rumform');
await admin.click('#addrum'); await sleep(1000);
check('Admin: to romme tilføjet (én fra biblioteket, én ny)', (await admin.locator('.rumform').count()) === 2);
const f1 = admin.locator('.rumform').first();
check('Admin: smagsprofil fulgte med fra biblioteket', (await f1.locator('input[name=duft]:checked').evaluateAll((els) => els.map((e) => e.value))).join() === 'Kraftig' && (await f1.locator('input[name=aromaer]:checked').evaluateAll((els) => els.map((e) => e.value))).sort().join() === 'Banan,Marcipan');
check('Admin: rom fra biblioteket har navn, noter og billede', await f1.locator('[name=name]').inputValue() === 'Appleton Estate 12' && (await f1.locator('[name=adminNotes]').inputValue()).includes('HEMMELIG') && (await f1.locator('[name=imageData]').inputValue()).startsWith('data:image/jpeg'));
await f1.locator('[name=cask]').fill('Ex-bourbon');
await f1.locator('button[type=submit]').click();
await sleep(1000);
const libAfter = await fsGet(`rumLibrary/${libId}`, A.token).then((r) => r.json());
check('Admin: rettelse i smagningen skrives tilbage til biblioteket', libAfter.fields?.cask?.stringValue === 'Ex-bourbon');
const libCount = await fsGet('rumLibrary', A.token).then((r) => r.json());
check('Bibliotek: "Opret ny rom" oprettede også en bibliotekspost', (libCount.documents || []).length === 2, String((libCount.documents || []).length));
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
check('Egne ord: medlemmets aromaliste indeholder admins eget ord og de nye faste ord', (await member.locator('#rate .tags input[value=Marcipan]').count()) === 1 && (await member.locator('#rate .tags input[value="Brun farin"]').count()) === 1);
await member.locator('#rate [name=samlet]').fill('8');
await member.locator('#rate [name=naese]').fill('7');
await member.locator('.tags label', { hasText: 'Vanilje' }).click();
await member.fill('#rate [name=guess]', 'Jamaica');
await member.fill('#rate [name=comment]', 'Dejlig');
await member.click('#rate button[type=submit]');
await member.waitForSelector('.reveal', { timeout: 10000 });
const after = await member.locator('#app').textContent();
check('Afsløring: navn og hemmelig note vises efter bedømmelse', after.includes('Appleton Estate 12') && after.includes('HEMMELIG NOTE'));
check('Afsløring: admins smagsprofil vises (duft, smag, aromaer)', after.includes('Administratorens smagsprofil') && after.includes('Kraftig') && after.includes('Lang eftersmag') && after.includes('Banan') && after.includes('Marcipan'));
check('Afsløring: profil skjult før bedømmelse', !pageText.includes('Kraftig'));
check('Afsløring: billede vises', (await member.locator('.reveal img.rumimg').getAttribute('src') || '').startsWith('data:image/jpeg'));
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

// --- 7. Biblioteket viser historik fra smagningen ---
await admin.goto(BASE + `/#/bibliotek/${libId}`);
await admin.waitForFunction(() => (document.getElementById('hist')?.textContent || '').includes('Romaften'), null, { timeout: 15000 });
const hist = await admin.locator('#hist').textContent();
check('Bibliotek: historik viser smagningen, gennemsnit og deltager', hist.includes('Romaften i Vejle') && hist.includes('8,0') && hist.includes('Bo Medlem') && hist.includes('Vanilje'));
await admin.screenshot({ path: 'tests/screenshots/shot-library.png', fullPage: true });

await browser.close();
const fails = results.filter((x) => x[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} bestået`);
process.exit(fails.length ? 1 : 0);
