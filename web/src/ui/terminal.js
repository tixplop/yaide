import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { indication } from "./indication.js";

// Tableau ANSI du design system : noir, rouge, vert, jaune, bleu, magenta, cyan, blanc (puis version vive).
const ANSI = {
  black: "--bordure",
  red: "--erreur",
  green: "--succes",
  yellow: "--alerte",
  blue: "--accent",
  magenta: "--code-mot-cle",
  cyan: "--code-fonction",
  white: "--texte-attenue",
  brightBlack: "--bordure-champ",
  brightRed: "--erreur",
  brightGreen: "--succes",
  brightYellow: "--alerte",
  brightBlue: "--accent",
  brightMagenta: "--code-mot-cle",
  brightCyan: "--code-fonction",
  brightWhite: "--texte",
};

function themeDepuisTokens() {
  const style = getComputedStyle(document.documentElement);
  const v = (token) => style.getPropertyValue(token).trim();
  const theme = { background: v("--fond"), foreground: v("--texte"), cursor: v("--texte"), cursorAccent: v("--fond"), selectionBackground: v("--selection") };
  for (const [nom, token] of Object.entries(ANSI)) theme[nom] = v(token);
  return theme;
}

// Taille de police et interligne tirées de --texte-lecture (« 14px/20px »).
function policeDepuisTokens() {
  const style = getComputedStyle(document.documentElement);
  const [taille, ligne] = style.getPropertyValue("--texte-lecture").trim().split("/");
  return {
    fontFamily: style.getPropertyValue("--police-code").trim(),
    fontSize: parseFloat(taille),
    lineHeight: parseFloat(ligne) / parseFloat(taille),
  };
}

const CTRL_MAJ_F = (e) => e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f";

export function terminal({ flux, connecte = true, numero, surTaille } = {}) {
  if (!flux) throw new Error("terminal : flux requis");
  const racine = document.createElement("div");
  racine.className = "terminal";
  const attente = indication({ texte: "(en attente de la connexion)" });
  attente.classList.add("terminal-attente");
  const zone = document.createElement("div");
  zone.className = "terminal-zone";
  zone.setAttribute("aria-label", numero === undefined ? "Shell" : `Shell ${numero}`);
  racine.append(attente, zone);

  const term = new Terminal({ cursorBlink: false, theme: themeDepuisTokens(), ...policeDepuisTokens() });
  term.open(zone);
  // Ctrl+Maj+F reste à l'application : xterm ne le traite pas, il remonte jusqu'au document.
  term.attachCustomKeyEventHandler((e) => !CTRL_MAJ_F(e));
  flux.binaryType = "arraybuffer";
  term.onData((d) => flux.send(d));
  flux.addEventListener("message", (e) => {
    term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
  });

  // Sans module d'ajustement : la taille d'une cellule se déduit de l'écran de xterm.
  function ajuster() {
    const ecran = zone.querySelector(".xterm-screen");
    if (!ecran || !zone.clientWidth || !zone.clientHeight) return;
    const largeur = ecran.offsetWidth / term.cols;
    const hauteur = ecran.offsetHeight / term.rows;
    if (!largeur || !hauteur) return;
    const defilement = zone.querySelector(".xterm-viewport");
    const barre = defilement ? defilement.offsetWidth - defilement.clientWidth : 0;
    const colonnes = Math.max(2, Math.floor((zone.clientWidth - barre) / largeur));
    const lignes = Math.max(1, Math.floor(zone.clientHeight / hauteur));
    if (colonnes !== term.cols || lignes !== term.rows) term.resize(colonnes, lignes);
  }
  term.onResize(({ cols, rows }) => surTaille?.(cols, rows));
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(ajuster).observe(zone);

  racine.term = term;
  racine.ajuster = ajuster;
  racine.focus = () => term.focus();
  racine.definirConnecte = (oui) => {
    attente.hidden = oui;
    term.options.disableStdin = !oui;
  };
  racine.detruire = () => term.dispose();
  racine.definirConnecte(connecte);
  return racine;
}
