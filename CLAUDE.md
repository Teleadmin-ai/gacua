# CLAUDE.md — GACUA (Computer Use Agent)

## Projet

GACUA (Gemini Agentic Computer Use Agent) - Fork Teleadmin
- **Repo** : github.com/Teleadmin-ai/gacua (fork de openmule/gacua)
- **Upstream** : github.com/openmule/gacua (113 stars, 18 forks)
- **Dossier local** : `C:\Users\teleadmin\gacua\`
- **Techno** : TypeScript, Node.js >= 20, monorepo npm workspaces
- **SDK Gemini** : `@google/genai` v1.13.0
- **Licence** : Apache-2.0

## Etat du projet upstream

- Dernier commit upstream : **2025-09-12** (5 mois sans activite)
- Seulement 4 commits propres GACUA, le reste herite de gemini-cli
- 0 issues ouvertes, pas de releases
- **Projet peu maintenu** — a considerer comme une base a forker et etendre

## Architecture

Monorepo avec 5 packages :

```
packages/
├── core/              # Coeur Gemini CLI (auth, tools, config, MCP client)
│   └── src/
│       ├── core/contentGenerator.ts  # Interface ContentGenerator (abstraction API)
│       ├── core/geminiChat.ts        # Chat session + flash fallback
│       ├── core/loggingContentGenerator.ts  # Decorator logging
│       ├── core/prompts.ts           # System prompts
│       ├── config/models.ts          # Modeles par defaut
│       └── code_assist/converter.ts  # Conversion requetes Vertex/Gemini
├── cli/               # Interface CLI terminal (Gemini CLI)
├── gacua/
│   ├── backend/       # Serveur Express (port 3000) + WebSocket + agent
│   │   └── src/
│   │       ├── services/computer-use/agent.ts     # BOUCLE AGENT PRINCIPALE
│   │       ├── services/computer-use/interface.ts  # Orchestration sessions
│   │       ├── services/computer-use/screen.ts     # Screenshot + crop
│   │       ├── services/computer-use/tool-computer/ # Outils (click, type...)
│   │       ├── server.ts              # API REST + static files
│   │       └── ws/                    # WebSocket (streaming UI)
│   ├── frontend/      # React + Vite (UI web)
│   └── mcp-computer/  # Serveur MCP SSE (port 10001) - controle souris/clavier
├── test-utils/
└── vscode-ide-companion/
```

## Flow d'execution (Two-Step Grounding)

Chaque tour d'agent = **2 appels API Gemini** sequentiels :

```
1. PLANNING (1er appel API) — agent.ts:485-501
   Screenshot ecran → Crop en carres 768x768 → Envoi a Gemini
   Config: temperature=0.2, thinking=true (illimite), tools=[computer_*]
   → Gemini retourne: computer_click(image_id=0, element_description="le bouton X")

2. GROUNDING (2eme appel API) — agent.ts:90-124
   Crop[image_id] + "Click on: le bouton X" → Envoi a Gemini (grounding agent)
   Config: temperature=0.0, thinking=256 tokens, JSON schema response
   System: "You are a UI grounding agent. Return bounding box [ymin,xmin,ymax,xmax] 0-1000"
   → Retourne { "box_2d": [y1, x1, y2, x2] }
   → Conversion en coordonnees ecran reelles → Execution de l'action
