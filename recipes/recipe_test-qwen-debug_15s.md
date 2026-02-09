# Recette : test-qwen-debug

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-instruct-q8_0
- **Duree totale** : 15s (2 etapes, 3 tours)
- **Session** : `test-qwen-debug` (id: `2026-02-09T12-30-58-382Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Click on the Windows Start button at the bottom left of the screen.`

**Actions** :
- click on "Windows Start button located at the bottom left corner of the screen"
- computer_done({"summary":"Clicked the Windows Start button at the bottom left of the screen."})

**Metrics** (2 tours, 10s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 530ms | 4755ms | 2136ms | 7421ms | computer_click |
| 2 | 668ms | 1717ms | 0ms | 2385ms | computer_done |

## Etape 2

**Prompt** : `Click on the Windows Start button at the bottom left of the screen.`

**Metrics** (1 tours, 5s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 557ms | 4877ms | 0ms | 5434ms | done |

