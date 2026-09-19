---
description: Eftersyn — periodisk gennemgang af sikkerhed, forbrug, drift, afhængigheder, dokumentation, testsuite, brugsværdi og rollernes hukommelse. Køres i en rolig periode, ca. hver anden måned.
---

# Eftersyn

De tre faste roller kigger på **én ændring ad gangen**. Der findes en anden
slags problemer, som ingen af dem nogensinde ser: dem der vokser stille frem
mellem ændringerne. Et forbrug der er tredoblet. En afhængighed to majors
bagud. Et scheduled job, der stille er holdt op med at køre. En dokumentation,
der beskriver en app, vi ikke har mere.

Det er dét, dette eftersyn er til. Kør det i en **rolig periode** — ca. hver
anden måned. [TILPAS: hvad er en rolig periode i dette produkt? Aldrig midt i
spidsbelastning — flere af punkterne inviterer til ændringer.]

## Sådan kører du det

Gennemgå de ti punkter herunder. Undersøg reelt — gæt ikke. Slut med **én
prioriteret liste** til brugeren: hvad haster, hvad kan vente, og hvad vi
bevidst lever med.

### 1. Forbrug og kvoter

[TILPAS: hvad koster penge i dette projekt — database-læsninger, API-kald,
compute, mails?] Led efter det, der er vokset stille: brede
lyttere/forespørgsler der filtrerer i klienten, jobs der fyrer pr. element
hvor de kunne køre pr. batch, fuld-scan hvor et opslag ville gøre. Regn på det
største fund: mængde pr. periode gange antal brugere. Et tal er mere
overbevisende end en bekymring.

### 2. Driften mellem deployene

Release Manager ser deployet — ikke ugerne efter. Undersøg:

- **Fejllogs**: åbn produktionsloggene og led efter fejl, ingen har set. En
  fejl, der har stået der i to måneder, er et hul i alarmeringen, ikke kun i
  koden.
- **Scheduled jobs**: kører de stadig? Sammenhold seneste kørsel med den
  forventede kadence — et job, der stille er holdt op, opdages ellers først,
  når dets resultat udebliver på det værst tænkelige tidspunkt.
- **Udgående beskeder** (mails, notifikationer): sendes de, og kommer de frem?
  Kvoteforbrug og bounces.
- **Alarmerne selv**: en alarm, der aldrig har fyret, er enten et sundhedstegn
  eller død. Afgør hvilken — fremprovokér en testfejl, hvis det er den eneste
  måde at vide det på.

### 3. Bundle og indlæsningstid

Kør projektets build og kig på chunk-størrelserne. Er noget tungt havnet i
hovedbundtet igen, eller er en side, der burde være lazy-loaded, blevet
importeret direkte et sted? Sig hvad der er **vokset siden sidst**, ikke bare
hvad der er stort.

### 4. Afhængigheder

Kør projektets outdated-/audit-tjek, og se om der ligger åbne opdaterings-PR'er
og samler støv. Skil reelle sårbarheder fra støj: en advarsel i et
build-værktøj rammer ikke brugerne. Majors tages én ad gangen.

### 5. Dokumentations-drift

Den farligste form for forældet dokumentation er den, der ser rigtig ud.
Stikprøv: passer README og arkitektur-/admin-dokumenterne stadig på det, der
faktisk findes? Henter hjælpeteksterne i fladen stadig deres tal fra koden,
eller er de drevet fra den? Historiske dokumenter (statusrapporter, gamle
reviews) skal være **mærket som historiske**, ikke rettet — de er et referat
af et tidspunkt.

### 6. Fuld sikkerhedsgennemgang

Kør **Security Reviewer**-agenten på hele overfladen, ikke kun på en diff:
alle server-regler, alle endpoints/callables, invitations- og
tilmeldingsflowet, admin-rettighederne. Bed eksplicit om kontroltests, så vi
ved, at opsætningen virker.

Tjek også de rigtige data: er der brugere med roller, de ikke skal have
længere? Adgangskoder/invitationer der aldrig blev brugt op? Konti fra sidste
periode, der stadig har adgang?

### 7. Testsuitens sundhed

Kør ALLE testkommandoerne fra CLAUDE.md — hver eneste skal være grøn. Spørg
derudover:

- Ligger der testfiler, som test-runnerens konfiguration (include-lister,
  mønstre) aldrig kører?
- Er noget blevet flaky (`Date.now()` uden fastfrysning,
  rækkefølgeafhængighed)?
- Er der kode, der er blevet forretningskritisk siden sidst, uden at
  dækningen fulgte med?

### 8. Brugsværdien

Kør **domæne-rådgiver**-agenten retrospektivt på perioden i stedet for på en
plan: hvilke features blev brugt, hvilke gav reaktioner, og hvilke faldt døde?
Hvor faldt aktiviteten — og hvornår? Fodr agentens hukommelse med svarene; det
er dét, der gør dens næste plan-vurdering bedre end et gæt. Ét konkret forslag
til næste periode er nok — ti er støj.

### 9. Rollernes hukommelse

Agenterne fører selv deres viden i `.claude/agent-memory/`. Stikprøv den:

- Står der faldgruber, der ikke findes længere — rettet kode, fjernede filer,
  lukkede huller? Bed den relevante agent selv rydde op; ret ikke i hånden.
- Er noget vokset til støj, så kernen drukner i enkeltobservationer?
- Er mapperne committet, så viden følger repoet?

### 10. Backlogget

Gennemgå det, vi bevidst har udskudt, og spørg for hvert punkt: er det stadig
det rigtige valg? Nogle ting bliver billigere at rette i en rolig periode —
og dyrere, når der er travlt.

## Din udmelding

Kort. Én prioriteret liste med tre kurve:

1. **Skal rettes nu** — med begrundelse, ikke bare en alvorsgrad.
2. **Kan vente** — men skriv hvornår det bliver et problem.
3. **Lever vi med** — så vi ikke genfinder det næste gang og bruger tid på
   det igen.

Fandt du intet alvorligt, så sig dét, og nævn hvad du faktisk efterprøvede.
Et eftersyn uden fund er et gyldigt resultat — et eftersyn uden bevis er ikke.
