// Chargé en bloquant dans <head>, avant les feuilles de style : pose le thème gardé, sombre par défaut.
(function () {
  var theme = "dark";
  try {
    if (localStorage.getItem("yaide-theme") === "light") theme = "light";
  } catch {
    // stockage indisponible : thème par défaut
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
