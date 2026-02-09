# Recette : test-calc-qwen

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-q8-32k
- **Duree totale** : 19s (1 etapes, 4 tours)
- **Session** : `test-calc-qwen` (id: `2026-02-09T12-54-36-654Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Open the Calculator app. Click the Start menu, type calculatrice, then click the Calculator app to launch it.`

**Actions** :
- click on "the Start menu button located at the bottom left corner of the screen"
- type "calculatrice"
- click on "the Calculator app icon in the Start menu search results"
- computer_done({"summary":"The Calculator app has been successfully opened by clicking the Start menu, typing 'calculatrice', and selecting the app from the search results."})

**Metrics** (4 tours, 19s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 673ms | 4956ms | 2062ms | 7691ms | computer_click |
| 2 | 608ms | 1485ms | 4830ms | 6923ms | computer_type |
| 3 | 636ms | 810ms | 2154ms | 3600ms | computer_click |
| 4 | 535ms | 706ms | 0ms | 1241ms | computer_done |

