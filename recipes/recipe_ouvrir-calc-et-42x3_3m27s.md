# Recette : ouvrir-calc-et-42x3

- **Date** : 2026-02-08
- **Modele** : gemini-3-flash-preview
- **Duree totale** : 3m27s (2 etapes, 13 tours)
- **Session** : `ouvrir-calc-et-42x3` (id: `2026-02-08T18-48-48-923Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Ouvre le menu Demarrer, tape calculatrice et lance l application`

**Actions** :
- click on "Start button icon on the taskbar"
- type "calculatrice"
- computer_done({"summary":"J'ai ouvert le menu Démarrer, tapé \"calculatrice\" et lancé l'application."})

**Metrics** (3 tours, 43s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 633ms | 6767ms | 3899ms | 11299ms | computer_click |
| 2 | 622ms | 12965ms | 5414ms | 19001ms | computer_type |
| 3 | 502ms | 12100ms | 0ms | 12602ms | computer_done |

## Etape 2

**Prompt** : `Dans la calculatrice, tape 42 multiplier par 3 et appuie sur egal`

**Actions** :
- type "42*3="
- click on "Clear button 'C' in the calculator"
- type "42*3="
- click on "Clear button 'C' in the calculator"
- click on "Button '4' in the calculator"
- click on "Button '2' in the calculator"
- click on "Multiply button 'x' in the calculator"
- click on "Button '3' in the calculator"
- click on "Equal button '=' in the calculator"
- computer_done({"summary":"J'ai tapé 42 multiplié par 3 dans la calculatrice et appuyé sur égal, obtenant le résultat 126."})

**Metrics** (10 tours, 2m45s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 522ms | 16618ms | 3201ms | 20341ms | computer_type |
| 2 | 558ms | 12910ms | 4300ms | 17768ms | computer_click |
| 3 | 557ms | 8632ms | 3193ms | 12382ms | computer_type |
| 4 | 522ms | 11315ms | 4083ms | 15920ms | computer_click |
| 5 | 517ms | 10715ms | 4918ms | 16150ms | computer_click |
| 6 | 585ms | 10507ms | 4259ms | 15351ms | computer_click |
| 7 | 518ms | 11313ms | 4002ms | 15833ms | computer_click |
| 8 | 518ms | 13250ms | 3763ms | 17531ms | computer_click |
| 9 | 535ms | 13884ms | 3651ms | 18070ms | computer_click |
| 10 | 520ms | 14704ms | 0ms | 15224ms | computer_done |

