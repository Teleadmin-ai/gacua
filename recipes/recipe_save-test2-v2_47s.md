# Recette : save-test2-v2

- **Date** : 2026-02-09
- **Modele** : qwen3-vl:8b-q8-32k
- **Duree totale** : 47s (1 etapes, 9 tours)
- **Session** : `save-test2-v2` (id: `2026-02-09T19-31-38-344Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `You are looking at a clean Windows desktop with application icons and a taskbar at the bottom. No windows are open.

Your task: Open LibreOffice Writer, type some text, and save the document as "test2".

Step by step:

1. Look for a LibreOffice Writer shortcut icon on the desktop. If you see one, double-click it. If you don't see one, click the Start button (bottom-left of taskbar) and look for LibreOffice Writer in the Start menu, then click on it.

2. Once Writer is open with a blank document, click in the white page area and type: Bonjour ceci est un test

3. Now save the document: open the "Fichier" menu (top-left of the menu bar). In the dropdown, click "Enregistrer sous..." which is located BELOW "Enregistrer" and ABOVE "Enregistrer une copie...". Be careful NOT to click "Ouvrir" or "Ouvrir un document recent" which are higher up in the same menu.

4. A Save As dialog will appear. At the bottom of this dialog there is a text field labeled "Nom du fichier" containing the default filename. Click in that field, select all with Ctrl+A, type test2 and press Enter.

When the document is saved and the title bar shows "test2", call computer_done.`

**Actions** :
- click on "LibreOffice Writer icon on the desktop"
- type "Bonjour ceci est un test"
- click on "Fichier menu in the top-left of LibreOffice Writer menu bar"
- click on "Enregistrer sous... option in the Fichier dropdown menu"
- click on "Nom du fichier text field in the Save As dialog"
- press key []
- type "test2"
- press key []
- computer_done({"summary":"The document has been saved as 'test2'."})

**Metrics** (9 tours, 47s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 930ms | 1554ms | 2080ms | 4564ms | computer_click |
| 2 | 892ms | 2110ms | 10870ms | 13872ms | computer_type |
| 3 | 905ms | 2096ms | 2236ms | 5237ms | computer_click |
| 4 | 883ms | 945ms | 2397ms | 4225ms | computer_click |
| 5 | 968ms | 965ms | 2222ms | 4155ms | computer_click |
| 6 | 924ms | 699ms | 1647ms | 3270ms | computer_key |
| 7 | 884ms | 779ms | 5036ms | 6699ms | computer_type |
| 8 | 1092ms | 760ms | 1642ms | 3494ms | computer_key |
| 9 | 1118ms | 677ms | 0ms | 1795ms | computer_done |

