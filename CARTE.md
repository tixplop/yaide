# Carte du code

Une ligne par fichier ou dossier : chemin — rôle — points d'entrée (3 au plus). Les `*.test.js` sont à côté de leur module.

## Serveur (Rust, `src/`)
- src/main.rs — point d'entrée : lit la ligne de commande, lance le serveur ou une sous-commande — main
- src/cli.rs — analyse des arguments, aide, saisie du mot de passe — analyser, valider_saisies
- src/config.rs — dossier de configuration, mot de passe haché (argon2) — dossier_config, definir_mot_de_passe, verifier_mot_de_passe
- src/tls.rs — certificat auto-signé (rcgen) — assurer_certificat
- src/auth.rs — sessions, blocage après échecs — creer_session, session_valide, bloque
- src/serveur.rs — routeur axum : toutes les routes `/api/*`, WebSocket, fichiers statiques embarqués — ecouter, servir
- src/fichiers.rs — arborescence et opérations sur les fichiers du projet — lister, lire, ecrire
- src/depot.rs — dépôt git, `.gitignore`, worktrees — est_un_depot, worktrees
- src/git.rs — état, diff, index, commit, branches, pull/push — etat, commit, synchroniser
- src/recherche.rs — recherche dans les fichiers et ouverture rapide — chercher, lister
- src/shells.rs — shells et sessions Claude en pseudo-terminal, survie aux coupures — abonner, ecrire, trouver_claude
- src/opencode.rs — processus `opencode serve` du projet — assurer, arreter, disponible
- src/apercu.rs — jetons et service de l'aperçu HTML — nouveau_jeton, jeton_ok, charger
- src/version.rs — version, nouvelle version, `yaide update` — etat_maj, demarrer_maj, derniere
- src/connaissance.rs — base de connaissance vectorielle (collections, pointeurs, mise à jour) — valider, lire_config, ecrire_config
- src/decoupage.rs — découpage des fichiers en passages — decouper, valider
- src/agent/mod.rs — déclare les modules de l'agent
- src/agent/provider.rs — providers LLM (formats OpenAI et Anthropic, requêtes en `stream`), embeddings — client, envoyer, embeddings
- src/agent/provider_flux.rs — lecture des réponses en flux Server-Sent Events (REQ-085), suivi `Progres` — lire
- src/agent/secrets.rs — clés d'API chiffrées (AES-256-GCM) — lire, ecrire
- src/agent/reglages.rs — providers, profils, réglages du projet et communs — provider, vue, reprendre_du_projet
- src/agent/agents.rs — agents personnalisés (AGENTS.md, PERSONA.md) — lister, lire, enregistrer
- src/agent/conversation.rs — boucle de l'agent, conversations, sous-agents, étape de requête en cours en mémoire (REQ-085) — envoyer, envoyer_avec, arreter
- src/agent/outils.rs — outils de l'agent (fichiers, shell, connaissance, agents) — definitions, executer
- src/agent/outils_config.rs — outils de l'agent qui modifient la configuration de Yaide — definitions, lancer, lire_interface
- src/agent/mcp.rs — serveurs MCP (rmcp, stdio), `mcp.json` — preparer, appeler, lister_serveurs
- src/agent/web.rs — recherche web (DuckDuckGo) et récupération de pages — chercher, recuperer, html_en_texte
- src/agent/jdiag.rs — lecture et écriture des whiteboards par l'agent — relire, en_texte
- src/agent/jdiag_controle.rs — avertissements de mise en page de `whiteboard_write` (boîtes, liens, textes, zone de texte des symboles ; REQ-148, REQ-149) — avertissements, bloc
- src/agent/jdiag_trace.rs — tracé à 100 % d'un lien de whiteboard (même calcul que `geometrieLien`), cas communs dans `jdiag_traces.json` — trace, milieu

