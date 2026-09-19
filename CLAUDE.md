# Arbejdsgang: hver ændring gennemgås af faste roller

(Fra projekt-skabelonen. Gennemgå `[TILPAS ...]`-markeringerne her og i
`.claude/agents/` som noget af det første i et nyt projekt — se README.md.)

Du arbejder efter en fast gennemgangs-model. Hver eneste ændring — også "bare
en lille fejlrettelse" — skal igennem tre faste roller, før den landes. Kør dem
som separate, uafhængige gennemgange (subagenter hvis muligt), når ændringen er
skrevet og valideret lokalt. Eneste undtagelse: rene tekstrettelser i
dokumentation uden kodeændring.

## De tre faste roller

| Rolle | Spørger | Kan blokere for |
|---|---|---|
| **Test Manager** | Er ændringen bevist? Mutationstest kernen — en grøn suite beviser intet i sig selv | at lande uden reel dækning |
| **Quality Control** | Løser den det RIGTIGE problem — og hvad rører den ellers ved? Kan brugerne forstå den? | at lande med en halv rettelse |
| **Release Manager** | Hvad skal deployes, i hvilken rækkefølge, og hvad tjekkes bagefter? | en forkert udrulning |

Dertil tre roller, der kun køres når opgaven kalder på det. De er med vilje
ikke faste: en sikkerhedsgennemgang af en tekstrettelse lærer ingen noget, og
en rolle, der altid siger "ser fint ud", holder man op med at læse.

- **Arkitekt**: køres FØR der skrives kode, på alt der er større end en enkelt
  rettelse. Skærer opgaven i delopgaver i en byggelig rækkefølge — og finder
  det, der IKKE skal bygges, fordi det allerede findes i koden under et andet
  navn. Den dyreste fejl er ikke en forkert plan, men en plan der genopfinder
  noget eksisterende.

- **Security Reviewer**: køres når ændringen rører adgangskontrol, auth,
  serverregler, invitationer — eller noget andet, der afgør hvem der ser hvad.
  Den skal ANGRIBE ændringen: konkrete skridt en fjendtlig bruger ville tage,
  efterprøvet mod den rigtige adgangsmodel (emulator/testmiljø), ikke
  ræsonneret.
- **Domæne-rådgiver** (tilpas navnet til produktet): vurderer om ændringen gør
  produktet bedre eller dårligere at BRUGE — og køres kun på PLANEN, før koden
  skrives (hvornår: se trin 0). Rådgivende, ikke blokerende: et "det her gør
  produktet dårligere" skal besvares i planen, ikke nødvendigvis adlydes.

Rollerne kører på hver sin model (sat i deres frontmatter — de hyppige på
billigere modeller, de sjældne på de stærkeste), og flere af dem fører en
varig hukommelse i `.claude/agent-memory/`, som committes med. Ret aldrig i
deres hukommelsesfiler i hånden midt i en gennemgang — de vedligeholder dem
selv.

## Rækkefølgen i praksis

00. Er opgaven større end en enkelt rettelse: kør **Arkitekten** på opgaven
   først. Dens plan (delopgaver, genbrug, rækkefølge) er det, de næste trin
   arbejder ud fra — og QC-på-plan og domæne-rådgiveren kan gennemgå DEN i
   stedet for en løs idé.
0. Tilføjer ændringen ny brugerflade eller nye tal på skærmen: kør Quality
   Control på PLANEN først — og kør den på opus (sig det ved invokationen;
   den kører ellers på sonnet). De dyreste fund er designfejl, ikke kodefejl —
   to minutter dér sparer en omskrivning. Rører planen KERNEOPLEVELSEN (det,
   domæne-rådgiveren dækker), så kør domæne-rådgiveren på planen samtidig —
   en dårlig feature, der først opdages færdigbygget, koster det samme som en
   designfejl.
0b. Får ændringen en knap eller en fane: afgør FØRST hvor den hører hjemme —
   det sted en bruger ville lede, ikke det sted der er nemmest at bygge.
   Spørg: hvad ville jeg selv klikke på, hvis jeg ikke havde skrevet koden?
   Intern konsistens taber til genfindelighed.
1. Skriv ændringen. Kør lint, relevante tests og build lokalt. (Findes
   lint/test/build endnu ikke i projektet, er opsætningen af dem en del af
   den FØRSTE opgave — uden dem har trin 2's roller intet at efterprøve
   imod.) Kontrollér at hver ændring faktisk landede — en tekst-erstatning
   der ikke matcher fejler tavst, og så står testfilen grøn uden at dække
   noget.
2. **Commit FØRST — kør så Test Manager og Quality Control parallelt** (plus
   Security hvis ændringen rører adgang). Test Manager muterer i sin egen
   worktree, som kun ser det committede: en ukommitteret ændring bliver
   aldrig gennemgået. Og kører du selv mutations-modbeviser i hovedtræet,
   så kør dem KUN mod committet kode — tilbagerulningen (`git checkout`)
   sletter ellers dit ukommitterede arbejde sammen med mutationen.
   Nævn branchen, når rollerne startes, så de gennemgår den rigtige kode.
   Ret det, rollerne finder, og modbevis hver rettelse (se Testprincipper).
3. Når de er grønne: kør Release Manager. Den kommer sidst, fordi planen
   afhænger af hvad der faktisk lander — inklusive rollernes afkrævede
   rettelser.
