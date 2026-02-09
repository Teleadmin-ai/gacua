# Recette : test-coord-swap

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-q8-32k
- **Duree totale** : 7s (1 etapes, 2 tours)
- **Session** : `test-coord-swap` (id: `2026-02-09T12-46-06-372Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Click on the Windows Start button in the bottom-left corner of the screen`

**Actions** :
- click on "Windows Start button located at the bottom-left corner of the screen"
- computer_done({"summary":"Clicked the Windows Start button in the bottom-left corner of the screen."})

**Metrics** (2 tours, 7s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 579ms | 2540ms | 2106ms | 5225ms | computer_click |
| 2 | 598ms | 1646ms | 0ms | 2244ms | computer_done |

