# Smagning

Webapp til smagsbedømmelser i en gruppe – i første omgang romsmagninger.
Medlemmer opretter sig selv, tilmelder sig en smagning, bedømmer hver rom
(udseende, næse, smag, eftersmag, samlet score 1–10, aromaer, gæt og
kommentar) og får derefter afsløret rommens identitet og administratorens
noter. Når alle deltagere har bedømt en rom, vises den samlede vurdering og
en rangliste.

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
| `tastings/{id}/rums/{rumId}` | `order`, `status` (`aaben` / `lukket`), `publicName` ("Rom nr. 1" ved blindsmagning) |
| `tastings/{id}/rums/{rumId}/private/info` | navn, destilleri, land, alder, ABV, type, fad, pris, `adminNotes`, `webInfo` – kan først læses efter egen bedømmelse |
| `tastings/{id}/ratings/{rumId}_{uid}` | `scores` pr. dimension, `tags`, `guess`, `comment` – kan ikke ændres efter oprettelse |

## Drift

### Første gang: gør dig selv til administrator

1. Opret dig på sitet (e-mail eller Google).
2. I Firebase-konsollen → Firestore → `users` → dit dokument: sæt `role` til
   `admin`. Alle andre er automatisk `medlem`. Der er bevidst ingen knap til
   det i appen.

### Deploy

```
npm install
npx firebase login
npm run deploy            # hosting + Firestore-regler
npm run deploy:rules      # kun reglerne
```

Deploy af reglerne er en del af `npm run deploy`. Tjek bagefter i konsollen
under Firestore → Regler, at den nye version er aktiv – uden dem er
afsløringen kun skjult i klienten.

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
(25 tjek: rolle, oprettelse, tilmelding, skjult afsløring før bedømmelse,
afsløring efter, låst bedømmelse, samlet vurdering, rangliste, afslutning).

## Kendt gæld (bevidst udskudt for at nå første smagning)

- Ingen CI endnu: e2e-testen køres lokalt. Første opgave efter go-live:
  GitHub Actions med emulator + `npm run test:e2e` på hver PR.
- Ingen mutationstest af testen selv (se CLAUDE.md, Testprincipper).
- "Hent info fra nettet" henter kun Wikipedia-resuméer plus søgelinks.
  Rigere AI-resuméer kræver en Cloud Function (Blaze-plan).
- Sletning af en smagning sletter dokumenterne ét ad gangen fra klienten.
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
