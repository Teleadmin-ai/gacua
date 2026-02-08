# Recette : Calculer 42x3 dans la Calculatrice

- **Date** : 2026-02-08
- **Modele** : gemini-3-flash-preview
- **Duree totale** : ~120s (session calculatrice deja ouverte)
- **Statut** : OK
- **Prerequis** : Calculatrice deja ouverte (voir recipe_ouvrir-calculatrice_44s.md)

## Prompt envoye

```
Dans la calculatrice, tape 42 multiplier par 3 et appuie sur egal
```

## Actions effectuees (retournees par l'API)

1. `computer_click` — Button 4 in Calculator
2. `computer_click` — Button 2 in Calculator
3. `computer_click` — Multiplication button in Calculator
4. `computer_click` — Button 3 in Calculator
5. `computer_click` — Equals button in Calculator
6. `computer_done` — "42 x 3 = 126"

## Notes

- Flash decompose correctement un calcul en clics individuels
- 5 clics + computer_done = 6 tours
- Chaque tour ~20s (planning + grounding + clic)
- Resultat correct : 126
