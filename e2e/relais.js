import net from "node:net";

/**
 * Relais TCP devant Yaide : `couper()` ferme les connexions en cours et refuse les nouvelles,
 * `retablir()` les accepte de nouveau. Le serveur, lui, ne s'arrête pas.
 */
export async function lancerRelais(portCible) {
  const connexions = new Set();
  let coupe = false;
  const serveur = net.createServer((client) => {
    if (coupe) return client.destroy();
    const cible = net.connect(portCible, "127.0.0.1");
    for (const s of [client, cible]) {
      connexions.add(s);
      s.on("close", () => {
        connexions.delete(s);
        (s === client ? cible : client).destroy();
      });
      s.on("error", () => {});
    }
    client.pipe(cible);
    cible.pipe(client);
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const port = serveur.address().port;
  return {
    port,
    origine: `https://127.0.0.1:${port}`,
    couper() {
      coupe = true;
      for (const s of connexions) s.destroy();
    },
    retablir() {
      coupe = false;
    },
    fermer() {
      coupe = true;
      for (const s of connexions) s.destroy();
      serveur.close();
    },
  };
}
