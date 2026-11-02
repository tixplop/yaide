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

Le dossier est obligatoire. Le port par défaut est 8443. Ouvrez ensuite `https://<adresse de la machine>:8443`. Plusieurs instances peuvent tourner en même temps, chacune sur son port et son dossier.

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
| Suppr | ligne de l'arborescence | Supprime, après confirmation |
| Ctrl+Entrée | champ « Message » (Git) | Lance le commit |
| Échap | dialogue | Ferme le dialogue et rend le focus |

Quand le focus est dans un shell, toutes les touches que le navigateur laisse passer vont au shell, dont Ctrl+S et Ctrl+P. Seul Ctrl+Maj+F reste à Yaide.