## Interface (JavaScript, `web/src/`)
- web/index.html — page unique ; web/dist/ est produit par esbuild
- web/src/main.js — démarrage : thème, connexion, vue principale — titre
- web/src/theme-initial.js — thème appliqué avant le premier affichage
- web/src/api.js — appels HTTP et WebSocket vers le serveur — info, sessionValide, connexion
- web/src/connexion.js — surveille la connexion au serveur — surveiller
- web/src/stockage.js, brouillons.js, disque.js — IndexedDB, modifications gardées, décision face au disque — lire/ecrire, decider, decisionDisque
- web/src/disposition.js — arbre des groupes de l'éditeur (diviser, tailles) — couper, retirerGroupe, valider
- web/src/onglets-fichiers.js — types et libellés des onglets de fichiers — nomDe, estImage, estWhiteboard
- web/src/references.js — liens de documents, fichiers cités, titres — lienDeDocument, depuisProjet, estMac
- web/src/statuts.js — mots du statut git — statutsDe
- web/src/worktree.js — worktree choisi, partagé entre vues — choisir, abonner
- web/src/version.js — version et mise à jour dans l'interface — suivreVersion
- web/src/opencode.js — état des sessions opencode (modèle, attentes, contexte) — abonner, modeleSession
- web/src/opencode-captures/ — captures JSON d'opencode pour les tests
- web/src/reglages-interface.js — `.yaide/interface.json` — analyser, charger, serialiser
- web/src/couleurs-markdown.js — couleurs réglables du rendu markdown — analyser, appliquer, charger
- web/src/formatage.js — formatage du document ouvert — formatable, formater
- web/src/jdiag.js — lecture et écriture du format `.jdiag` — lireJdiag, ecrireJdiag, SYMBOLES (les vingt symboles, REQ-149)
- web/src/mermaid.js — bibliothèque mermaid, bundle à part chargé au premier diagramme
- web/src/ui/ — design system : composants (`bouton`, `champ`, `menu`, `dialogue`, `onglets`, `liste`, `message`, `cadre`, `poignee`, `info-bulle`, `indication`, `compteur`, `avatar`, `image`) ; `icones.js` ; `tokens.css`, `composants.css`, `theme.js`, `polices/`
- web/src/ui/apercu.js, apercu-html.js, hybride.js, diagramme.js — rendu markdown, aperçu HTML, mode hybride, mermaid — rendreMarkdown, apercuHtml, decorationsHybride
- web/src/ui/zone-code.js, langages.js, couleurs-code.js — éditeur CodeMirror et coloration — zoneCode, langagePourFichier
- web/src/ui/conversation.js, completion.js, attentes.js, copie.js — conversation, complétion `/ @ $ #`, attentes d'autorisation, copie en texte simple — conversation, completion, copierEnTexteSimple
- web/src/ui/terminal.js — terminal xterm.js — terminal
- web/src/ui/palettes.js — palettes de couleurs markdown suggérées — PALETTES
- web/src/ui/tableau.js — composant whiteboard : surface, gestes, clavier, historique Ctrl+Z/Ctrl+Y — tableau
- web/src/ui/tableau-texte.js — texte d'une boîte ou d'un lien et styles d'une partie du texte : rendu, lecture du DOM de la saisie, bascule, couleur, insertion (REQ-146) — rendreTexte, lireTexte, basculer
- web/src/ui/tableau-calculs.js, tableau-dessin.js, tableau-edition.js, tableau-outils.js — géométrie, rendu SVG, copier/coller/plan/rattachement, boîte à outils — extremitesFleche, milieuTrace, dessinBoite, coller, boiteOutils
- web/src/vues/principale.js — fenêtre : rails, panneaux, zones, Ctrl+P — vuePrincipale
- web/src/vues/principale.aides.js — aides des tests de la vue principale
- web/src/vues/editeur.js — groupes d'onglets : fichiers, images, whiteboards (zoneWhiteboard), sessions — vueEditeur
- web/src/vues/depot-onglets.js — dépôt et persistance des onglets de l'éditeur — depotOnglets
- web/src/vues/fichiers.js, git.js, recherche.js, ouverture.js — vues Fichiers, Git, Recherche, ouverture rapide — vueFichiers, vueGit, vueOuverture
- web/src/vues/shells.js — zone des shells — vueShells
- web/src/vues/agent.js, agents.js, soumission-agent.js — conversation de l'agent, panneau Agents, soumission de fichiers — vueAgent, vueAgents, ouvrirSoumissionAgent
- web/src/vues/claude.js, opencode.js, sessions-opencode.js — sessions Claude et opencode — vueClaude, vueOpencode
- web/src/vues/connaissance.js, ajout-connaissance.js — base de connaissance — vueConnaissance, ouvrirAjoutConnaissance
- web/src/vues/configuration.js, configuration-couleurs.js, providers.js, profils.js, serveurs-mcp.js — dialogue Configuration et panneaux de réglage — ouvrirConfiguration, ouvrirProviders, vueServeursMcp
- web/src/vues/connexion.js — écran de connexion — vueConnexion

