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

## API externe (objectif Teleadmin)

### Besoin :
Exposer une **API compatible OpenAI** pour permettre a un agent LLM externe de
piloter GACUA par messages texte. L'agent externe n'a pas besoin de voir les
screenshots — il envoie des ordres en langage naturel et recoit du feedback texte.

### Concept :
```
Agent LLM externe (Claude, GPT, etc.)
    │
    │  POST /v1/chat/completions  (API OpenAI-compatible)
    │  { messages: [{ role: "user", content: "Ouvre Firefox et va sur google.com" }] }
    │
    ▼
GACUA API Layer (a creer)
    │
    │  1. Recoit le message texte
    │  2. Cree/reprend une session GACUA
    │  3. Envoie au WebSocket interne
    │  4. GACUA fait screenshot → planning → grounding → execution
    │  5. Retourne le feedback texte (ce que GACUA a fait/vu)
    │
    ▼
GACUA Agent (Gemini)
    │
    ▼
MCP Computer Server → Souris/Clavier/Ecran
```

### Endpoints a creer :
- `POST /v1/chat/completions` — Envoyer un ordre, recevoir le feedback
- `GET /v1/models` — Lister les modeles disponibles
- Support streaming (SSE) pour le feedback en temps reel

### Fichiers a modifier :
- `packages/gacua/backend/src/server.ts` — Ajouter les routes /v1/*
- Creer `packages/gacua/backend/src/api/openai-compat.ts` — Adapter

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

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | /api/health?token=T | Health check |
| GET | /api/sessions?token=T | Lister les sessions |
| POST | /api/sessions?token=T | Creer une session |
| GET | /api/sessions/:id?token=T | Details session |
| GET | /api/sessions/:id/messages?token=T | Messages d'une session |
| GET | /images/:sessionId/:fileName?token=T | Image screenshot |
| WS | ws://localhost:3000 | WebSocket (streaming commandes/reponses) |

## Notes

- Le selecteur de modele est **par session** : changer de modele necessite une nouvelle session
- Flash est plus rapide mais moins precis pour le grounding
- Si erreur "EADDRINUSE" : `netstat -ano | findstr :10001` puis `taskkill /PID <pid> /F` (dans cmd.exe)
- Les screenshots sont croppes en carres avec 50% de chevauchement pour couvrir tout l'ecran
- GPU local possible pour le grounding (modele vision leger type Qwen-VL) pour reduire la latence
