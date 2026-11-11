# Yaide

Un éditeur de code, un shell et un suivi Git dans le navigateur, servis par un seul binaire. Rien n'est envoyé vers l'extérieur.

## Installer ou mettre à jour

Sous Linux x86_64, WSL2 compris, sans sudo :

```
curl -fsSL https://raw.githubusercontent.com/tixplop/yaide/master/install.sh | sh
```

La même commande installe la dernière release, ou met à jour une installation existante ; elle ne fait rien si la version est déjà la bonne. Le binaire est placé dans `~/.local/bin/yaide`, après vérification de son empreinte SHA-256. Pour une version précise, ajoutez-la : `… | sh -s -- v0.3.0`. Pour un autre dossier, définissez `YAIDE_BIN_DIR`. Une instance déjà lancée garde l'ancienne version jusqu'à son redémarrage.

Pour une installation existante, `yaide update` fait la même chose : il installe la dernière release et remplace le binaire lancé, dans son propre dossier. Il faut `curl` ou `wget`, `tar` et `sha256sum`. Il ne prend aucun argument.

La barre d'état affiche, tout à droite, la version lancée (« v0.9.1 »). Le serveur cherche la dernière release de Yaide au lancement, puis toutes les 10 minutes ; c'est la seule demande que Yaide fait à GitHub, et elle part du serveur, jamais du navigateur. Si une version plus récente existe, la barre d'état l'annonce, avec un bouton « Mettre à jour » : il fait ce que fait `yaide update`, sans redémarrer Yaide, donc sans couper les shells ni les sessions en cours. Relancez Yaide ensuite pour utiliser la nouvelle version.

À gauche de la version, la barre d'état dit « Connecté » ou « Déconnecté » selon que le serveur répond : elle suit la même détection que le bandeau « Connexion perdue », sans requête de plus.

## Compiler

Il faut Rust, Node.js, npm et gcc.

```
rustup target add x86_64-unknown-linux-musl
npm install
npm run build
cargo build --release --target x86_64-unknown-linux-musl
```

`npm run build` produit l'interface dans `web/dist/` ; le binaire l'embarque. Le binaire obtenu, `target/x86_64-unknown-linux-musl/release/yaide`, est statique et se suffit à lui-même : aucun fichier à côté.

## Installer un binaire compilé

Copiez le binaire dans un dossier de votre `PATH` :

```
install -m 755 target/x86_64-unknown-linux-musl/release/yaide ~/.local/bin/yaide
```

## Définir le mot de passe

```
yaide passwd
```

Le mot de passe est demandé deux fois, sans s'afficher. Un mot de passe vide, ou deux saisies différentes, sont refusés et l'ancien mot de passe reste en place. Sans terminal, il est lu une fois sur l'entrée standard :

```
printf '%s\n' "mon mot de passe" | yaide passwd
```

Seul un haché est écrit, dans `$XDG_CONFIG_HOME/yaide/` (sinon `~/.config/yaide/`), lisible par vous seul. Un nouveau `yaide passwd` s'applique tout de suite aux instances déjà lancées.

## Lancer

```
yaide <dossier> [--port <n>]
```

Le dossier est obligatoire. Le port par défaut est 8443. Ouvrez ensuite `https://localhost:8443` sur cette machine, ou `https://<adresse de la machine>:8443` depuis une autre. N'ouvrez pas `https://0.0.0.0:8443` : les navigateurs peuvent refuser cette adresse. Pour servir un dossier nommé `update`, écrivez `yaide ./update`. Plusieurs instances peuvent tourner en même temps, chacune sur son port et son dossier.

`yaide --help` affiche l'aide, `yaide <action> --help` celle de `passwd` ou `update` ; `yaide ./--help` pour servir un dossier de ce nom.

Aucun shell n'est lancé au démarrage : « Nouveau shell » en ouvre un, et porte le nombre de shells ouverts.

Pour diviser l'éditeur, glissez un onglet sur le côté d'un groupe (gauche, droite, haut ou bas) : il s'ouvre dans un nouveau groupe. Déposé au centre ou sur la barre d'onglets d'un autre groupe, il s'y ajoute. Échap annule le glissé. La poignée entre deux groupes change leur taille : glissez-la, ou utilisez les flèches une fois le focus dessus. Le partage est gardé au rechargement.

