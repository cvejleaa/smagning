# Projekt-skabelon

Udgangspunkt for nye projekter: gennemgangs-modellen med tre faste roller på
hver ændring (Test Manager, Quality Control, Release Manager) plus tre
betingede (Arkitekt på alt større end en enkelt rettelse, Security Reviewer
og en domæne-rådgiver), som subagenter i `.claude/agents/`, og arbejdsgangen
i `CLAUDE.md`.

## Nyt projekt fra skabelonen

1. På GitHub: **New repository → Repository template: cvejleaa/skabelon**
   (kræver at dette repo er markeret som template under Settings →
   ☑ Template repository).
2. Åbn det nye repo i Claude Code og sig: *"Gennemgå skabelonens
   [TILPAS]-markeringer sammen med mig og udfyld dem for det her projekt."*

## Tilpasnings-tjekliste (det, `[TILPAS]` markerer)

| Fil | Skal udfyldes |
|---|---|
| `CLAUDE.md` | test-/lint-/build-kommandoer nederst, CI-jobbene i trin 4, og sproget i Faste regler |
| `.claude/agents/release-manager.md` | miljø/workflow-tabellen, sti → kræver-tabellen, lumske deploy-defaults |
| `.claude/agents/security-reviewer.md` | trusselsbilledet (hvem er den realistiske angriber?) og hvilke stier der udløser rollen |
| `.claude/agents/quality-control-manager.md` | projektets fælder, invarianter og delte flader |
| `.claude/agents/test-manager.md` | forretningskritiske områder og test-lagene |
| `.claude/agents/arkitekt.md` | projektets grundform (apps/miljøer, spejlede filer) og hvor adgang afgøres |
| `.claude/agents/domaene-raadgiver.md` | HELE rollen — omdøb den gerne til noget produktnært (i spillet hed den Spilfører) |
| `.claude/commands/eftersyn.md` | hvad koster penge (punkt 1), og hvad en rolig periode er |

Skabelonen må gerne starte uudfyldt — rollerne virker fra dag ét og bliver
skarpere, efterhånden som felterne udfyldes og deres hukommelse i
`.claude/agent-memory/` vokser. (Reglerne for hukommelsen og modelvalget står
i `CLAUDE.md`, så de overlever, når denne README skrives om.)

## Bevidst udeladt fra kilden

Skabelonen er afledt af et levende projekts setup. Disse dele er IKKE med —
som beslutning, ikke forglemmelse:

- **Agent-hukommelsernes indhold** (`.claude/agent-memory/*.md`): projekt-
  specifik viden. Mappen er med (tom), og hvert projekt bygger sin egen op.
- **Kildens historiske eksempler** ("hver rolle har blokeret noget ægte",
  konkrete fejl med navne): de bærende lærestreger er anonymiseret ind i
  rolle-filerne og CLAUDE.md; resten er projekthistorie. Skriv jeres egne
  eksempler ind, når de sker — det er dem, der gør reglerne troværdige.
- **Drift- og vedligeholdelsesdokumenter** (`docs/drift.md` m.fl.): opret
  projektets egne, når der er drift at dokumentere. Eftersynets punkt 2 og
  Release Managers fire driftsspørgsmål peger på behovet.

## De tre principper, der bærer det hele

1. **Commit før gennemgang.** Gennemgange og mutationstest ser kun det
   committede — og mutationers tilbagerulning kan slette ukommitteret
   arbejde.
2. **En grøn suite beviser intet i sig selv.** Kun en mutation, der gør den
   rød, beviser dækning.
3. **Gennemgangs-rollerne skal kunne blokere — og alle roller skal sige
   klart fra eller klart god.** (Domæne-rådgiveren er bevidst kun
   rådgivende.) En rolle, der altid siger "ser fint ud", holder man op med
   at læse.

*(Slet dette afsnit og skriv projektets egen README, når projektet er i
gang — men behold tilpasnings-tjeklisten, til den er tom.)*
