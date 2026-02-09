# Recette : save-test2-v3

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-q8-32k
- **Duree totale** : 42s (1 etapes, 8 tours)
- **Session** : `save-test2-v3` (id: `2026-02-09T19-42-27-584Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Click on the Start menu at the bottom-left of the taskbar. You will see LibreOffice Writer in the Start menu, click on it to open it. Once it opens with a new blank document, type "Bonjour ceci est un test" in the document. Then click on the "Fichier" menu at the top-left, then click on "Enregistrer sous..." in the dropdown menu. In the Save As dialog, type "test2" in the filename field and press Enter to save.`

**Actions** :
- click on "the Start button on the taskbar at the bottom-left corner of the screen"
- click on "the LibreOffice Writer icon in the Start menu"
- type "Bonjour ceci est un test"
- click on "the "Fichier" menu item at the top-left of the LibreOffice Writer window"
- click on "the "Enregistrer sous..." option in the dropdown menu under the "Fichier" menu"
- type "test2"
- press key []
- computer_done({"summary":"Opened LibreOffice Writer, typed 'Bonjour ceci est un test', saved the document as 'test2'."})

**Metrics** (8 tours, 42s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 853ms | 5142ms | 2145ms | 8140ms | computer_click |
| 2 | 942ms | 1560ms | 2054ms | 4556ms | computer_click |
| 3 | 832ms | 1509ms | 10854ms | 13195ms | computer_type |
| 4 | 442ms | 975ms | 1898ms | 3315ms | computer_click |
| 5 | 431ms | 803ms | 1904ms | 3138ms | computer_click |
| 6 | 433ms | 872ms | 4742ms | 6047ms | computer_type |
| 7 | 452ms | 730ms | 1636ms | 2818ms | computer_key |
| 8 | 413ms | 731ms | 0ms | 1144ms | computer_done |

