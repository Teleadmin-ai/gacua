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

| Lieu | Ligne | Type | Input | Output |
|------|-------|------|-------|--------|
| `agent.ts` | 485 | Planning | Screenshots + historique | Texte + function calls |
| `agent.ts` | 90 | Grounding | 1 crop + description | JSON bounding box |

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
  "session_id": "2025-02-08T...",   // optionnel, auto-cree si absent
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
  "session_id": "2025-02-08T..."
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

## API REST existante (avec token)

### API interne (/api/*)

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | /api/health?token=T | Health check |
| GET | /api/sessions?token=T | Lister les sessions |
| POST | /api/sessions?token=T | Creer une session |
| GET | /api/sessions/:id?token=T | Details session |
| DELETE | /api/sessions/:id?token=T | Supprimer une session |
| GET | /api/sessions/:id/messages?token=T | Messages d'une session |
| GET | /images/:sessionId/:fileName?token=T | Image screenshot |
| WS | ws://localhost:3000 | WebSocket (streaming commandes/reponses) |

### API OpenAI-compatible (/v1/*) — Bearer ou ?token=

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | /v1/models | Modeles disponibles |
| GET | /v1/sessions | Sessions existantes |
| POST | /v1/sessions | Creer une session |
| DELETE | /v1/sessions/:id | Supprimer une session |
| GET | /v1/sessions/:id/messages | Historique texte |
| POST | /v1/chat/completions | Envoyer un ordre, recevoir le feedback |

## Orchestration par API — Pattern Step-by-Step

### Principe fondamental

L'agent GACUA a une boucle `while(true)` : apres chaque action, il reprend un screenshot,
le renvoie a Gemini, et Gemini decide s'il veut agir encore ou s'arreter (0 function calls → stop).

**Flash peut enchainer plusieurs actions de facon autonome** pour une instruction complete.
Par exemple "Ouvre Notepad, tape du texte, et sauvegarde" → Flash fait 4+ tours tout seul.
Mais pour des workflows complexes (ex: envoyer un email Gmail), il est plus fiable de
**decomposer en etapes atomiques** envoyees sequentiellement via l'API.

### Exemple : envoyer un email Gmail

```bash
TOKEN="Bearer xxx"
URL="http://192.168.11.13:3000"

# 1. Creer une session
SESSION=$(curl -s -X POST "$URL/v1/sessions" -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"gmail"}' | jq -r '.id')

# 2. Etape par etape (attendre chaque reponse avant la suivante)
curl -s -X POST "$URL/v1/chat/completions" -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"gacua-gemini-3-flash\",\"session_id\":\"$SESSION\",
       \"messages\":[{\"role\":\"user\",\"content\":\"Ouvre le navigateur et va sur gmail.com\"}]}"

curl -s -X POST "$URL/v1/chat/completions" ...
  "Clique sur l icone profil en haut a droite et selectionne le compte user@example.com"

curl -s -X POST "$URL/v1/chat/completions" ...
  "Clique sur Nouveau message"

curl -s -X POST "$URL/v1/chat/completions" ...
  "Dans le champ destinataire, tape dest@example.com et appuie sur Entree"

curl -s -X POST "$URL/v1/chat/completions" ...
  "Clique sur le champ Objet et tape: mon objet"

curl -s -X POST "$URL/v1/chat/completions" ...
  "Clique dans le corps du mail et tape: mon message"

curl -s -X POST "$URL/v1/chat/completions" ...
  "Clique sur le bouton Envoyer"
```

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
│  - Peut enchainer plusieurs actions par tour          │
│  - S'arrete quand Gemini decide (0 function calls)   │
│  - Retourne : texte + screenshot_url                 │
│  - Ne memorise rien entre les sessions               │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Note** : Claude Code (moi) est l'orchestrateur principal pour le moment.
Quand Romain demande de piloter GACUA, je DOIS suivre le protocole complet :
message neutre initial, fetch systematique des screenshots, adaptation dynamique.
A terme, OpenClaw prendra ce role depuis un serveur distant.

### Recettes (prompts qui marchent)

L'orchestrateur doit maintenir une bibliotheque de **recettes** — des sequences de prompts
testes et valides pour des taches courantes. Chaque recette est amelioree au fil du temps.

