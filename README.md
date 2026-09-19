# Smagning

Webapp til smagsbedømmelser i en gruppe – i første omgang romsmagninger.
Medlemmer opretter sig selv, tilmelder sig en smagning, bedømmer hver rom
(udseende, næse, smag, eftersmag, samlet score 1–10, aromaer, gæt og
kommentar). Når alle deltagere har bedømt en rom, eller værten frigiver den,
afsløres rommens identitet, billede og administratorens noter, og den
samlede vurdering og ranglisten vises.

Den fælles score for en rom er et vægtet gennemsnit af deltagernes fire
delkarakterer: farve 5 %, duft 20 %, smag 50 %, eftersmag 25 % (`WEIGHTS` i
`app.js`). Smagerens egen "samlet vurdering" vises kun til smageren selv og
indgår ikke i den fælles score, ranglisten eller bibliotekets historik.

Administrator har et **rombibliotek**: alle romme gemmes dér med oplysninger,
billede og noter, kan hentes ind i nye smagninger, og viser resultater fra
alle tidligere smagninger (gennemsnit pr. dimension, aromaer, deltagernes
scorer og kommentarer).

Live: <https://smagning.vejleaa.dk> (og <https://smagning-286ed.web.app>).

## Teknik

- Statisk side i `public/` uden build-trin (HTML, CSS, ES-moduler). Firebase
  JS SDK 10.12 hentes fra Firebases CDN.
- Firebase-projekt `smagning-286ed`: Hosting, Firestore og Authentication
  (e-mail/adgangskode og Google).
- Adgang afgøres i `firestore.rules` – klienten skjuler kun det, reglerne
  allerede forbyder.

### Datamodel (Firestore)

| Sti | Indhold |
|---|---|
| `users/{uid}` | navn, e-mail, `role` (`medlem` eller `admin`) |
| `tastings/{id}` | titel, dato, tid, beskrivelse, `status` (`tilmelding` / `igang` / `afsluttet`), `blind`, `participantIds[]` |
| `settings/ai` | `anthropicKey`: admins Anthropic API-nøgle til AI-hjælpen – kun admin kan læse og skrive |
| `tastings/{id}/private/plan` | AI-forslag: `intro`, `order[{rumId, why}]`, `stories{rumId}`, `generatedAt`, `model`, `blind` – kun admin |
| `settings/profileOptions` | admins egne ord til duft/smag/aromaer (lægges oven i de faste lister i `PROFILE_GROUPS` i `app.js`) – alle kan læse, kun admin skriver |
| `rumLibrary/{id}` | master-data for en rom (navn, destilleri, land, alder, ABV, type, fad, pris, `profile` med afkrydsede duft/smag/aromaer, `adminNotes`, `webInfo`) – kun admin |
| `rumLibrary/{id}/media/image` | `data`: billedet som JPEG data-URL (max 800 px, skaleret i browseren) – kun admin |
| `tastings/{id}/rums/{rumId}` | `order`, `status` (`aaben` / `lukket` = frigivet), `publicName` ("Rom nr. 1" ved blindsmagning), `libraryId`, `ratedBy[]` (uid'er der har bedømt; medlemmet skriver sig selv ind, reglerne kræver at bedømmelsen findes) |
| `tastings/{id}/rums/{rumId}/private/info` | kopi af bibliotekets felter plus `imageData` – kan først læses når `ratedBy` dækker alle `participantIds`, når rommen er frigivet, eller når smagningen er afsluttet |
| `tastings/{id}/ratings/{rumId}_{uid}` | `scores` pr. dimension, `tags`, `guess` (`{country, abv, name}` ved blindsmagning), `comment` – kan ikke ændres efter oprettelse |

### AI-hjælp: rækkefølge og historier

På smagningens redigeringsside kan admin klikke "Foreslå rækkefølge og
historier". Rommenes oplysninger (navn, destilleri, land, alder, ABV, type,
fad, smagsprofil, noter og info fra nettet) sendes direkte fra admins browser
til Anthropics Messages API (model `claude-opus-5`), som svarer med en
velkomst, en begrundet rækkefølge og en historie pr. rom. Ved blindsmagning
instrueres modellen i ikke at afsløre rommene. "Anvend rækkefølgen" skriver
den nye rækkefølge på rommene, og "Åbn manuskript" viser velkomst og
historier i læsevenlig form til værten.

Nøglen indsættes under Profil (kun admin) og gemmes i `settings/ai`, som kun
admin kan læse. Den ligger aldrig i koden. Et kald koster typisk under en
krone. Kaldet bruger Anthropics server-side fallback, så en afvist
forespørgsel automatisk prøves på en anden model; svarer API'et 400 på den
parameter, gentages kaldet uden.

### Installér som app på telefonen

Siden har et web app manifest og ikoner (glasset 🥃 fra Noto Color Emoji på
brun baggrund), så den kan lægges på hjemmeskærmen: i Safari på iPhone
"Del" → "Føj til hjemmeskærm"; i Chrome på Android menuen → "Føj til
startskærm" / "Installér app". Ikonerne genereres med
`node tools/make-icons.mjs` (kræver Chromium med Noto Color Emoji).

## Drift

### Første gang: gør dig selv til administrator

1. Opret dig på sitet (e-mail eller Google).
2. I Firebase-konsollen → Firestore → `users` → dit dokument: sæt `role` til
   `admin`. Alle andre er automatisk `medlem`. Der er bevidst ingen knap til
   det i appen.