```

C'est par design ("Image Slicing + Two-Step Grounding") pour la precision.
Le bottleneck est le temps des 2 appels API + le thinking de Gemini.

## Utilisation de l'API Gemini — Audit detaille

### Ce que Gemini fait concretement :

1. **Vision** : Recoit des screenshots PNG base64 (croppes en 768x768), les "voit"
2. **Raisonnement** : Pense (extended thinking) a quoi faire ensuite
3. **Function calling** : Retourne un appel de fonction structure (computer_click, computer_type...)
4. **Localisation UI** : Trouve un element dans une image et retourne ses coordonnees (bounding box)

### Points d'appel API :

| Lieu | Type | Input | Output |
|------|------|-------|--------|
| `agent.ts` (boucle principale) | Planning | Screenshots + historique | Texte + function calls |
| `agent.ts` (grounding agent) | Grounding | 1 crop + description | JSON bounding box |

### Features Gemini utilisees :

| Feature | Fichier | Substituable ? |
|---------|---------|----------------|
| Vision (images inline base64) | agent.ts | Oui (Claude, OpenAI, Qwen) |
| Function calling / tools | agent.ts + tool-computer/*.ts | Oui (format different) |
| Extended thinking | agent.ts (thinkingConfig) | Oui (Claude thinking, o1/o3) |
| JSON schema output | agent.ts:100-115 | Oui (Claude JSON, OpenAI structured) |
| thoughtSignature | agent.ts (Gemini 3 specifique) | Non — a supprimer si autre model |
| Streaming | contentGenerator.ts | Oui (tous les providers) |

### Abstraction existante :

L'interface `ContentGenerator` (`core/src/core/contentGenerator.ts`) fournit :
- `generateContentStream(request, promptId)` → AsyncGenerator<Response>
- `generateContent(request, promptId)` → Response
- `countTokens(request)` → TokenCount

Mais les **types Gemini** (`GenerateContentResponse`, `Part`, `Content`, `FunctionDeclaration`)
coulent partout dans le code. Un adapter est necessaire pour un autre provider.

### Strategie multi-model (future) :

Ne PAS remplacer Gemini mais **ajouter** d'autres providers :
- Creer un adapter dans contentGenerator.ts qui traduit requetes/reponses
- Le grounding (appel 2) est le plus simple a adapter : vision + JSON output
- Le planning (appel 1) necessite vision + function calling + thinking
- Un GPU local avec un modele vision (ex: Qwen-VL, LLaVA) pourrait accelerer le grounding
- Garder Gemini comme option par defaut

## API OpenAI-compatible (IMPLEMENTEE)

**Fichier** : `packages/gacua/backend/src/api/openai-compat.ts`
**Monte dans** : `server.ts` via `app.use(apiRouter)`

Permet a un agent LLM externe de piloter GACUA par messages texte,
sans interface graphique. L'agent envoie des ordres en langage naturel
et recoit du feedback texte au format OpenAI.

### Auth

Supporte les deux modes :
- `Authorization: Bearer <token>` (standard OpenAI)
- `?token=<token>` (compatibilite existante)

### Modeles exposes

| ID API | Modele Gemini reel |
|--------|--------------------|
| `gacua-gemini-3-pro` | gemini-3-pro-preview |
| `gacua-gemini-3-flash` | gemini-3-flash-preview |

Les noms Gemini natifs sont aussi acceptes directement.

### Endpoints /v1/*

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | /v1/models | Liste les modeles disponibles |
| GET | /v1/sessions | Liste les sessions existantes |
| POST | /v1/sessions | Creer une session (body: `{name?, model?}`) |
| DELETE | /v1/sessions/:id | Supprimer une session (+ images + messages) |
| GET | /v1/sessions/:id/messages | Historique texte d'une session |
| POST | /v1/chat/completions | Envoyer un message, recevoir le feedback |

### POST /v1/chat/completions

```json
// Request
{
  "model": "gacua-gemini-3-pro",
  "session_id": "2026-02-08T...",   // optionnel, auto-cree si absent
  "messages": [
    { "role": "user", "content": "Ouvre Firefox et va sur google.com" }
  ],
  "stream": false                    // true pour SSE streaming
}

// Response (non-streaming)
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "gacua-gemini-3-pro",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "J'ai ouvert Firefox..." },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "session_id": "2026-02-08T..."
}
```

### Flow interne

```
1. Parse requete OpenAI
2. Si pas de session_id → sessionManager.createSession()
3. Extraire le dernier message user
4. Appeler runComputerUseAgent(sessionId, input, model, emitEvent) directement
5. emitEvent callback collecte le texte (stream_message + persistent_message)
6. Retourner le texte au format OpenAI (ou streamer en SSE)
```

### Exemples curl

```bash
# Lister modeles
curl http://localhost:3000/v1/models -H "Authorization: Bearer TOKEN"

# Lister sessions
curl http://localhost:3000/v1/sessions -H "Authorization: Bearer TOKEN"

# Creer session
curl -X POST http://localhost:3000/v1/sessions \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","model":"gemini-3-pro-preview"}'

# Chat completion (attention: execute des actions sur le PC!)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gacua-gemini-3-pro","messages":[{"role":"user","content":"Quelle heure est-il?"}]}'

