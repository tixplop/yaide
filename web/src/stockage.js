// Petit magasin clé-valeur dans IndexedDB. Sans IndexedDB, lire rend undefined et écrire ne fait rien.
function ouvrir() {
  return new Promise((resolu) => {
    if (typeof indexedDB === "undefined") return resolu(null);
    const demande = indexedDB.open("yaide", 1);
    demande.onupgradeneeded = () => demande.result.createObjectStore("cles");
    demande.onsuccess = () => resolu(demande.result);
    demande.onerror = () => resolu(null);
  });
}

function transaction(mode, action) {
  return ouvrir().then(
    (base) =>
      new Promise((resolu) => {
        if (!base) return resolu(undefined);
        const t = base.transaction("cles", mode);
        const r = action(t.objectStore("cles"));
        t.oncomplete = () => {
          base.close();
          resolu(r?.result);
        };
        t.onerror = t.onabort = () => {
          base.close();
          resolu(undefined);
        };
      }),
  );
}

export const lire = (cle) => transaction("readonly", (m) => m.get(cle));
export const ecrire = (cle, valeur) => transaction("readwrite", (m) => m.put(valeur, cle));