Messages d'erreur courants : sans mot de passe défini, lancez `yaide passwd` ; si le port est occupé, Yaide prend le suivant libre parmi les 10 suivants et l'affiche ; si tous le sont, choisissez-en un autre avec `--port` ; le dossier doit exister.

## Avertissement du certificat

Yaide sert en HTTPS avec un certificat auto-signé, créé au premier lancement dans le dossier de configuration (`certificat.pem` et `cle.pem`) puis réutilisé, valable 10 ans. Aucune autorité ne le garantit, donc le navigateur affiche un avertissement la première fois : choisissez de continuer vers le site (« Avancé », puis « Continuer »). Le navigateur peut le redemander si vous supprimez le certificat.

## Réseau public : risque accepté

Yaide écoute sur toutes les adresses de la machine. Le mot de passe est la seule protection, et le certificat auto-signé ne prouve pas l'identité du serveur. Quiconque atteint le port peut tenter de deviner le mot de passe, et quiconque se connecte donne accès à un shell et aux fichiers du dossier avec vos droits. Sur un réseau public, ce risque est accepté : choisissez un mot de passe long et unique, limitez l'accès avec un pare-feu ou un VPN si vous le pouvez, et ne lancez pas Yaide en administrateur.

## Agent

Chaque conversation avec l'agent s'ouvre dans un onglet de l'éditeur, à côté de vos fichiers (« Agent 1 », « Agent 2 »…). Le bouton « Agent » du rail droit (ou la touche A quand le focus est sur l'un des rails) ouvre une nouvelle conversation dans un nouvel onglet, à chaque clic. Plusieurs conversations tournent en même temps, une par onglet. Fermer un onglet n'arrête pas son tour : la conversation reste dans « Conversations », en haut de l'onglet, d'où vous pouvez la rouvrir. La colonne à droite de l'éditeur ne montre que la vue « Agents » ; « Replier l'agent », en haut de la colonne, la referme.

