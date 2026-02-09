# Recette : test-qwen-click

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-instruct-q8_0
- **Duree totale** : 8s (1 etapes, 2 tours)
- **Session** : `test-qwen-click` (id: `2026-02-09T12-25-23-282Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Click on the Windows Start button at the bottom left of the screen.`

**Actions** :
- click on "Windows Start button located at the bottom left corner of the screen"
- computer_done({"summary":"Clicked the Windows Start button at the bottom left of the screen."})

**Metrics** (2 tours, 8s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 578ms | 3057ms | 2127ms | 5762ms | computer_click |
| 2 | 588ms | 1521ms | 0ms | 2109ms | computer_done |