# Chat completion avec streaming SSE
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gacua-gemini-3-pro","stream":true,"messages":[{"role":"user","content":"Ouvre le bloc-notes"}]}'
```

## Modifications Teleadmin

### 1. Gemini 3 Pro (modele par defaut)
- **Fichier** : `packages/core/src/config/models.ts`
- `DEFAULT_GEMINI_MODEL = 'gemini-3-pro-preview'`
- `DEFAULT_GEMINI_FLASH_MODEL = 'gemini-3-flash-preview'`

### 2. Fix thoughtSignature (requis pour Gemini 3)
Gemini 3 exige que les `thoughtSignature` soient preserves dans l'historique des function calls.
- **Fichier principal** : `packages/gacua/backend/src/services/computer-use/agent.ts`
  - Extraction depuis `resp.candidates[0].content.parts` (pas `resp.functionCalls`)
  - Preservation lors du grounding (ligne ~628)
  - Structure correcte : `{ functionCall: {...}, thoughtSignature: "..." }` (au meme niveau)
- **Fichier types** : `packages/gacua/shared/src/types.ts`
  - `FunctionCall.thoughtSignature?: string`
  - ContentBlock avec `thoughtSignature?: string`
- **Fichier interface** : `packages/gacua/backend/src/services/computer-use/interface.ts`
  - `partToPersistentContentBlock()` et `persistentContentBlockToPart()` preservent la signature

### 3. Auto-accept des actions
- **Fichier** : `packages/gacua/backend/src/services/computer-use/interface.ts` (~ligne 252)
- Tous les outils computer auto-acceptes par defaut (pas besoin de validation manuelle)
- Outils : computer_click, computer_type, computer_key, computer_scroll, computer_wait, computer_drag_and_drop

### 4. Fix SSE keep-alive (anti-deconnexion MCP)
- **Fichier** : `packages/gacua/mcp-computer/src/server.ts` (ligne 40)
- `PING_INTERVAL_MS = 25000` (25s au lieu de 180s)
- Previent les deconnexions par timeout reseau

### 5. Frontend - Modeles Gemini 3
- **Fichier** : `packages/gacua/frontend/src/App.tsx` — Default model gemini-3-pro-preview
- **Fichier** : `packages/gacua/frontend/src/components/Input.tsx` — Selecteur avec Gemini 3 Pro/Flash

### 6. Suppression de sessions (deleteSession)
- **Fichier** : `packages/gacua/backend/src/repository/session.ts` — `deleteSession()` avec protection path traversal
- **Fichier** : `packages/gacua/backend/src/services/session/manager.ts` — `deleteSession()` avec verification d'existence
- **Fichier** : `packages/gacua/backend/src/server.ts` — `DELETE /api/sessions/:id`
- **Fichier** : `packages/gacua/backend/src/api/openai-compat.ts` — `DELETE /v1/sessions/:id`

### 7. Bouton suppression sessions (frontend)
- **Fichier** : `packages/gacua/frontend/src/components/Sessions.tsx` — Icone poubelle sur chaque session
- **Fichier** : `packages/gacua/frontend/src/App.tsx` — Callback `deleteSession` (appel DELETE /api/sessions/:id)

### 8. Fix leak connexions MCP (closeAllMcpClients)
- **Fichier** : `packages/core/src/tools/mcp-client.ts` — `activeMcpClients` Map + `closeAllMcpClients()` export
- **Fichier** : `packages/gacua/backend/src/services/computer-use/interface.ts` — `finally` block apres `runAgent()`
- Import : `import { closeAllMcpClients } from '@gacua/gemini-cli-core'`

### 9. Screenshot URL dans reponse API
- **Fichier** : `packages/gacua/backend/src/api/openai-compat.ts`
- `AgentResult.screenshotUrl` : track le dernier screenshot depuis les events `persistent_message`
- Ajoute `screenshot_url` dans la reponse JSON de `/v1/chat/completions`
- Filtre : seuls `_screenshot.png` (pas les crops `_vc0`, `_vc1`, `_vc2`, ni `_annotated`)
- Permet a un orchestrateur externe de voir l'ecran entre chaque etape

### 10. Fix Flash grounding — tool descriptions renforcees
Flash 3 envoyait parfois `image_id` sans `element_description` (ou inversement), ce qui
declenchait l'erreur "When image_id is provided, element_description must be provided".
Ce n'etait PAS un bug du code mais un comportement du modele Flash.
- **Fichier** : `packages/gacua/backend/src/services/computer-use/tool-computer/type.ts`
- **Fichier** : `packages/gacua/backend/src/services/computer-use/tool-computer/scroll.ts`
- Ajout de "IMPORTANT: if you provide image_id, you MUST also provide element_description"
  dans les descriptions des parametres `image_id` et `element_description`
- **Impact majeur** : avant ce fix, Flash echouait a la 2eme action d'une sequence (grounding error),
  donnant l'impression qu'il ne faisait qu'une action. Apres le fix, Flash enchaine les actions
  de facon autonome dans la boucle agent.

### 11. MCP timeout 30s (fail fast sur deconnexion SSE)
- **Fichier** : `packages/gacua/backend/src/services/computer-use/interface.ts`
- Ajout de `timeout: 30_000` dans la config du serveur MCP `.computer`
- Le timeout par defaut de `mcp-client.ts` est 10 minutes (`MCP_DEFAULT_TIMEOUT_MSEC = 10 * 60 * 1000`)
- Quand la connexion SSE tombe en cours de run, le prochain `callTool` attendait 10 min pour rien
- Avec 30s : fail rapide, le prochain appel API cree une nouvelle connexion MCP
- Note : pas de reconnexion MCP au sein d'un `runAgent()`. C'est le prochain `runComputerUseAgent()`
  qui cree un nouveau Config → nouvelle connexion MCP.

### 12. Crop count dans la description screenshot
- **Fichier** : `packages/gacua/backend/src/services/computer-use/agent.ts`
- Flash demandait parfois `image_id: 3` alors que seuls 3 crops existent (indices 0, 1, 2)
- Erreur : "Image ID exceeds the number of cropped screenshots: 3 >= 3"
- Fix : ajout du nombre de crops dans le texte envoye a Gemini :
  `"The screen is split into 3 cropped images with valid image_id values from 0 to 2"`
- Flash sait maintenant combien de crops il y a et quels indices sont valides

### 13. Outil computer_done — signal d'arret explicite
**Probleme** : apres les fixes 10-12, Flash enchainait les actions avec succes mais ne savait
pas quand s'arreter. La boucle `while(true)` continuait indefiniment car Flash retournait
toujours des function calls au lieu de s'arreter (0 function calls).
Avant les fixes, les erreurs de grounding agissaient comme un frein naturel.
Apres les fixes, Flash etait trop performant et ne lachait plus la main.

**Solution** : un outil `computer_done` que Flash appelle pour signaler qu'il a fini.
- **Fichier** : `packages/gacua/backend/src/services/computer-use/tool-computer/index.ts`
  - Declaration de `computer_done` avec parametre `summary` (description de ce qui a ete fait)
  - Ajoute a la liste des function declarations envoyees a Gemini
- **Fichier** : `packages/gacua/backend/src/services/computer-use/agent.ts`
  - Detection de `computer_done` dans les function calls → `setSessionStatus('stagnant', summary)` + break
  - Rappel APRES les images dans chaque tour : "IMPORTANT: When you have completed the user's task,
    you MUST call computer_done with a summary instead of performing more actions."
  - Le rappel est place APRES les images car c'est la derniere chose que Flash voit avant de decider

**Resultat** : Flash enchaine les actions puis appelle `computer_done` quand il a fini.
Exemple : "Ouvre la calculatrice et fais 42×3" → Flash fait 7 tours (click Start, type calc,
click app, click 4, click 2, click ×, click 3, click =, computer_done) en ~2 min.

### 14. Logs de timing par phase (diagnostic)
- **Fichier** : `packages/gacua/backend/src/services/computer-use/agent.ts`
- Chaque tour logue les durees de chaque phase :
  - `=== TURN START ===` avec turnCount
  - `phase: 'screenshot'` — duree du screenshot MCP
  - `phase: 'planning'` — duree de l'appel API Gemini (planning + streaming)
  - `phase: 'execution'` — duree du grounding + execution des outils
  - `turnDurationMs` — duree totale du tour
- Permet de diagnostiquer ou le temps est passe et detecter les hangs

### 15. Sauvegarde automatique des recettes (recipe-saver)
- **Fichier** : `packages/gacua/backend/src/services/recipe-saver.ts`
- **Fichier** : `packages/gacua/backend/src/api/openai-compat.ts`
- Apres chaque `/v1/chat/completions` reussi, `appendRecipeStep()` est appele
- Les recettes **s'accumulent par session** dans un `Map<sessionId, SessionRecipe>` en memoire
- Le fichier `recipes/recipe_{nom-session}_{duree}.md` est reecrit a chaque etape
- Si le nom de fichier change (duree augmente), l'ancien fichier est supprime auto
- Le CLAUDE.md est mis a jour entre `<!-- RECIPES_START/END -->` avec la table des recettes
- **Titre = nom de session** choisi par l'orchestrateur (pas le summary de computer_done)
- `clearSessionRecipe(sessionId)` appele quand on DELETE une session (libere la memoire)
- Les actions sont trackees proprement dans `AgentResult.actions[]` (pas du parsing regex)

## Commandes

```bash
# Build (obligatoire apres chaque modification)
cd ~/gacua && npm run build

