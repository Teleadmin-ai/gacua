# Recette : save-test2-oneshot

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-q8-32k
- **Duree totale** : 58s (1 etapes, 13 tours)
- **Session** : `save-test2-oneshot` (id: `2026-02-09T19-28-53-007Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `You are looking at a Windows desktop with application icons and a taskbar at the bottom.

Do the following steps in order:

1. OPEN LibreOffice Writer: Click the Windows Start button (bottom-left corner of the taskbar). A search menu will appear. Type "writer" and click on "LibreOffice Writer" when it appears in the search results.

2. WAIT for LibreOffice Writer to open. You will see a blank white document with a menu bar at the top showing "Fichier", "Edition", "Affichage", etc.

3. TYPE in the document: Click in the white document area and type "Bonjour ceci est un test"

4. SAVE AS: Click on the "Fichier" menu (first item in the menu bar, top-left of the Writer window). A dropdown menu will appear. Click on "Enregistrer sous..." — it is the fourth item in the dropdown, right below "Enregistrer". Do NOT click on "Ouvrir" which is higher up in the menu.

5. In the Save As dialog that opens, you will see a filename field at the bottom of the dialog containing the default name. Click on that filename field, press Ctrl+A to select all, then type "test2" and press Enter to confirm the save.

After saving, call computer_done.`

**Actions** :
- click on "Windows Start button located at the bottom-left corner of the taskbar"
- type "writer"
- click on "LibreOffice Writer icon in the search results"
- wait ms
- click on "The white document area in the LibreOffice Writer window"
- type "Bonjour ceci est un test"
- click on "The "Fichier" menu item at the top-left of the LibreOffice Writer window"
- click on "The "Enregistrer sous..." option in the dropdown menu under the "Fichier" menu"
- click on "The filename field at the bottom of the Save As dialog"
- press key []
- type "test2"
- press key []
- computer_done({"summary":"Completed the task by opening LibreOffice Writer, typing 'Bonjour ceci est un test', saving the document as 'test2', and signaling completion."})

**Metrics** (13 tours, 58s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 938ms | 1518ms | 2067ms | 4523ms | computer_click |
| 2 | 894ms | 1279ms | 2889ms | 5062ms | computer_type |
| 3 | 1026ms | 996ms | 2091ms | 4113ms | computer_click |
| 4 | 1004ms | 476ms | 3035ms | 4515ms | computer_wait |
| 5 | 959ms | 682ms | 2223ms | 3864ms | computer_click |
| 6 | 884ms | 696ms | 8516ms | 10096ms | computer_type |
| 7 | 957ms | 857ms | 2443ms | 4257ms | computer_click |
| 8 | 921ms | 966ms | 2067ms | 3954ms | computer_click |
| 9 | 883ms | 917ms | 2198ms | 3998ms | computer_click |
| 10 | 951ms | 741ms | 1634ms | 3326ms | computer_key |
| 11 | 912ms | 1637ms | 2566ms | 5115ms | computer_type |
| 12 | 1040ms | 600ms | 1642ms | 3282ms | computer_key |
| 13 | 1144ms | 891ms | 0ms | 2035ms | computer_done |

