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