# Lancer en production (backend sert le frontend)
npm run start:gacua

# Dev mode (hot-reload frontend:5173 + backend:3000)
npm run dev:gacua

# IMPORTANT: ne PAS utiliser npx gacua ou gacua (version npm, pas locale)
```

## Demarrer GACUA et recuperer le token (procedure orchestrateur)

L'orchestrateur (moi, Claude) peut lancer le serveur GACUA et recuperer le token
automatiquement sans intervention humaine.

### Token : comment ca marche

- **Genere au demarrage** : 32 bytes random → 64 caracteres hex
- **En memoire uniquement** : pas de fichier, pas d'env var, pas dans les logs
- **Imprime dans le stdout** : la seule source est le console output du serveur
- **Expire en 24h** : apres ca, il faut redemarrer le serveur
- **Fichier** : `packages/gacua/backend/src/auth/token.ts`

### Procedure complete

```bash
# 1. Verifier si le serveur tourne deja
curl -s --max-time 2 http://192.168.11.13:3000/api/health 2>/dev/null
# Si reponse 403 → serveur tourne mais token inconnu (demander a Romain)
# Si timeout/erreur → serveur pas lance, continuer ci-dessous

# 2. Build si necessaire (apres modif code)
cd ~/gacua && npm run build

# 3. Lancer le serveur en background et capturer le stdout
cd ~/gacua && npm run start:gacua > /tmp/gacua-start.log 2>&1 &
sleep 15  # Attendre l'auth Gemini + demarrage Express

