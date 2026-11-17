const CLE = "yaide-theme";

export function themeCourant() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function changerTheme(theme) {
  if (theme !== "dark" && theme !== "light") throw new Error(`thème inconnu : ${theme}`);
  localStorage.setItem(CLE, theme);
  document.documentElement.setAttribute("data-theme", theme);
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: theme }));
}

const CLE_WHITEBOARD = "yaide-theme-whiteboard";

/** Le choix de thème des whiteboards (REQ-143) : `"light"`, `"dark"`, ou `null` tant qu'aucun choix n'est fait. */
export function themeWhiteboard() {
  const v = localStorage.getItem(CLE_WHITEBOARD);
  return v === "light" || v === "dark" ? v : null;
}

export function changerThemeWhiteboard(theme) {
  if (theme !== "dark" && theme !== "light") throw new Error(`thème inconnu : ${theme}`);
  localStorage.setItem(CLE_WHITEBOARD, theme);
  document.dispatchEvent(new CustomEvent("yaide-theme-whiteboard", { detail: theme }));
}