## Tests
- tests/*.rs — intégration Rust, un fichier par domaine (socle, auth, fichiers, git, shells, agent, connaissance, opencode, mise_a_jour…)
- tests/faux-mcp.mjs, faux-opencode.mjs — faux serveurs MCP et opencode
- web/src/**/*.test.js — Vitest, composants et vues
- e2e/*.spec.js — Playwright, un fichier par parcours ; e2e/aides.js, faux-provider.js, relais.js, capturer-opencode.js — aides communes

## Construction
- build.rs — vérifie que `web/dist/` existe avant la compilation Rust
- esbuild.mjs — empaquette `main.js` et `mermaid.js`, copie index, CSS, polices vers `web/dist/`
- Cargo.toml, package.json, playwright.config.js, vitest.config.js, eslint.config.js — configuration des outils ; install.sh — installation

## Fonctionnalités
- REQ-001 à REQ-006 mot de passe, lancement, HTTPS, session → src/cli.rs, config.rs, tls.rs, auth.rs, serveur.rs, web/src/vues/connexion.js
- REQ-007 à REQ-010, REQ-034, REQ-049, REQ-050, REQ-125 arborescence → src/fichiers.rs, web/src/vues/fichiers.js
- REQ-008, REQ-011 à REQ-014, REQ-061, REQ-083 onglets, sauvegarde, menu → web/src/vues/editeur.js, onglets-fichiers.js, ui/onglets.js, ui/zone-code.js
- REQ-120, REQ-121 images et SVG → web/src/ui/image.js, vues/editeur.js
- REQ-012, REQ-042 à REQ-044, REQ-058, REQ-062, REQ-063, REQ-115, REQ-117 rendu markdown, aperçu HTML, hybride, couleurs → ui/apercu.js, apercu-html.js, hybride.js, couleurs-markdown.js, ui/palettes.js, src/apercu.rs
- REQ-015 à REQ-018, REQ-094 coupure, brouillons, disque → web/src/connexion.js, brouillons.js, disque.js, stockage.js
- REQ-019 à REQ-021, REQ-035, REQ-040, REQ-041, REQ-047 shells → src/shells.rs, web/src/vues/shells.js, ui/terminal.js
- REQ-022 à REQ-025, REQ-039, REQ-045, REQ-086, REQ-099 git et worktrees → src/git.rs, depot.rs, web/src/vues/git.js, worktree.js, statuts.js
- REQ-026, REQ-027 recherche et ouverture rapide → src/recherche.rs, web/src/vues/recherche.js, ouverture.js
- REQ-028 à REQ-033, REQ-036 à REQ-038, REQ-046, REQ-048, REQ-059 disposition, design system, thèmes → web/src/ui/, vues/principale.js
- REQ-079, REQ-080 groupes de l'éditeur → web/src/disposition.js, vues/depot-onglets.js, vues/editeur.js
- REQ-029, REQ-030, REQ-060, REQ-082, REQ-092, REQ-093 binaire, aide, mise à jour → build.rs, esbuild.mjs, src/cli.rs, version.rs, web/src/version.js
- REQ-051, REQ-069 à REQ-071, REQ-116 `.yaide/`, interface, Configuration → web/src/reglages-interface.js, vues/configuration.js, src/agent/outils_config.rs
- REQ-085 état de la requête et raisonnement replié, dépliable pendant l'arrivée → src/agent/provider.rs, conversation.rs, web/src/ui/conversation.js, vues/agent.js
- REQ-052 à REQ-057, REQ-067, REQ-078 providers, profils, agent, outils → src/agent/provider.rs, reglages.rs, conversation.rs, outils.rs, web/src/vues/providers.js, profils.js, agent.js
- REQ-064 à REQ-066, REQ-097 à REQ-100, REQ-119 agents et sous-agents → src/agent/agents.rs, conversation.rs, outils.rs, web/src/vues/agents.js
- REQ-081 réglages communs à tous les projets → src/agent/reglages.rs
- REQ-095, REQ-096 serveurs MCP → src/agent/mcp.rs, web/src/vues/serveurs-mcp.js
- REQ-068, REQ-073 session Claude → src/shells.rs, web/src/vues/claude.js
- REQ-072, REQ-074 à REQ-077, REQ-084, REQ-088 à REQ-091 session opencode → src/opencode.rs, web/src/opencode.js, vues/opencode.js, vues/sessions-opencode.js, ui/completion.js
- REQ-087, REQ-101 liens de fichiers et de documents → web/src/references.js, ui/apercu.js
- REQ-102 copier-coller en texte simple → web/src/ui/copie.js
- REQ-103 à REQ-114, REQ-124 base de connaissance → src/connaissance.rs, decoupage.rs, web/src/vues/connaissance.js, ajout-connaissance.js
- REQ-126 soumettre des fichiers à un agent → web/src/vues/soumission-agent.js
- REQ-118 formater le document → web/src/formatage.js, vues/principale.js
- REQ-122, REQ-123 mermaid → web/src/mermaid.js, ui/diagramme.js, ui/apercu.js
- REQ-127 à REQ-149 whiteboards → web/src/jdiag.js, ui/tableau*.js, vues/editeur.js (zoneWhiteboard), vues/fichiers.js, src/agent/jdiag.rs, jdiag_trace.rs, jdiag_controle.rs, outils.rs