# 4. Extraire le token du stdout
GACUA_TOKEN=$(grep -oP 'token=\K[0-9a-f]{64}' /tmp/gacua-start.log | head -1)
echo "Token: $GACUA_TOKEN"

# 5. Verifier que ca marche
curl -s "http://192.168.11.13:3000/api/health?token=$GACUA_TOKEN"
# → {"message":"healthy"}

# 6. Utiliser l'API
curl -s -X POST "http://192.168.11.13:3000/v1/sessions" \
  -H "Authorization: Bearer $GACUA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"ma-session","model":"gemini-3-flash-preview"}'
```

### Reflexe autonome

**REGLE** : quand j'ai besoin de GACUA, je DOIS d'abord tenter de me debrouiller seul :
1. Tester si le serveur tourne : `curl -s --max-time 2 http://192.168.11.13:3000/api/health`
2. Si pas de reponse → lancer le serveur moi-meme (procedure ci-dessus)
3. Si reponse 403 (serveur tourne, token inconnu) → demander le token a Romain
   (c'est le seul cas ou je dois demander)

### Quand Romain donne le token

Souvent Romain colle l'URL du serveur dans le chat :
`http://192.168.11.13:3000?token=abc123...`
→ Extraire le token de l'URL et l'utiliser directement.

### Arreter le serveur

```bash
# Trouver et tuer le process
# Option 1 : si lance en background dans ce shell
kill %1

# Option 2 : trouver le PID
# Sur Windows (cmd.exe, pas bash) :
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# Option 3 : tuer aussi le MCP server
netstat -ano | findstr :10001
taskkill /PID <pid> /F
```

## Authentification Gemini

GACUA reutilise la config de Gemini CLI :
- `~/.gemini/` — Tokens OAuth Google
- 4 modes : Google Login (OAuth), Cloud Shell, API Key, Vertex AI
- Compte Teleadmin : Gemini Ultra (180 EUR/mois) — acces a tous les modeles

## Ports

| Port  | Service |
|-------|---------|
| 3000  | Backend Express + WebSocket + Frontend |
| 10001 | MCP Computer Server (SSE) |

## Orchestration par API

### Principe fondamental

L'agent GACUA a une boucle `while(true)` : apres chaque action, il reprend un screenshot,
le renvoie a Gemini, et Gemini decide s'il veut agir encore ou s'arreter (via `computer_done`).

**Flash peut enchainer plusieurs actions de facon autonome** pour une instruction complete.
Par exemple "Ouvre Notepad, tape du texte, et sauvegarde" → Flash fait 4+ tours tout seul.
Mais pour des workflows complexes (ex: envoyer un email Gmail), il est plus fiable de
**decomposer en etapes atomiques** envoyees sequentiellement via l'API.

### Architecture orchestrateur / executeur

L'intelligence est dans **l'orchestrateur** (LLM externe comme Claude), pas dans Gemini.
Gemini est un executeur semi-autonome — il voit l'ecran, planifie et execute les actions.
Pour une instruction simple et complete, il peut enchainer plusieurs actions seul.
L'orchestrateur est le cerveau qui planifie les grandes etapes, observe et s'adapte.

```
┌─────────────────────────────────────────────────────┐
│              ORCHESTRATEUR                            │
│  Actuellement : Claude Code (ce fichier)             │
│  Futur : OpenClaw (serveur distant)                  │
│                                                      │
│  1. Message neutre → screenshot initial              │
│  2. Analyse le screenshot (vision)                   │
│  3. Decide la prochaine action                       │
│  4. Envoie l'instruction a GACUA                     │
│  5. Fetch le screenshot → verifie le resultat        │
│  6. Boucle jusqu'a la fin de la tache                │
│  7. Sauvegarde/ameliore la recette                   │
│                                                      │
└──────────────┬──────────────────────────────────────┘
               │  API /v1/chat/completions
               ▼
┌─────────────────────────────────────────────────────┐
│              GACUA (Gemini executeur)                 │
│                                                      │
│  - Recoit une instruction                            │
│  - Boucle: Screenshot → Planning → Grounding → Exec  │
│  - Enchaine les actions de facon autonome             │
│  - S'arrete via computer_done (signal explicite)      │
│  - Retourne : texte + screenshot_url + metrics        │
│  - Ne memorise rien entre les sessions               │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Note** : Claude Code (moi) est l'orchestrateur principal pour le moment.
A terme, OpenClaw prendra ce role depuis un serveur distant.

### Protocole orchestrateur — OBLIGATOIRE

Quand Romain demande de piloter GACUA, je DOIS suivre ce protocole complet.
Ce n'est PAS une liste de conseils, c'est la procedure de travail.

#### Phase 1 — OBSERVER la scene (NE JAMAIS SAUTER CETTE ETAPE)

**Regle** : avant toute action, se demander **"Est-ce que je sais ce qu'il y a a l'ecran ?"**
- Si OUI (screenshot deja vu plus tot dans cette conversation) → passer a Phase 2
- Si NON (premiere solicitation, ou doute) → **message neutre obligatoire**

Le message neutre declenche un screenshot sans action de la part de Gemini :

```
1. Envoyer un message neutre a GACUA :
   → "Bonjour, je suis ton orchestrateur."
   (Gemini prend un screenshot, ne fait rien, et appelle computer_done)
2. Recuperer la reponse + screenshot_url
3. Fetcher le screenshot (GET {screenshot_url}?token=T)
4. Analyser l'image : quelles fenetres sont ouvertes ? quel etat ?
5. Adapter le plan en fonction de ce qui est DEJA visible a l'ecran
```

**Pourquoi c'est critique** : sans ca, l'orchestrateur planifie a l'aveugle et fait des
actions inutiles (ouvrir une app deja ouverte, naviguer vers une page deja affichee).
L'ecran a pu changer entre deux conversations — ne jamais supposer, toujours verifier.

#### Phase 2 — PLANIFIER la sequence complete

A partir du screenshot initial, l'orchestrateur visualise la scene complete :
- Quel est l'etat actuel du bureau/app ?
- Quelles etapes sont necessaires pour atteindre l'objectif ?
- Dans quel ordre ? Quels sont les points de verification ?

L'orchestrateur dresse la **liste complete des messages** qu'il va envoyer,
du premier clic jusqu'a la fin. C'est la "recette" pour cette tache.

```
Exemple : envoyer un email Gmail
  Etat initial : bureau Windows, Chrome ouvert sur Google
  Plan :
    1. "Va sur gmail.com dans la barre d adresse"
    2. "Clique sur Nouveau message"
    3. "Dans le champ destinataire, tape {to} et appuie sur Entree"
    4. "Clique sur le champ Objet et tape: {subject}"
    5. "Clique dans le corps du mail et tape: {body}"
    6. "Clique sur le bouton Envoyer"
```

#### Phase 3 — EXECUTER pas a pas avec verification

Pour chaque etape du plan :

```
1. Envoyer le message a GACUA (POST /v1/chat/completions)
2. Attendre la reponse (texte + screenshot_url + metrics)
3. Fetcher le screenshot — OBLIGATOIRE, c'est la source de verite
4. Verifier sur le screenshot que l'action a reussi
5. Lire les metrics (temps par phase, actions effectuees)
```

**Le screenshot est la verite.** Le texte de GACUA est un complement utile mais
l'orchestrateur ne doit JAMAIS se fier uniquement au texte pour decider.

#### Phase 4 — ADAPTER en fonction des imprevus

Apres chaque verification screenshot, l'orchestrateur DOIT re-evaluer le plan :

- **Action reussie** → passer a l'etape suivante du plan
- **Action echouee** (mauvais clic, mauvais ecran) → reformuler le prompt et reessayer
- **Imprevus** (popup, CAPTCHA, erreur, fenetre inattendue) → adapter le plan :
  - Ajouter des etapes (fermer un popup, accepter un cookie)
  - Retirer des etapes (si un etat est deja atteint, skip)
  - Changer l'approche (si un chemin est bloque, trouver un autre)

```
Exemple d'adaptation :
  Plan initial : cliquer sur "Nouveau message"
  Screenshot : popup "Activer les notifications" bloque l'ecran
  Adaptation : ajouter etape "Clique sur Non merci" avant de continuer le plan
```

**La liste d'actions n'est PAS figee.** L'orchestrateur la re-evalue a chaque etape.
C'est la difference entre un script rigide et un agent intelligent.

### Recettes (prompts testes et valides)

Une recette est une sequence de prompts validee pour une tache courante.
Les recettes sont ameliorees au fil du temps grace aux metrics et aux retours.

#### Sauvegarde automatique des recettes

L'API sauvegarde automatiquement une recette a chaque completion reussie.
Les recettes **s'accumulent par session** : chaque appel API ajoute une etape,
le fichier est reecrit avec la sequence complete, et le CLAUDE.md est mis a jour.

**Emplacement** : `recipes/` a la racine du projet
**Nommage** : `recipe_{nom-de-session}_{duree}.md`

Le **nom de session** (choisi par l'orchestrateur a la creation via `POST /v1/sessions`)
sert de titre a la recette et de nom de fichier. L'orchestrateur DOIT donc choisir
un nom descriptif pour chaque session (ex: `ouvrir-calc-et-42x3`, `envoyer-email-gmail`).

Contenu d'une recette :
- Titre = nom de session
- Nom + ID de session (pour retrouver la discussion via l'API)
- Sequence de prompts (un par etape/appel API)
- Actions retournees par l'API (liste complete par etape)
- Metrics par tour (screenshot, planning, execution)
- Duree totale (somme de TOUS les echanges de la session)
- Modele utilise

**Lien recette ↔ session** : chaque recette reference le nom et l'ID de la session.
L'orchestrateur peut retrouver la session via `GET /v1/sessions` pour acceder aux
screenshots (`GET /images/{sessionId}/{fileName}?token=T`) et messages
(`GET /v1/sessions/{sessionId}/messages`). C'est le pont entre la recette (texte)
et les preuves visuelles (screenshots).

La liste ci-dessous est **mise a jour automatiquement par l'API** quand une tache reussit.

<!-- RECIPES_START -->
| Fichier | Description | Duree | Modele | Session | Date |
|---------|-------------|-------|--------|---------|------|
| `recipe_ouvrir-calc-et-42x3_3m27s.md` | ouvrir-calc-et-42x3 | 3m27s | Flash | ouvrir-calc-et-42x3 | 2026-02-08 |
<!-- RECIPES_END -->

#### Principes des recettes

- **Etre explicite** dans chaque prompt ("Clique sur le champ Objet" > "Remplis le mail")
- **Utiliser les metrics** pour comparer les variantes (temps total, nb de tours)
- **Flash gere des instructions multi-etapes** : pour des taches simples, un seul message suffit
  (ex: "Ouvre la calculatrice" → Flash fait 3 tours en 44s en autonome)
- **Decomposer les workflows longs** : pour 5+ etapes avec verification intermediaire,
  envoyer message par message et sauvegarder la sequence complete

### Gestion des sessions et experimentation

#### Cycle de vie d'une session

Chaque session = une discussion avec GACUA = un historique de messages + screenshots.
Les sessions **occupent de l'espace disque** (screenshots PNG) et **encombrent la liste**.
L'orchestrateur DOIT gerer activement leur cycle de vie.

```
Session creee → Etapes executees → Recette sauvegardee → Session evaluee
                                                              ↓
                                        ┌─────────────┬──────┴──────┐
                                        ↓             ↓             ↓
                                    GARDER        SUPPRIMER     EXPERIMENTER
                                  (meilleure)    (doublon ou     (variante
                                                  echec)        a comparer)
```

#### Quand SUPPRIMER une session

Apres chaque tache, se demander : **"Cette session a-t-elle encore de la valeur ?"**

Supprimer (`DELETE /v1/sessions/:id`) quand :
- **Echec** : la tache n'a pas abouti (erreurs, mauvais clics, timeout)
- **Doublon inferieur** : une meilleure recette existe pour la meme tache
  (moins de tours, duree plus courte, moins d'actions inutiles)
- **Test jetable** : session de debug/experimentation dont la recette capture deja l'essentiel
- **Session sans recette** : observation pure (message neutre) sans action utile

Garder quand :
- **Meilleure de sa categorie** : meilleurs metrics pour cette tache
- **Screenshots utiles** : preuves visuelles encore necessaires
- **Session active** : workflow en cours, pas encore termine

#### Workflow d'experimentation (A/B testing)

Pour optimiser une recette, l'orchestrateur PEUT tester plusieurs approches :

```
1. NOMMER les sessions avec un suffixe de variante :
   - "ouvrir-calc-v1-menu-demarrer"
   - "ouvrir-calc-v2-raccourci-clavier"
   - "ouvrir-calc-v3-barre-recherche"

2. EXECUTER chaque variante → recette sauvegardee automatiquement

3. COMPARER les metrics :
   | Variante | Turns | Duree | Actions inutiles |
   |----------|-------|-------|------------------|
   | v1 menu  | 3     | 44s   | 0                |
   | v2 raccourci | 2 | 25s   | 0                |
   | v3 barre | 4     | 55s   | 1 (clic rate)    |

4. GARDER la meilleure recette, SUPPRIMER les sessions perdantes
   → DELETE sessions v1 et v3
   → Garder v2 comme reference

5. RENOMMER si besoin la recette gagnante (manuellement dans recipes/)
```

#### Limite de sessions et menage regulier

**Regle** : ne pas depasser ~100 sessions. Au-dela, faire le menage :

```
1. Lister : GET /v1/sessions
2. Identifier les categories (par prefixe de nom)
3. Pour chaque categorie : garder la meilleure, supprimer le reste
4. Supprimer les sessions de plus de 7 jours sans recette associee
5. Supprimer les sessions "api-{timestamp}" auto-creees (tests sans nom)
```

Le menage est un **reflexe**, pas une corvee. Apres chaque experimentation,
supprimer les sessions inutiles fait partie du workflow.

### Exemple reel — Ouvrir la calculatrice (avec metrics)

```bash
curl -s -X POST "$URL/v1/chat/completions" -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gacua-gemini-3-flash","session_id":"'$SESSION'",
       "messages":[{"role":"user","content":"Ouvre le menu Demarrer, tape calculatrice et lance l app"}]}'