- **Réglages.** Ctrl+P puis `>` ouvre les commandes : « Providers LLM » (adresse et clé d'API de OpenAI, Anthropic, Google, OpenRouter, LiteLLM, Ollama) et « Profils de modèle » (provider, modèle, effort, température, sortie max., fenêtre de contexte). Une conversation utilise un profil ; le profil par défaut sert aux nouvelles conversations.
- **Dossier `.yaide/`.** Il est créé dans le projet. Il garde `conversations/` et le reste du projet. Pensez à l'ajouter à `.gitignore` si vous ne voulez pas le versionner.
- **Adresses, clés et profils.** Ils sont dans `~/.config/yaide/` (`config.json` pour les adresses et les profils, `secrets` pour les clés d'API chiffrées ; le dossier suit `XDG_CONFIG_HOME`), communs à tous les projets. Au premier lancement après la mise à jour, ceux du projet ouvert sont repris une fois. Les anciens fichiers `.yaide/config.json` et `.yaide/secrets` ne servent plus et peuvent être supprimés.
- **Clé de chiffrement.** Les clés d'API sont chiffrées (AES-256-GCM) avec la clé `~/.config/yaide/cle-secrets`, créée au premier besoin (le dossier suit `XDG_CONFIG_HOME` s'il est défini). Si vous la perdez, les clés enregistrées deviennent illisibles : saisissez-les de nouveau.
- **`AGENTS.md`.** S'il existe à la racine du projet, son contenu est ajouté aux instructions de l'agent à chaque requête.
- **Sept outils.** `read`, `write`, `edit`, `bash`, `glob` (fichiers du projet, sans ceux que git ignore), `websearch` et `webfetch` (web).
- **Aucune confirmation.** L'agent exécute ses outils sans vous demander : il écrit des fichiers et lance des commandes avec vos droits, dans le dossier du projet. Le bouton « Arrêter » interrompt le tour en cours. Ne lui confiez que des projets dont vous acceptez qu'ils soient modifiés ; un fichier qu'il écrit et que vous n'avez pas modifié se recharge dans l'éditeur.
- **Ce qui part vers l'extérieur.** Rien tant que vous n'envoyez pas de message. Ensuite : vos messages, les instructions, le contenu des fichiers lus et les sorties des commandes vont au provider du profil choisi (à l'adresse réglée dans « Providers LLM », donc sur votre machine pour Ollama) ; `websearch` interroge la page HTML de DuckDuckGo ; `webfetch` télécharge les pages que l'agent demande.
- **Agents personnalisés.** Le bouton « Agents », sous « Agent » sur le rail droit, ouvre la colonne avec la liste des agents du projet : « Nouvel agent » en crée un (nom, avatar, couleur, profil), « Modifier » règle un agent existant. Chaque agent est un dossier `.yaide/agents/<nom>/` avec trois fichiers : `agent.json` (nom, avatar, couleur, profil), `AGENTS.md` et `PERSONA.md`. Depuis la fiche d'un agent, `PERSONA.md` (son rôle) et `AGENTS.md` (ses consignes) s'ouvrent dans l'éditeur ; leur contenu est lu au premier message d'une conversation, et une modification ne change pas les conversations déjà commencées.
- **Conversation à plusieurs agents.** Cochez un ou plusieurs agents, puis « Démarrer une conversation » : à chaque message, les agents répondent chacun à son tour, dans l'ordre de la liste, chacun avec son profil et dans un groupe à sa couleur. « Arrêter » interrompt l'agent en cours, et les suivants ne répondent pas.
- **Supprimer un agent.** Supprimez son dossier `.yaide/agents/<nom>/` (depuis l'arborescence, par exemple). Un `agent.json` illisible est signalé au-dessus de la liste, sans empêcher les autres agents.
- **Raisonnement.** Quand le provider le rend, il s'affiche replié sous « Raisonnement ». Avec Anthropic, Yaide le demande sauf si le profil a une température. Claude 4.5 et les versions avant refusent ce réglage : donnez-leur une température.
- **Serveurs MCP.** Le fichier `.yaide/mcp.json` du projet déclare des serveurs MCP dont les outils s'ajoutent à ceux de l'agent. Seul le transport stdio est pris en charge : Yaide lance la commande dans le dossier du projet. Pour un serveur HTTP, passez par `npx mcp-remote <url>`. Exemple :

  ```json
  {
    "mcpServers": {
      "docs": {
        "command": "npx",
        "args": ["-y", "mon-serveur-docs"],
        "env": { "DOCS_TOKEN": "mon-jeton" }
      }
    }
  }
  ```

  Un outil s'appelle `mcp__<serveur>__<outil>` pour le modèle ; la conversation affiche « serveur › outil ». Un serveur qui ne démarre pas est signalé au début du tour, sans empêcher les autres. Les jetons de `env` sont en clair dans le fichier : ne le poussez pas s'il en contient. Claude Code et opencode gardent leur propre configuration.

## Session Claude

Si la commande `claude` (Claude Code) est dans le `PATH` du serveur au moment où vous chargez la page, un bouton « Claude » apparaît dans le rail droit, sous « Agents ».

- Chaque clic sur « Claude » ouvre une nouvelle session dans un onglet de l'éditeur (« Claude 1 », « Claude 2 »…), dans le dossier du projet.
- Yaide lance `claude` sans argument : Claude Code suit le mode de permissions de vos réglages (par exemple l'auto-mode). Une session marche aussi quand Yaide est lancé depuis Claude Code.
- La session s'arrête quand vous fermez son onglet, et toutes les sessions s'arrêtent avec Yaide, avec ce que Claude Code a lancé, y compris quand vous fermez votre terminal (SIGHUP). Un `kill -9` ne peut pas être intercepté : il n'arrête rien. Lancé avec `nohup yaide`, Yaide continue après la fermeture du terminal.
- Dans un onglet Claude, les raccourcis de Yaide (Ctrl+P, Ctrl+S) vont à Claude Code. Ctrl+Maj+F ramène le focus sur le rail.

## Session opencode

Si la commande `opencode` (version 2) est dans le `PATH` du serveur au moment où vous chargez la page, un bouton « opencode » apparaît dans le rail droit, sous « Claude ». Avec une autre version, ou sans `opencode`, le bouton n'existe pas.

- Au premier clic, Yaide lance `opencode serve` dans le dossier du projet, sur 127.0.0.1, avec un mot de passe tiré au hasard. Il l'arrête avec lui, avec ce qu'il a lancé, y compris quand vous fermez votre terminal ; pas avec `kill -9`. `nohup yaide` continue après la fermeture du terminal.
- Chaque clic ouvre une nouvelle conversation dans un onglet de l'éditeur (« opencode 1 », « opencode 2 »…) : une conversation par onglet. Les réponses s'écrivent au fil de leur arrivée.
- « Sessions opencode », sous « opencode », liste les anciennes sessions du projet, la plus récente d'abord, avec la date de leur dernière activité. Choisir une ligne la rouvre dans un onglet, avec son historique, et la suite du message continue cette session ; si elle est déjà ouverte, son onglet devient actif. Yaide lance le serveur opencode au besoin.
- Dans « Message à opencode », trois déclencheurs ouvrent une liste au-dessus du champ : `/` en tout premier caractère pour les commandes d'opencode, `@` pour joindre un fichier ou un dossier du projet, `$` pour activer un skill. Haut et Bas changent la ligne courante, Entrée ou Tab la choisissent, Échap ferme la liste. Un message qui commence par une commande choisie lance cette commande ; les fichiers et les skills choisis sont joints au message.
- Quand opencode lance un sous-agent, sa ligne apparaît dans la conversation ; « Ouvrir » affiche sa conversation dans son propre onglet.
- Les réponses s'affichent mises en forme : tableaux, citations, listes, code coloré. `> [!NOTE]` donne un encadré, `- [ ]` et `- [x]` une case en lecture seule, une adresse `http://` ou `https://` un lien. Un lien s'ouvre dans un nouvel onglet du navigateur. La vue Agent affiche ses réponses de la même façon.
- Un fichier cité dans une réponse (lien, chemin avec `/` et une extension, numéro de ligne comme `src/main.rs:42`) s'ouvre dans l'éditeur, à cette ligne, s'il est dans le projet ou dans un de ses worktrees. Sinon, un message dit pourquoi et rien ne s'ouvre.
- Les autorisations et les questions d'opencode s'affichent au-dessus du champ de saisie, et l'onglet porte la marque `!` tant qu'une demande attend. Une demande d'un sous-agent nomme le sous-agent et est visible dans son onglet et dans celui de la conversation qui l'a lancé.
- Le modèle et l'effort se choisissent dans l'onglet, avec les listes « Modèle » et « Effort » sous le champ du message. Le choix vaut pour cette session et opencode le garde : il revient après un rechargement. Une nouvelle session reprend le dernier modèle et le dernier effort choisis dans le projet, gardés dans `.yaide/opencode.json` ; sans choix, elle part du modèle par défaut d'opencode.
- Le compteur à droite des listes donne les tokens occupés par la dernière réponse du modèle, la fenêtre de contexte du modèle choisi et le pourcentage (par exemple « 15 k / 200 k · 8 % ») ; il n'existe pas quand la fenêtre du modèle est inconnue.
- opencode garde la session : fermer l'onglet ne l'arrête pas, et un tour en cours continue. `opencode -s <id>` la reprend dans le terminal.
- Après une mise à jour d'opencode, `node e2e/capturer-opencode.js` relève de nouveau le contrat de son API (dans `web/src/opencode-captures/`).
- **Raisonnement.** Quand le modèle rend son raisonnement, il s'affiche replié sous « Raisonnement » ; un clic ou Entrée le déplie.

## Worktrees

Quand le dépôt du projet a au moins deux worktrees (`git worktree list`), les vues Fichiers et Git ont une ligne « Worktree », sous leur titre. Chaque option donne le nom du dossier du worktree puis sa branche : « essai (essai) ».

- Choisir un worktree fait travailler les deux vues sur son dossier : arborescence, ouvrir, créer, renommer, supprimer, changements, diff, commit, branche, pull et push. Le choix est commun : changer l'une des listes change l'autre. La barre d'état affiche la branche du worktree choisi.
- Un fichier d'un autre worktree s'ouvre dans un onglet comme les autres ; son info-bulle donne son chemin depuis le projet, par exemple `../essai/src/main.rs`. Les onglets restent ouverts quand le choix change.
- Le choix n'est pas gardé : à chaque chargement de la page, c'est le projet. Si le worktree choisi disparaît, Yaide revient au projet et le dit.
- Restent sur le projet : la recherche, l'ouverture rapide, les shells, l'agent, Claude et opencode.
- Créer ou supprimer un worktree se fait dans un shell (`git worktree add ../essai -b essai`, `git worktree remove ../essai`) : la liste est relue toutes les 3 s et suit d'elle-même.

## Réglages de l'interface

Le fichier `.yaide/interface.json` du projet règle l'interface. Écrivez-le vous-même, dans l'éditeur de Yaide ou ailleurs, ou réglez-le par le dialogue « Préférences d'interface » (voir plus bas). Yaide ne l'écrit que par « Enregistrer » de ce dialogue. Il a deux parties, toutes deux facultatives, comme chacune de leurs clés.

- `replis` : l'état à l'ouverture. `true` veut dire replié, `false` déplié. Clés : `panneau` (le panneau de gauche), `shells` (la zone des shells), `agent` (la colonne de droite). Une clé présente l'emporte sur l'état gardé dans le navigateur ; une clé absente ne change rien.
- `fonctions` : les fonctions de l'interface. `false` désactive, `true` ou une clé absente laisse active. Clés : `recherche`, `git`, `shells`, `agents`, `claude`. L'arborescence, l'éditeur, l'ouverture rapide et le thème sont toujours là.

```json
{
  "replis": { "panneau": true, "shells": false, "agent": false },
  "fonctions": { "git": false, "agents": false }
}
```

- **Dialogue « Préférences d'interface ».** Ctrl+P, puis `>` : la commande « Préférences d'interface » ouvre trois choix de repli et cinq cases de fonctions, sans JSON à écrire. « Enregistrer » écrit le même fichier `.yaide/interface.json` (et crée `.yaide/` au besoin) ; les réglages sont pris en compte au rechargement de la page, pas avant.
- **Rechargement.** Le fichier est lu à chaque ouverture ou rechargement de la page, sans relancer Yaide.
- **Fichier illisible.** Un fichier qui n'est pas du JSON de cette forme (clé inconnue, valeur qui n'est pas `true` ou `false`) est ignoré en entier, et un message vous le dit au-dessus des onglets.
- **Fonction désactivée.** Elle n'est qu'absente de l'interface : boutons, panneaux, touches et menus disparaissent, mais rien ne s'arrête et le serveur ne change pas. Les shells ouverts continuent de tourner et reviennent quand la fonction est réactivée ; les conversations, les agents et les réglages de `.yaide/` restent.

## Raccourcis

| Raccourci | Où | Effet |
| --- | --- | --- |
| Ctrl+S | partout sauf dans un shell | Sauvegarde l'onglet actif |
| Ctrl+P | partout sauf dans un shell | Ouvre un fichier par son nom |
| Ctrl+Maj+F | partout, y compris dans un shell | Met le focus sur le bouton actif du rail |
| F, R, G | focus sur le rail | Affiche le panneau (Fichiers, Recherche, Git) et y met le focus |
| Échap puis Tab | éditeur | Quitte l'éditeur (Tab seul indente) |
| Suppr | onglet de fichier qui a le focus | Ferme l'onglet |
| Entrée | onglet qui a le focus | Met le focus dans l'éditeur ou le terminal |
| F2 | ligne de l'arborescence | Renomme ou déplace |
| Suppr | onglet de shell qui a le focus | Ferme le shell, après confirmation |
| Suppr | ligne de l'arborescence | Supprime, après confirmation |
| Ctrl+clic, Maj+clic | ligne de l'arborescence | Sélectionne plusieurs lignes ; les glisser sur un dossier les déplace |
| Menu ou Maj+F10 | ligne de l'arborescence | Ouvre le menu de la ligne (comme le clic droit) |
| Ctrl+Entrée | champ « Message » (Git) | Lance le commit |
| Flèches gauche et droite | poignée « Largeur du panneau » | Élargit ou rétrécit le panneau |
| Flèches haut et bas | poignée « Hauteur des shells » | Agrandit ou réduit la zone des shells |
| Échap | dialogue | Ferme le dialogue et rend le focus |

Un clic droit sur un onglet de fichier (ou la touche Menu, ou Maj+F10) propose « Fermer les autres onglets » et « Fermer tous les onglets » ; chaque onglet modifié demande d'abord s'il faut le sauvegarder, et « Annuler » arrête la série.

Quatre boutons en bas du rail, à gauche, agissent sur les shells : « Nouveau shell », « Réduire le shell », « Shells réduits » et « Fermer le shell ». Chaque onglet de shell a aussi sa croix, qui ferme son shell après la même confirmation. « Réduire le shell » retire le shell actif de la barre d'onglets sans l'arrêter : ses programmes continuent. « Shells réduits » liste les shells réduits (avec leur nombre) ; en choisir un le fait revenir à sa place. Sans shell visible, la zone des shells disparaît et l'éditeur prend toute la hauteur ; « Nouveau shell » ou un shell réduit qu'on affiche la fait revenir. Les shells réduits le restent après un rechargement de la page. On ne ferme pas un shell réduit : affichez-le d'abord.

Deux boutons de la barre de titre, à gauche de « Thème clair », replient le panneau (« Replier le panneau ») et la zone des shells (« Replier les shells »). Ils ne ferment aucun shell : les programmes continuent et leur affichage est gardé. Le bouton prend alors le nom « Déplier le panneau » ou « Déplier les shells ». Un bouton en face du titre du panneau le replie aussi, et un clic sur « Fichiers », « Recherche » ou « Git » dans le rail le ramène. Un clic sur un onglet du rail, ou F, R ou G quand le focus est sur le rail, déplie le panneau ; « Nouveau shell » ou un shell choisi dans « Shells réduits » déplie la zone. Le repli est gardé dans le navigateur. « Replier les shells » est grisé sans shell visible.

Quand le focus est dans un shell, toutes les touches que le navigateur laisse passer vont au shell, dont Ctrl+S et Ctrl+P. Seul Ctrl+Maj+F reste à Yaide.

## Aperçu markdown

À l'ouverture, un fichier markdown (`.md`, `.markdown`) s'affiche en mode hybride, et un fichier HTML avec son aperçu à côté de l'éditeur. Un clic sur « Mode hybride » ou sur « Aperçu » éteint ce mode pour cet onglet seulement : un onglet fermé puis rouvert reprend le mode par défaut, et un onglet restauré au retour garde son état.

Sur un fichier markdown, le bouton « Mode hybride » met le texte en forme dans l'éditeur même : les marques reviennent sur la ligne du curseur, et le fichier n'est pas modifié. Les tableaux s'affichent mis en forme et les lignes ``` d'un bloc de code s'effacent ; ils reviennent en texte quand le curseur y entre.

Dans l'aperçu d'un fichier markdown, un bloc de code est coloré comme dans l'éditeur, avec les mêmes couleurs, si le mot après les trois accents graves est un nom de langage ou une extension : `rust` ou `rs`, `javascript` ou `js`, `typescript` ou `ts`, `python` ou `py`, `go`, `c`, `c++` ou `cpp`, `html`, `css`, `json`, `yaml` ou `yml`, `toml`, `markdown` ou `md`, `shell`, `bash` ou `sh`. Sans mot, ou avec un mot inconnu, le bloc reste en texte simple. Le code en ligne n'est pas coloré.

Le bouton « Aperçu » existe aussi pour les fichiers HTML (`.html` et `.htm`) : la page s'affiche avec ses propres styles, sans exécuter ses scripts ni charger ses images, feuilles de style ou polices.

## Thème clair

Le bouton « Thème clair », à droite de la barre de titre, fait passer toute l'interface (éditeur et shells compris) en clair, sans recharger la page ni perdre le texte ou l'affichage des shells. Un nouveau clic revient au sombre. Le choix est gardé dans le navigateur, pour cette adresse, et s'applique dès l'affichage, y compris sur l'écran de connexion. Le sombre est le thème par défaut.

## Ce qui a changé de place

- Le rail, à gauche, porte les panneaux Fichiers, Recherche et Git (Git y affiche le nombre de changements), puis les quatre boutons des shells en bas. La déconnexion est à droite de la barre de titre.
- L'ouverture d'un fichier par son nom est le bouton central de la barre de titre (ou Ctrl+P) ; sa liste s'ouvre juste en dessous.
- La branche, la position du curseur et le langage du fichier sont dans la barre d'état, en bas.
- Le fil d'Ariane du fichier ouvert est au-dessus du code ; les statuts git (M, A, D, U, C) sont dans l'arborescence et sur les onglets.
- Les largeurs du panneau et la hauteur des shells se règlent en tirant les poignées, ou avec les flèches quand elles ont le focus.
- Les commandes sont des boutons à icône ; leur nom apparaît dans une info-bulle.

## Police et licences

Le code (éditeur et shells) utilise JetBrains Mono, servie par le binaire lui-même : aucune requête ne part vers une autre adresse. L'interface garde la police du système. La police est sous licence SIL Open Font License 1.1 ; le texte complet est servi par Yaide à l'adresse `/polices/OFL.txt` (source : `web/src/ui/polices/OFL.txt`).