4. Commit → push → PR som draft → grøn CI → merge → deploy efter Release
   Managers plan. Spørg ikke om lov ved grøn CI og ingen blokerende fund.
   UNDTAGELSER hvor der altid spørges først: alt der skriver i
   produktionsdata (migreringer, bagfyldninger, seed-scripts),
   tilbagerulninger, og udrulninger med et blokerende fund.
   [TILPAS: har projektet endnu ikke CI, er trin 1's lokale kørsler gaten —
   og opsætning af CI (lint + tests + build på hver PR) er en af de første
   opgaver. Skriv jobbene her, når de findes.]
5. Verificér i produktion og fortæl brugeren, hvad der er live.

Rapportér rollernes konklusioner til brugeren, før du merger. Er en rolle
uenig, så løs det først — eller sig klart, hvad du lander med og hvorfor.

## Eftersyn

Rollerne kigger på én ændring ad gangen. Det, der vokser stille MELLEM
ændringerne — forbrug, bundle, forældede afhængigheder, dokumentation der er
drevet fra virkeligheden — ser ingen af dem. Det gælder også driften:
kvoteforbrug over tid, fejllogs ingen har kigget i, scheduled jobs der er
holdt op med at køre — og alarmerne selv: virker de stadig?

Kør derfor `/eftersyn` ca. hver anden måned, altid i en rolig periode.
Kommandoen ligger i `.claude/commands/eftersyn.md`.

## Testprincipper (det vigtigste afsnit)

**Antag, at dine egne tests bekræfter sig selv.** Kode og tests skrives af den
samme i samme åndedrag og indkoder samme forståelse — også når den er forkert.
Derfor er mutationstest ikke ekstra grundighed, men den eneste måde at vide om
noget er dækket: lav en målrettet, realistisk fejl i kernen og se suiten blive
RØD. Forbliver den grøn, er ændringen ikke bevist. Rul mutationen tilbage
bagefter — og kun mod committet kode.

Kendte måder, ubevist kode slipper igennem med grøn suite:

- **Et bånd, der rummer både før og efter, måler ingenting.** En test, der
  accepterer et interval, som både den gamle og den nye værdi ligger i, består
  med præcis den fejl, den skulle fange. Skriv båndet så den GAMLE værdi gør
  det rødt, og skriv begge tal i kommentaren.
- **En test, der kun tjekker at noget blev VIST, beviser ikke hvad der stod.**
  Assertér på indholdet — og på det, der IKKE må stå.
- **To vagter om samme regel betyder, at den ene kan fjernes med grøn suite.**
  Én vagt pr. sikkerhedsregel, samlet ét sted, så en mutation af den bliver
  rød.
- **En vagt, der genkendes på FRAVÆR af noget, kan fjernes helt uden at nogen
  test opdager det.** Genkend på positiv tilstedeværelse.
- **En test uden data beviser ingenting.** En test på et tomt fixture er grøn
  med logikken helt fjernet.

## Faste regler

- **Dansk** i UI, kommentarer, commits og PR-tekster. [TILPAS hvis projektet
  har et andet sprog.]
- **Skriv aldrig modelnavn** (AI-model) i commits, PR'er eller kode.
- **Farlige kommandoer:** [TILPAS — skriv de kommandoer/scripts her, der kan
  overskrive eller ødelægge produktionsdata, og hvad de i stedet kræver
  (tør-kørsel, andet miljø, spørg først). En regel som "kør aldrig X mod
  produktion" skal stå HER, ikke huskes.]
- **Spejlede/delte filer følges ad:** [TILPAS — findes samme logik i to
  eksemplarer (fx klient ⇄ server), så skriv parrene her. Den ene uden den
  anden er en halv ændring.]
- **Serveren er eneste autoritet.** Validering i klienten kan omgås. Server-
  adgangstjek må aldrig være mere gavmilde end klientens regler — og de skal
  ligge FØR de dyre operationer, så en afvisning er billig.
- **Et tal uden kode er en påstand.** Begrunder en måling en ændring, så
  commit måle-scriptet og henvis til det. Tal, der ikke kan efterprøves,
  gælder ikke.
- **Efterprøv begrundelsen på dét, den rammer — ikke på gennemsnittet.** En
  rettelse, der er rigtig i snit, kan gøre skade lokalt.
- **Ny funktionalitet, der kun kan startes af en tilfældig hændelse, er ikke
  færdig.** Spørg: hvordan starter jeg det her med vilje? Svaret er ofte en
  knap.
- **Ny funktionalitet, der kun kan fejle tavst, er heller ikke færdig.** Peg
  på loggen, alarmen eller admin-siden, hvor fejlen ville stå. Release
  Manager spørger efter det; svaret skal findes i planen, ikke opfindes ved
  deployet.
- **"Alle" er sjældent den rigtige modtagerkreds.** Rører en udsendelse ét
  spil/én gruppe/ét produkt, så vælg netop dén kreds.
- **Tør-kørsel først** på alt, der skriver i produktionsdata — og vis
  før/efter, før skrive-knappen overhovedet dukker op.
- **En afledning er først færdig med en opgørelse.** Kopieres eller
  generaliseres noget fra en kilde (et andet repo, en skabelon, et dokument),
  skal HVERT element i kilden være taget stilling til: med, generaliseret
  eller bevidst udeladt — og udeladelserne skrives ned med begrundelse. En
  gennemgang af afledningen skal tjekke mod KILDEN, ikke kun mod afledningen
  selv: indre konsistens fanger aldrig det, der mangler helt.

## Test-kommandoer

[TILPAS: skriv projektets faktiske lint-, test- og build-kommandoer her, så
de kun vedligeholdes ét sted. Nævn også, hvis test-runneren har eksplicitte
include-lister, som nye testfiler skal tilføjes til.]