Principes :
- **Etre le plus explicite possible** dans chaque prompt ("Clique sur le champ Objet" > "Remplis le mail")
- **Toujours fetcher le screenshot apres chaque action** — c'est SYSTEMATIQUE, pas optionnel.
  L'orchestrateur DOIT voir l'ecran pour verifier que l'action a reussi avant de continuer.
  Le texte de GACUA est un complement, mais la verite c'est le screenshot.
- **Adapter dynamiquement** : si l'ecran n'est pas dans l'etat attendu, ajuster le prompt suivant
- **Sauvegarder les recettes qui marchent** pour les reutiliser et les raffiner
- **Decomposer les workflows longs** : Flash gere les instructions completes, mais pour 5+ etapes, decomposer reste plus fiable

Exemple de recette "Envoyer un email Gmail" :
```
1. "Ouvre le navigateur et va sur gmail.com"
2. "Clique sur l icone profil en haut a droite et selectionne le compte {email}"
   → Si deja le bon compte : skip
3. "Clique sur Nouveau message"
4. "Dans le champ destinataire, tape {to} et appuie sur Entree"
5. "Clique sur le champ Objet et tape: {subject}"
6. "Clique dans le corps du mail et tape: {body}"
7. "Clique sur le bouton Envoyer"
```

Chaque etape retourne du texte + un screenshot. L'orchestrateur verifie que l'action a reussi
avant de passer a la suivante. Si un ecran inattendu apparait (popup, CAPTCHA, erreur),
l'orchestrateur s'adapte.

### Boucle d'execution de l'orchestrateur

**Etape 0 — Screenshot initial (AVANT toute action) :**
```
1. Envoyer : "Bonjour, je suis ton orchestrateur. Au prochain message je t enverrai tes instructions."
2. Recuperer la reponse + screenshot_url (le screenshot est pris automatiquement a chaque tour)
3. Fetcher le screenshot pour voir l'etat actuel de l'ecran
4. A partir de la, decider quelles etapes envoyer
```

Ce message ne demande RIEN a l'agent — pas de description, pas d'action. Il sert uniquement
a trigger le screenshot automatique. Evite "dis moi ce que tu vois" car l'agent perdrait du
temps a decrire l'ecran (et risquerait de cliquer quelque part). L'orchestrateur va analyser
le screenshot lui-meme juste apres.

**Etapes suivantes — Pour chaque action de la recette :**
```
1. Envoyer le prompt a GACUA (POST /v1/chat/completions)
2. Lire la reponse texte (description de ce que l'agent a fait)
3. Fetcher le screenshot (GET {screenshot_url}?token=T) — OBLIGATOIRE
4. Analyser le screenshot pour verifier que l'action a reussi
5. Si OK → passer a l'etape suivante
   Si KO → adapter le prompt et reessayer, ou signaler l'echec
```

Le screenshot est la **source de verite**. Le texte de GACUA est un complement utile
mais l'orchestrateur ne doit jamais se fier uniquement au texte pour decider.

### Conseils techniques

- **Instructions completes** : Flash peut gerer des instructions multi-etapes ("ouvre Notepad, tape du texte, sauvegarde")
  mais pour des workflows longs, decomposer reste plus fiable
- **Toujours verifier le screenshot** : apres CHAQUE message envoye, sans exception
- **Attendre la reponse** : ne jamais envoyer le message suivant avant d'avoir la reponse
- **Flash suffit** : pour la plupart des taches, Flash est fiable depuis les fixes des tool descriptions
- **~30-60s par message** : Flash enchaine potentiellement plusieurs tours (2 appels API par tour)
- **Timeout MCP 30s** : si la connexion SSE tombe, le run echoue en 30s max (pas 10 min)

### Screenshots — Stockage et acces

Les screenshots sont stockes dans le dossier de session :
```
.gemini/gacua_sessions/{sessionId}/images/
  {timestamp}_screenshot.png           # Screenshot complet (3072x1728)
  {timestamp}_screenshot_vc0.png       # Crop 768x768 (haut-gauche)
  {timestamp}_screenshot_vc1.png       # Crop 768x768 (milieu)
  {timestamp}_screenshot_vc2.png       # Crop 768x768 (droite)
  {timestamp}_screenshot_annotated.png # Screenshot avec bounding box dessine
```

**Acces HTTP** : `GET /images/{sessionId}/{fileName}?token=T`

