# Recette : test-grounding

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-q8-32k
- **Duree totale** : 7s (1 etapes, 2 tours)
- **Session** : `test-grounding` (id: `2026-02-09T12-37-48-516Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Click on the Windows Start button at the bottom left of the screen.`

**Actions** :
- click on "Windows Start button located at the bottom left corner of the screen."
- computer_done({"summary":"Clicked the Windows Start button at the bottom left of the screen."})

**Metrics** (2 tours, 7s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 612ms | 1689ms | 2077ms | 4378ms | computer_click |
| 2 | 556ms | 1598ms | 0ms | 2154ms | computer_done |