### Deploy (automatisk fra GitHub)

Hvert push til `main` deployer hosting og Firestore-regler via
`.github/workflows/deploy.yml`. Det kræver én engangsopsætning: en
servicekonto-nøgle som GitHub-secret.

1. Google Cloud Console → IAM og administration → Servicekonti (projekt
   `smagning-286ed`) → "Opret servicekonto". Navn fx `github-deploy`. Giv
   rollen **Firebase Admin**. Færdiggør.
2. Åbn kontoen → fanen "Nøgler" → "Tilføj nøgle" → "Opret ny nøgle" → JSON.
   En fil downloades.
3. GitHub → repoet → Settings → Secrets and variables → Actions → "New
   repository secret". Navn: `FIREBASE_SERVICE_ACCOUNT`. Værdi: hele
   indholdet af JSON-filen. Slet filen bagefter.
4. GitHub → Actions → "Deploy til Firebase" → "Run workflow" (eller vent på
   næste push til `main`).

Mangler nøglen, springer workflowet deployet over med en advarsel i loggen
frem for at fejle. Tjek efter første deploy i Firebase-konsollen under
Firestore → Regler, at den nye version er aktiv – uden dem er afsløringen
kun skjult i klienten.

Manuelt deploy fra en maskine med repoet er stadig muligt:
`npm install && npx firebase login && npm run deploy`.

### Domænet smagning.vejleaa.dk

1. Firebase-konsollen → Hosting → "Tilføj brugerdefineret domæne" →
   `smagning.vejleaa.dk`.
2. Firebase beder om en TXT-record til ejerskabsbekræftelse og derefter
   A-records. **Bemærk:** en CNAME på `smagning` udelukker TXT/A-records på
   samme navn. Bekræfter Firebase ikke domænet, så erstat CNAME'en med de
   A-records, Firebase viser.
3. Certifikatet udstedes automatisk (minutter til få timer). Indtil da virker
   `smagning-286ed.web.app`.
4. **Google-login på eget domæne:** tilføj `smagning.vejleaa.dk` under
   Authentication → Settings → Authorized domains. Ellers fejler Google-login
   med "unauthorized domain" (e-mail-login virker uanset).

### Hvor fejl viser sig

- Klientfejl vises i den røde boks øverst på siden og i browserens konsol.
- Afviste skrivninger/læsninger (regler) ses i Firebase-konsollen under
  Firestore → Brug og under Regler → Overvågning.
- Login-fejl: Authentication → Brugere.

## Lokal udvikling og test

```
npm install
npx playwright install chromium   # eller sæt CHROME_PATH
npm run emulators                 # Auth + Firestore + Hosting på localhost
npm run test:e2e                  # i et andet vindue
```

Appen bruger automatisk emulatorerne, når den åbnes fra `localhost` /
`127.0.0.1` (se toppen af `public/app.js`). `tests/e2e.mjs` gennemgår hele
forløbet med to brugere i browseren og efterprøver reglerne direkte via REST
(64 tjek: installérbar app, rolle, bibliotek med billede, smagsprofil og egne ord, oprettelse, tilmelding, skjult
afsløring indtil alle har bedømt eller værten frigiver, afsløring med billede, låst bedømmelse,
samlet vurdering, rangliste, afslutning, historik i biblioteket, AI-plan
med mocket API, anvendt rækkefølge og manuskript).

## Kendt gæld (bevidst udskudt for at nå første smagning)

- Ingen CI endnu: e2e-testen køres lokalt. Første opgave efter go-live:
  GitHub Actions med emulator + `npm run test:e2e` på hver PR.
- Ingen mutationstest af testen selv (se CLAUDE.md, Testprincipper).
- "Hent info fra nettet" henter kun Wikipedia-resuméer plus søgelinks.
  Rigere AI-resuméer kræver en Cloud Function (Blaze-plan).
- Sletning af en smagning sletter dokumenterne ét ad gangen fra klienten.
- Billeder gemmes som data-URL i Firestore (max ca. 700 KB pr. billede) i
  stedet for Cloud Storage, som kræver Blaze-abonnement på nye projekter.
- Bibliotekets historik hentes med én forespørgsel pr. smagning; ved mange
  hundrede smagninger bør det denormaliseres.
- Skabelonens `[TILPAS]`-markeringer i `.claude/agents/` er ikke udfyldt endnu.

## Skabelonens tilpasnings-tjekliste

| Fil | Skal udfyldes |
|---|---|
| `CLAUDE.md` | test-/lint-/build-kommandoer nederst (delvist: se ovenfor), CI-jobbene i trin 4 |
| `.claude/agents/release-manager.md` | miljø/workflow-tabellen, sti → kræver-tabellen |
| `.claude/agents/security-reviewer.md` | trusselsbilledet og hvilke stier der udløser rollen (`firestore.rules`) |
| `.claude/agents/quality-control-manager.md` | projektets fælder, invarianter og delte flader |
| `.claude/agents/test-manager.md` | forretningskritiske områder og test-lagene |
| `.claude/agents/arkitekt.md` | projektets grundform |
| `.claude/agents/domaene-raadgiver.md` | HELE rollen – fx "Smagningsvært" |
| `.claude/commands/eftersyn.md` | hvad koster penge, og hvad en rolig periode er |