Les messages persistants referent aux images via `internal://{sessionId}/{fileName}`.
Le frontend web affiche les screenshots dans la conversation.

### Screenshot dans la reponse API (IMPLEMENTE)

La reponse de `/v1/chat/completions` inclut un champ `screenshot_url` pointant vers
le dernier screenshot complet pris par l'agent apres execution de l'action.

```json
{
  "choices": [{ "message": { "content": "..." } }],
  "session_id": "2026-02-08T...",
  "screenshot_url": "/images/2026-02-08T.../2026-02-08T..._screenshot.png"
}
```

L'orchestrateur LLM peut alors :
1. Recuperer l'image via `GET {screenshot_url}?token=T`
2. L'analyser avec son propre modele vision (Claude, GPT, etc.)
3. Decider de la prochaine etape en connaissance de cause

**Fichier** : `packages/gacua/backend/src/api/openai-compat.ts`
- `collectAgentResponse()` track le dernier screenshot depuis les `persistent_message` events
- Filtre : seuls les screenshots complets (`_screenshot.png`), pas les crops (`_vc0`, `_vc1`, etc.)
- Disponible en mode non-streaming et streaming (dans le dernier chunk `finish_reason: 'stop'`)

## Bugs connus / TODO

### Leak de connexions MCP (CORRIGE)
Chaque appel a `runComputerUseAgent()` cree un nouveau `Config` → `config.initialize()` →
ouvre une nouvelle connexion SSE au serveur MCP (port 10001).

**Fix** : `closeAllMcpClients()` dans `packages/core/src/tools/mcp-client.ts` :
- Map `activeMcpClients` track les connexions MCP ouvertes
- `closeAllMcpClients()` ferme toutes les connexions et clear la map
- Appele dans le `finally` block de `runComputerUseAgent()` (interface.ts)
- Verifie : 0 connexions apres chaque appel, pas de regression sur appels sequentiels

**ATTENTION — Config caching INTERDIT** : une tentative de cacher le Config au niveau module
pour reutiliser la connexion MCP a completement casse le controle du PC.
Chaque appel DOIT creer un nouveau Config. La solution est de fermer apres, pas de reutiliser.

### Flash 3 : grounding error image_id/element_description (CORRIGE)
Flash envoyait `image_id` sans `element_description`, causant l'erreur de validation.
Ce n'etait PAS un bug du code mais un comportement du modele.
**Fix** : descriptions renforcees dans les tool declarations (type.ts, scroll.ts) — voir modif 10.
**Consequence** : avant le fix, Flash semblait ne faire qu'une action (echouait a la 2eme).
Apres le fix, Flash enchaine les actions de facon autonome.

### Flash 3 : image_id hors limites (CORRIGE)
Flash demandait `image_id: 3` alors que les indices valides sont 0-2.
**Fix** : le nombre de crops et la plage d'indices est communique dans la description du screenshot — voir modif 12.

### MCP timeout de 10 minutes (CORRIGE)
Le timeout par defaut du MCP client etait 10 min. Quand la connexion SSE tombait,
le run attendait 10 min pour rien avant de fail.
**Fix** : timeout de 30s pour le serveur MCP `.computer` — voir modif 11.

### Flash 3 : texte parasite dans les reponses
Gemini 3 Flash emet parfois des chiffres parasites ("0", "2") comme text parts a cote de ses
function calls et thoughts. Ces chiffres apparaissent dans l'interface web. C'est un comportement
du modele Flash, pas un bug du code. Pro ne le fait pas.

## Notes

- Le selecteur de modele est **par session** : changer de modele necessite une nouvelle session
- Flash est plus rapide et fiable pour le grounding depuis les fixes des tool descriptions (modif 10, 12)
- Si erreur "EADDRINUSE" : `netstat -ano | findstr :10001` puis `taskkill /PID <pid> /F` (dans cmd.exe)
- Les screenshots sont croppes en carres avec 50% de chevauchement pour couvrir tout l'ecran
- GPU local possible pour le grounding (modele vision leger type Qwen-VL) pour reduire la latence
- Resolution ecran actuelle : 3072x1728 (screenshots MCP captures a cette resolution)
- **systemInstruction incompatible avec Flash** : ajouter un `systemInstruction` a l'appel planning
  (avec thinking + function calling) fait hang la requete indefiniment. Les tool descriptions suffisent.
