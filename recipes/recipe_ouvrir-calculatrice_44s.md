# Recette : Ouvrir la Calculatrice Windows

- **Date** : 2026-02-08
- **Modele** : gemini-3-flash-preview
- **Duree totale** : 44s (3 tours)
- **Statut** : OK

## Prompt envoye

```
Ouvre le menu Demarrer, tape calculatrice et lance l application
```

## Actions effectuees (retournees par l'API)

1. `computer_click` — Windows Start button icon in the taskbar
2. `computer_type` — "calculatrice" (enter: true)
3. `computer_done` — "Calculatrice ouverte"

## Metrics par tour

| Tour | Screenshot | Planning | Execution | Total | Action |
|------|-----------|----------|-----------|-------|--------|
| 1 | 693ms | 6732ms | 3620ms | 11045ms | click Start |
| 2 | 588ms | 13474ms | 5392ms | 19454ms | type "calculatrice" + Enter |
| 3 | 508ms | 12732ms | 0ms | 13240ms | computer_done |

## Notes

- Flash fait tout en un seul message (pas besoin de decomposer)
- Le planning est le bottleneck (6-13s par tour)
- Enter=true dans le type fait que Flash lance l'app directement sans cliquer dessus
