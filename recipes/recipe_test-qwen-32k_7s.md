# Recette : test-qwen-32k

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-q8-32k
- **Duree totale** : 7s (1 etapes, 2 tours)
- **Session** : `test-qwen-32k` (id: `2026-02-09T12-33-36-603Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Click on the Windows Start button at the bottom left of the screen.`

**Actions** :
- click on "Windows Start button located at the bottom left corner of the screen."
- computer_done({"summary":"Clicked the Windows Start button at the bottom left of the screen."})

**Metrics** (2 tours, 7s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 569ms | 1972ms | 2045ms | 4586ms | computer_click |
| 2 | 535ms | 1591ms | 0ms | 2126ms | computer_done |

