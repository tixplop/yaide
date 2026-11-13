import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { indication } from "./indication.js";
import { estMac } from "../references.js";

// Tableau ANSI du design system : noir, rouge, vert, jaune, bleu, magenta, cyan, blanc (puis version vive).
const ANSI = {
  black: "--bg-400",
  red: "--git-deleted",
  green: "--git-added",
  yellow: "--git-modified",
  blue: "--accent-fg",
  magenta: "--git-conflict",
  cyan: "--git-untracked",
  white: "--ink-muted",
  brightBlack: "--ink-faint",
  brightRed: "--syn-string",
  brightGreen: "--syn-number",
  brightYellow: "--syn-function",
  brightBlue: "--syn-variable",
  brightMagenta: "--syn-control",
  brightCyan: "--syn-type",
  brightWhite: "--ink",
};

// xterm.js ne lit pas les variables CSS : on lui donne leurs valeurs calculées.
function themeDepuisTokens() {
  const style = getComputedStyle(document.documentElement);
  const v = (token) => style.getPropertyValue(token).trim();
  const theme = { background: v("--bg-000"), foreground: v("--ink"), cursor: v("--accent-fg"), cursorAccent: v("--bg-000"), selectionBackground: v("--selection") };
  for (const [nom, token] of Object.entries(ANSI)) theme[nom] = v(token);
  return theme;
}

const POLICE = '12.5px "JetBrains Mono"';

const CTRL_MAJ_F = (e) => e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f";

export function terminal({ flux, connecte = true, nom, arrete, surTaille } = {}) {
  if (!flux) throw new Error("terminal : flux requis");
  if (!nom) throw new Error("terminal : nom requis");
  const racine = document.createElement("div");
  racine.className = "terminal";
  const attente = indication({ texte: "(en attente de la connexion)" });
  attente.classList.add("terminal-attente");
  const zone = document.createElement("div");
  zone.className = "terminal-zone";
  zone.setAttribute("aria-label", nom);
  racine.append(attente, zone);

  const term = new Terminal({
    cursorBlink: false,
    cursorStyle: "block",
    theme: themeDepuisTokens(),
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim(),
    fontSize: 12.5,
    lineHeight: 1,
  });
  term.open(zone);
  // Ctrl+Maj+F reste à l'application : xterm ne le traite pas, il remonte jusqu'au document.
  // Hors macOS, Ctrl+C avec sélection et Ctrl+V vont au navigateur (événements copy et paste, que xterm traite).
  term.attachCustomKeyEventHandler((e) => {
    if (CTRL_MAJ_F(e)) return false;
    if (e.type === "keydown" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !estMac()) {
      const touche = e.key.toLowerCase();
      if (touche === "v" || (touche === "c" && term.hasSelection())) return false;
    }
    return true;
  });
  flux.binaryType = "arraybuffer";
  term.onData((d) => flux.send(d));
  flux.addEventListener("message", (e) => {
    term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
  });

  // Sans module d'ajustement : la taille d'une cellule se déduit de l'écran de xterm.
  let policePrete = !document.fonts?.load;
  function ajuster() {
    if (!policePrete) return;
    if (!zone.clientWidth || !zone.clientHeight) return;
    // La cellule vient de xterm, comme dans son module d'ajustement : `.xterm-screen` garde l'ancienne taille tant que le rendu est en pause.
    const { width: largeur, height: hauteur } = term._core._renderService.dimensions.css.cell;
    if (!largeur || !hauteur) return;
    const defilement = zone.querySelector(".xterm-viewport");
    const barre = defilement ? defilement.offsetWidth - defilement.clientWidth : 0;
    const colonnes = Math.max(2, Math.floor((zone.clientWidth - barre) / largeur));
    const lignes = Math.max(1, Math.floor(zone.clientHeight / hauteur));
    if (colonnes !== term.cols || lignes !== term.rows) term.resize(colonnes, lignes);
  }
  term.onResize(({ cols, rows }) => surTaille?.(cols, rows));
  // Au plus un ajustement toutes les 100 ms pendant un glissé, plus un dernier à la fin.
  let attend = null;
  let reste = false;
  function limiter() {
    if (attend) {
      reste = true;
      return;
    }
    racine.ajuster();
    attend = setTimeout(() => {
      attend = null;
      if (reste) {
        reste = false;
        limiter();
      }
    }, 100);
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(limiter).observe(zone);
  // La police se charge après coup : la première mesure l'attend, et une arrivée tardive en provoque une autre.
  // jsdom n'a pas document.fonts.
  const policeArrivee = () => racine.ajuster();
  if (!policePrete) {
    const prete = () => {
      policePrete = true;
      racine.ajuster();
    };
    document.fonts.load(POLICE).then(prete, prete);
    document.fonts.addEventListener?.("loadingdone", policeArrivee);
  }
  const suivreTheme = () => {
    term.options.theme = themeDepuisTokens();
  };
  document.addEventListener("yaide-theme", suivreTheme);

  racine.term = term;
  racine.ajuster = ajuster;
  racine.focus = () => term.focus();
  // Session terminée : l'affichage reste, la saisie et le curseur disparaissent, et une reconnexion ne les rend pas.
  let fini = false;
  racine.definirConnecte = (oui) => {
    attente.hidden = oui || fini;
    term.options.disableStdin = fini || !oui;
  };
  racine.definirArrete = () => {
    fini = true;
    attente.hidden = true;
    term.options.disableStdin = true;
    zone.classList.add("terminal-arrete");
    term.write("\x1b[?25l");
  };
  racine.detruire = () => {
    clearTimeout(attend);
    document.removeEventListener("yaide-theme", suivreTheme);
    document.fonts?.removeEventListener?.("loadingdone", policeArrivee);
    term.dispose();
  };
  racine.definirConnecte(connecte);
  if (arrete) racine.definirArrete();
  return racine;
}
