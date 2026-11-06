#!/bin/sh
# Installe ou met à jour Yaide pour l'utilisateur courant (sans sudo).
#
#   curl -fsSL https://raw.githubusercontent.com/tixplop/yaide/master/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/tixplop/yaide/master/install.sh | sh -s -- v0.3.0
#
# Variables : YAIDE_BIN_DIR (défaut ~/.local/bin), YAIDE_VERSION (défaut : dernière release).
set -eu

DEPOT="tixplop/yaide"
BIN_DIR="${YAIDE_BIN_DIR:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/yaide"
VERSION="${1:-${YAIDE_VERSION:-}}"

erreur() { echo "Erreur : $*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || erreur "lancez ce script sans sudo ni root : il installe pour l'utilisateur courant."
[ "$(uname -s)" = Linux ] || erreur "seul Linux (dont WSL2) est pris en charge."
case "$(uname -m)" in
  x86_64 | amd64) ;;
  *) erreur "seule l'architecture x86_64 est prise en charge (ici : $(uname -m))." ;;
esac
for outil in tar sha256sum; do
  command -v "$outil" >/dev/null 2>&1 || erreur "« $outil » est introuvable."
done

if command -v curl >/dev/null 2>&1; then
  telecharger() { curl -fsSL -o "$2" "$1"; }
  derniere_url() { curl -fsSIL -o /dev/null -w '%{url_effective}' "$1"; }
elif command -v wget >/dev/null 2>&1; then
  telecharger() { wget -q -O "$2" "$1"; }
  derniere_url() { wget -q -S -O /dev/null "$1" 2>&1 | sed -n 's/^ *[Ll]ocation: *//p' | tail -n 1 | tr -d '\r'; }
else
  erreur "il faut curl ou wget."
fi

if [ -z "$VERSION" ]; then
  url=$(derniere_url "https://github.com/$DEPOT/releases/latest") || url=""
  VERSION="${url##*/}"
fi
case "$VERSION" in
  v[0-9]*) ;;
  [0-9]*) VERSION="v$VERSION" ;;
  *) erreur "impossible de déterminer la dernière version." ;;
esac

ancienne=""
[ -f "$DATA_DIR/version" ] && ancienne=$(cat "$DATA_DIR/version")
if [ "$ancienne" = "$VERSION" ] && [ -x "$BIN_DIR/yaide" ]; then
  echo "Yaide $VERSION est déjà installé dans $BIN_DIR/yaide."
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

nom="yaide-$VERSION-x86_64-linux"
base="https://github.com/$DEPOT/releases/download/$VERSION"
echo "Téléchargement de Yaide $VERSION…"
telecharger "$base/$nom.tar.gz" "$tmp/$nom.tar.gz" || erreur "téléchargement impossible : $base/$nom.tar.gz"
telecharger "$base/$nom.tar.gz.sha256" "$tmp/$nom.tar.gz.sha256" || erreur "empreinte introuvable pour $VERSION."
(cd "$tmp" && sha256sum -c --quiet "$nom.tar.gz.sha256") || erreur "l'empreinte SHA-256 ne correspond pas."
tar -xzf "$tmp/$nom.tar.gz" -C "$tmp"

# Copie puis renommage : une instance déjà lancée garde l'ancien binaire.
mkdir -p "$BIN_DIR" "$DATA_DIR"
cp "$tmp/$nom/yaide" "$BIN_DIR/.yaide.nouveau"
chmod 755 "$BIN_DIR/.yaide.nouveau"
mv -f "$BIN_DIR/.yaide.nouveau" "$BIN_DIR/yaide"
echo "$VERSION" > "$DATA_DIR/version"

if [ -n "$ancienne" ]; then
  echo "Yaide mis à jour de $ancienne vers $VERSION dans $BIN_DIR/yaide."
  echo "Les instances déjà lancées gardent l'ancienne version jusqu'à leur redémarrage."
else
  echo "Yaide $VERSION installé dans $BIN_DIR/yaide."
  echo "Définissez ensuite votre mot de passe : yaide passwd"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Attention : $BIN_DIR n'est pas dans votre PATH. Ajoutez à votre ~/.bashrc ou ~/.zshrc :"
     echo "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