# Reponse (~44s, 3 tours) :
{
  "choices": [{
    "message": {
      "content": "Actions performed:\n1. click on \"Windows Start button\"\n2. type \"calculatrice\"\n3. computer_done({\"summary\":\"Calculatrice ouverte\"})"
    }
  }],
  "screenshot_url": "/images/.../...screenshot.png",
  "metrics": {
    "turns": [
      {"turn":1, "screenshotMs":693, "planningMs":6732,  "executionMs":3620, "totalMs":11045,
       "actions":["computer_click(...)"]},
      {"turn":2, "screenshotMs":588, "planningMs":13474, "executionMs":5392, "totalMs":19454,
       "actions":["computer_type(...)"]},
      {"turn":3, "screenshotMs":508, "planningMs":12732, "executionMs":0,    "totalMs":13240,
       "actions":["computer_done"]}
    ],
    "totalMs": 43739
  }
}
```

Lecture des metrics : le bottleneck est `planningMs` (6-13s = temps de reflexion Gemini).
`screenshotMs` (500-700ms) et `executionMs` (3-5s) sont rapides.

### Screenshots — Stockage et acces

```
.gemini/gacua_sessions/{sessionId}/images/
  {timestamp}_screenshot.png           # Screenshot complet (3072x1728)
  {timestamp}_screenshot_vc0.png       # Crop 768x768 (haut-gauche)
  {timestamp}_screenshot_vc1.png       # Crop 768x768 (milieu)
  {timestamp}_screenshot_vc2.png       # Crop 768x768 (droite)
  {timestamp}_screenshot_annotated.png # Screenshot avec bounding box dessine
```

**Acces HTTP** : `GET /images/{sessionId}/{fileName}?token=T`

## Pieges connus

- **Config caching INTERDIT** : chaque appel DOIT creer un nouveau `Config`. Le cache casse
  les outils MCP. Fermer apres (`closeAllMcpClients()`), pas reutiliser.
- **Flash : texte parasite** : Flash emet parfois des chiffres parasites ("0", "2") comme text
  parts a cote de ses function calls. Comportement du modele, pas un bug du code. Pro ne le fait pas.
- **systemInstruction incompatible avec Flash** : ajouter un `systemInstruction` a l'appel planning
  (avec thinking + function calling) fait hang la requete indefiniment. Les tool descriptions suffisent.

## Notes

- Le selecteur de modele est **par session** : changer de modele necessite une nouvelle session
- Si erreur "EADDRINUSE" : `netstat -ano | findstr :10001` puis `taskkill /PID <pid> /F` (dans cmd.exe)
- Les screenshots sont croppes en carres 768x768 avec 50% de chevauchement
- Resolution ecran : 3072x1728
- **~10-20s par tour** : screenshot (~0.5s) + planning (~7-13s) + execution (~3-5s)
