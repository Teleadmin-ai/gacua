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

## Bugs connus / TODO

### Leak de connexions MCP (TODO)
Chaque appel a `runComputerUseAgent()` cree un nouveau `Config` → `config.initialize()` →
`createToolRegistry()` → `discoverAllTools()` → ouvre une **nouvelle connexion SSE** au serveur MCP
(port 10001) qui n'est **jamais fermee**. La classe `Config` n'a pas de methode `cleanup()`/`close()`.

**Consequence** : les connexions s'accumulent (visible avec `netstat -ano | findstr :10001`).
Sur des sessions longues, ca peut causer des erreurs `SSE stream disconnected: TypeError: terminated`.

**Solution tentee et revertee** : cacher le Config au niveau module pour reutiliser la connexion MCP.
**Resultat** : casse completement le controle du PC — les outils MCP deviennent inutilisables apres
le 1er appel. Le cache Config est INTERDIT — chaque appel DOIT creer un nouveau Config.

**Solution correcte (a implementer)** : ajouter une methode `cleanup()` dans `ToolRegistry`
(`packages/core/src/tools/tool-registry.ts`) qui ferme les clients MCP, puis l'appeler dans
`interface.ts` apres `runAgent()` (dans un `finally` block). Necessite aussi d'exposer
`config.getToolRegistry()` pour y acceder et d'ajouter `cleanup()` dans `Config`.

### Flash 3 : texte parasite dans les reponses
Gemini 3 Flash emet parfois des chiffres parasites ("0", "2") comme text parts a cote de ses
function calls et thoughts. Ces chiffres apparaissent dans l'interface web. C'est un comportement
du modele Flash, pas un bug du code. Pro ne le fait pas.

## Notes

- Le selecteur de modele est **par session** : changer de modele necessite une nouvelle session
- Flash est plus rapide mais moins precis pour le grounding (oublie parfois `element_description`)
- Si erreur "EADDRINUSE" : `netstat -ano | findstr :10001` puis `taskkill /PID <pid> /F` (dans cmd.exe)
- Les screenshots sont croppes en carres avec 50% de chevauchement pour couvrir tout l'ecran
- GPU local possible pour le grounding (modele vision leger type Qwen-VL) pour reduire la latence
- Resolution ecran actuelle : 3072x1728 (screenshots MCP captures a cette resolution)
