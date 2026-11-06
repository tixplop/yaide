# Yaide

Un éditeur de code, un shell et un suivi Git dans le navigateur, servis par un seul binaire. Rien n'est envoyé vers l'extérieur.

## Compiler

Il faut Rust, Node.js, npm et gcc.

```
rustup target add x86_64-unknown-linux-musl
npm install
npm run build
cargo build --release --target x86_64-unknown-linux-musl
```

`npm run build` produit l'interface dans `web/dist/` ; le binaire l'embarque. Le binaire obtenu, `target/x86_64-unknown-linux-musl/release/yaide`, est statique et se suffit à lui-même : aucun fichier à côté.

## Installer

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

Le dossier est obligatoire. Le port par défaut est 8443. Ouvrez ensuite `https://localhost:8443` sur cette machine, ou `https://<adresse de la machine>:8443` depuis une autre. N'ouvrez pas `https://0.0.0.0:8443` : les navigateurs peuvent refuser cette adresse. Plusieurs instances peuvent tourner en même temps, chacune sur son port et son dossier.

Aucun shell n'est lancé au démarrage : « Nouveau shell » en ouvre un, et porte le nombre de shells ouverts.

Messages d'erreur courants : sans mot de passe défini, lancez `yaide passwd` ; si le port est occupé, choisissez-en un autre avec `--port` ; le dossier doit exister.

## Avertissement du certificat

Yaide sert en HTTPS avec un certificat auto-signé, créé au premier lancement dans le dossier de configuration (`certificat.pem` et `cle.pem`) puis réutilisé, valable 10 ans. Aucune autorité ne le garantit, donc le navigateur affiche un avertissement la première fois : choisissez de continuer vers le site (« Avancé », puis « Continuer »). Le navigateur peut le redemander si vous supprimez le certificat.

## Réseau public : risque accepté

Yaide écoute sur toutes les adresses de la machine. Le mot de passe est la seule protection, et le certificat auto-signé ne prouve pas l'identité du serveur. Quiconque atteint le port peut tenter de deviner le mot de passe, et quiconque se connecte donne accès à un shell et aux fichiers du dossier avec vos droits. Sur un réseau public, ce risque est accepté : choisissez un mot de passe long et unique, limitez l'accès avec un pare-feu ou un VPN si vous le pouvez, et ne lancez pas Yaide en administrateur.

## Agent

La vue Agent est le quatrième onglet du rail (touche A quand le focus est sur le rail). L'agent lit et modifie les fichiers du projet et lance des commandes pour mener à bien ce que vous lui demandez.

- **Réglages.** Ctrl+P puis `>` ouvre les commandes : « Providers LLM » (adresse et clé d'API de OpenAI, Anthropic, Google, OpenRouter, LiteLLM, Ollama) et « Profils de modèle » (provider, modèle, effort, température, sortie max., fenêtre de contexte). Une conversation utilise un profil ; le profil par défaut sert aux nouvelles conversations.
- **Dossier `.yaide/`.** Il est créé dans le projet. `config.json` garde les adresses et les profils, `secrets` les clés d'API chiffrées, `conversations/` une conversation par fichier. Pensez à l'ajouter à `.gitignore` si vous ne voulez pas le versionner.
- **Clé de chiffrement.** Les clés d'API sont chiffrées (AES-256-GCM) avec la clé `~/.config/yaide/cle-secrets`, créée au premier besoin (le dossier suit `XDG_CONFIG_HOME` s'il est défini). Si vous la perdez, les clés enregistrées deviennent illisibles : saisissez-les de nouveau.
- **`AGENTS.md`.** S'il existe à la racine du projet, son contenu est ajouté aux instructions de l'agent à chaque requête.
- **Sept outils.** `read`, `write`, `edit`, `bash`, `glob` (fichiers du projet, sans ceux que git ignore), `websearch` et `webfetch` (web).
- **Aucune confirmation.** L'agent exécute ses outils sans vous demander : il écrit des fichiers et lance des commandes avec vos droits, dans le dossier du projet. Le bouton « Arrêter » interrompt le tour en cours. Ne lui confiez que des projets dont vous acceptez qu'ils soient modifiés ; un fichier qu'il écrit et que vous n'avez pas modifié se recharge dans l'éditeur.
- **Ce qui part vers l'extérieur.** Rien tant que vous n'envoyez pas de message. Ensuite : vos messages, les instructions, le contenu des fichiers lus et les sorties des commandes vont au provider du profil choisi (à l'adresse réglée dans « Providers LLM », donc sur votre machine pour Ollama) ; `websearch` interroge la page HTML de DuckDuckGo ; `webfetch` télécharge les pages que l'agent demande.

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

Quatre boutons en bas du rail, à gauche, agissent sur les shells : « Nouveau shell », « Réduire le shell », « Shells réduits » et « Fermer le shell ». Chaque onglet de shell a aussi sa croix, qui ferme son shell après la même confirmation. « Réduire le shell » retire le shell actif de la barre d'onglets sans l'arrêter : ses programmes continuent. « Shells réduits » liste les shells réduits (avec leur nombre) ; en choisir un le fait revenir à sa place. Sans shell visible, la zone des shells disparaît et l'éditeur prend toute la hauteur ; « Nouveau shell » ou un shell réduit qu'on affiche la fait revenir. Les shells réduits le restent après un rechargement de la page. On ne ferme pas un shell réduit : affichez-le d'abord.

Deux boutons de la barre de titre, à gauche de « Thème clair », replient le panneau (« Replier le panneau ») et la zone des shells (« Replier les shells »). Ils ne ferment aucun shell : les programmes continuent et leur affichage est gardé. Le bouton prend alors le nom « Déplier le panneau » ou « Déplier les shells ». Un bouton en face du titre du panneau le replie aussi, et un clic sur « Fichiers », « Recherche » ou « Git » dans le rail le ramène. Un clic sur un onglet du rail, ou F, R ou G quand le focus est sur le rail, déplie le panneau ; « Nouveau shell » ou un shell choisi dans « Shells réduits » déplie la zone. Le repli est gardé dans le navigateur. « Replier les shells » est grisé sans shell visible.

Quand le focus est dans un shell, toutes les touches que le navigateur laisse passer vont au shell, dont Ctrl+S et Ctrl+P. Seul Ctrl+Maj+F reste à Yaide.

## Aperçu markdown

Dans l'aperçu d'un fichier markdown, un bloc de code est coloré comme dans l'éditeur, avec les mêmes couleurs, si le mot après les trois accents graves est un nom de langage ou une extension : `rust` ou `rs`, `javascript` ou `js`, `typescript` ou `ts`, `python` ou `py`, `go`, `c`, `c++` ou `cpp`, `html`, `css`, `json`, `yaml` ou `yml`, `toml`, `markdown` ou `md`, `shell`, `bash` ou `sh`. Sans mot, ou avec un mot inconnu, le bloc reste en texte simple. Le code en ligne n'est pas coloré.

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
