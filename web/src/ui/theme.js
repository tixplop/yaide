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
