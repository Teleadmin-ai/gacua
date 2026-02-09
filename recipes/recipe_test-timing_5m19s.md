# Recette : test-timing

- **Date** : 2026-02-09
- **Modele** : gemini-3-flash-preview
- **Duree totale** : 5m19s (4 etapes, 10 tours)
- **Session** : `test-timing` (id: `2026-02-09T10-18-39-413Z`)
- **Statut** : OK

## Etape 1

**Prompt** : `Bonjour, je suis ton orchestrateur et je te donnerai mon instruction au prochain message`

**Metrics** (1 tours, 23s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 1014ms | 22029ms | 0ms | 23043ms | done |

## Etape 2

**Prompt** : `Ouvre le menu Demarrer et lance Bloc-notes (Notepad).`

**Actions** :
- click on "Start button"
- press key []
- click on "Search bar "Rechercher""
- click on "Bloc-notes in the search menu list"
- computer_done({"summary":"J'ai ouvert le menu de recherche et lancé le Bloc-notes (Notepad)."})

**Metrics** (5 tours, 3m35s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 883ms | 24419ms | 5526ms | 30828ms | computer_click |
| 2 | 839ms | 66436ms | 328ms | 67603ms | computer_key |
| 3 | 915ms | 37221ms | 6197ms | 44333ms | computer_click |
| 4 | 1140ms | 40123ms | 6664ms | 47927ms | computer_click |
| 5 | 642ms | 24107ms | 0ms | 24749ms | computer_done |

## Etape 3

**Prompt** : `Appuie sur Ctrl+N pour ouvrir un nouveau document vierge dans le Bloc-notes.`

**Actions** :
- press key []
- computer_done({"summary":"J'ai appuyé sur Ctrl+N pour ouvrir un nouveau document vierge dans le Bloc-notes."})

**Metrics** (2 tours, 38s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 630ms | 21130ms | 1637ms | 23398ms | computer_key |
| 2 | 527ms | 14073ms | 0ms | 14600ms | computer_done |

## Etape 4

**Prompt** : `Tape ce texte dans le Bloc-notes : Test de timing GACUA - 9 fevrier 2026`

**Actions** :
- type "Test de timing GACUA - 9 fevrier 2026"
- computer_done({"summary":"J'ai tapé le texte \"Test de timing GACUA - 9 fevrier 2026\" dans le Bloc-notes."})

**Metrics** (2 tours, 43s) :

| Tour | Screenshot | Planning | Execution | Total | Actions |
|------|-----------|----------|-----------|-------|--------|
| 1 | 607ms | 15058ms | 12472ms | 28137ms | computer_type |
| 2 | 520ms | 14242ms | 0ms | 14762ms | computer_done |

