// Export en PDF : parties sans DOM, partagées avec le navigateur (REQ-177, DEC-115).

export const POLICE_TEXTE = "Helvetica";
export const POLICE_CODE = "JetBrainsMono";
export const POLICE_IDEOGRAMMES = "NotoSansSC";

const MM = 72 / 25.4;

// Caractères de la police standard Helvetica : jeu WinAnsi (Windows-1252).
const WIN_ANSI = "20-7e a0-ff 152-153 160-161 178-178 17d-17e 192-192 2c6-2c6 2dc-2dc 2013-2014 2018-201a 201c-201e 2020-2022 2026-2026 2030-2030 2039-203a 20ac-20ac 2122-2122";
// Caractères de JetBrains Mono Regular (JetBrainsMono-Regular.ttf), et de Noto Sans SC Regular (NotoSansSC-Regular.ttf) à partir de U+2000, lus dans le cmap de ces fichiers.
const JETBRAINS = "20-7e a0-ac ae-17f 18f-190 192-192 19b-19b 1a0-1a1 1af-1b0 1cd-1dc 1e6-1e7 1ea-1eb 1f4-1f5 1fc-1ff 218-21b 232-233 237-237 259-259 25b-25b 2b9-2ba 2bc-2bc 2c6-2c7 2c9-2c9 2d8-2dd 2f3-2f3 2f7-2f7 300-304 306-30c 30f-30f 312-312 31b-31b 323-323 325-328 336-338 374-375 37e-37e 384-38a 38c-38c 38e-3a1 3a3-3cf 3d5-3d7 401-40c 40e-44f 451-45c 45e-45f 490-493 49a-49b 4a2-4a3 4ae-4b1 4b6-4b7 4ba-4bb 4d8-4d9 4dc-4df 4e4-4e9 4f4-4f5 aea-aea 1e80-1e85 1e9e-1e9e 1ea0-1ef9 2001-2001 200b-200b 2010-2010 2013-2014 2016-2016 2018-2022 2024-2024 2026-2026 2030-2030 2032-2034 2039-203a 203c-203f 2044-2046 2070-2070 2074-207a 207c-207c 2080-2089 20ab-20ac 20ae-20ae 20b4-20b4 20bd-20bd 20bf-20bf 2102-2102 210d-210d 2113-2113 2115-2116 2119-211a 211d-211d 2122-2122 2124-2124 212e-212e 2140-2140 218a-218b 2190-2199 219d-219e 21a0-21a0 21a2-21a3 21a5-21a7 21a9-21aa 21ad-21ad 21be-21be 21c9-21c9 21d0-21d4 21db-21db 21de-21df 21e5-21e5 21e7-21e8 21ea-21ea 2200-220c 220e-2213 2215-2215 2218-221a 221e-221e 2223-2225 2227-222b 2234-2239 223c-223c 223e-223e 2243-2243 2245-2245 2247-2249 224b-224b 224d-224d 2254-2254 2257-2257 225f-2265 226a-2273 227a-227c 2282-2289 228e-2299 229b-22a5 22b4-22b4 22b8-22b8 22bb-22bd 22c2-22c4 22c6-22c6 22c8-22ca 22ce-22ce 22d0-22d0 22e2-22e2 22ee-22f1 2302-2305 2308-230b 2318-2318 231c-231f 2324-2326 2328-2328 232b-232b 2336-237a 2389-238b 2395-2395 239b-23ad 23ce-23ce 23fb-23fe 2400-2421 2423-2424 2500-25a1 25aa-25ab 25b2-25cc 25ce-25cf 25d4-25d5 25e6-25eb 25ef-25ef 25f6-25f6 266d-266d 266f-266f 2687-2687 26a0-26a1 2713-2713 2715-2715 2717-2717 2736-2736 276e-2771 2794-2794 279c-279e 27c5-27c6 27dc-27dc 27e6-27eb 27f5-27f7 2916-2916 294a-294a 2987-2988 2a00-2a00 2a05-2a06 2b58-2b58 e0a0-e0a2 e0b0-e0b3 fe62-fe62 feff-feff ff5b-ff5b ff5d-ff5d fffd-fffd 16910-16910 1d538-1d539 1d53b-1d53e 1d540-1d544 1d546-1d546 1d54a-1d550 1d552-1d56b";
const IDEOGRAMMES = "2002-2003 2010-2016 2018-201a 201c-201e 2020-2022 2025-2027 2030-2030 2032-2033 2035-2035 2039-203c 2042-2042 2047-2049 2051-2051 2074-2074 20a9-20a9 20ab-20ac 20dd-20de 2100-2100 2103-2103 2105-2105 2109-210a 210f-210f 2113-2113 2116-2116 2121-2122 2126-2127 212b-212b 212e-212e 2135-2135 213b-213b 2160-216b 2170-217b 2190-2199 21b8-21b9 21c4-21c6 21cb-21cc 21d0-21d0 21d2-21d2 21d4-21d4 21e6-21e9 21f5-21f5 2200-2200 2202-2203 2205-220b 220f-220f 2211-2213 2215-2215 221a-221a 221d-2220 2223-2223 2225-222e 2234-2237 223d-223d 2243-2243 2245-2245 2248-2248 224c-224c 2260-2262 2264-2267 226a-226b 226e-226f 2272-2273 2276-2277 2282-2287 228a-228b 2295-2299 22a0-22a0 22a5-22a5 22bf-22bf 22da-22db 22ef-22ef 2305-2307 2312-2312 2318-2318 2329-232a 23b0-23b1 23be-23cc 23ce-23ce 23da-23db 2423-2423 2460-25ab 25b1-25b3 25b6-25b7 25bc-25bd 25c0-25c1 25c6-25c7 25c9-25cc 25ce-25d3 25e2-25e6 25ef-25ef 2600-2603 2605-2606 2609-2609 260e-260f 2616-2617 261c-261f 262f-262f 2640-2642 2660-266f 2672-267d 26a0-26a0 26bd-26be 2702-2702 2713-2713 271a-271a 273d-273d 273f-2740 2756-2756 2776-2793 27a1-27a1 2934-2935 29bf-29bf 29fa-29fb 2b05-2b07 2b1a-2b1a 2b95-2b95 2e3a-2e3b 2e80-2e99 2e9b-2ef3 2f00-2fd5 2ff0-2ffb 3000-303f 3041-3096 3099-30ff 3105-312f 3131-3163 3165-318e 3190-31bb 31c0-31e3 31f0-321e 3220-332b 332d-4db5 4e00-9fef f900-f903 f905-f906 f90b-f90c f915-f915 f917-f91a f921-f921 f92c-f92d f92f-f92f f931-f935 f937-f93a f943-f943 f947-f94a f94e-f94e f952-f953 f95e-f95e f962-f967 f96e-f96e f972-f972 f974-f974 f976-f976 f979-f97b f97e-f980 f984-f985 f98a-f98c f98e-f98e f993-f993 f995-f995 f998-f998 f9ae-f9ae f9b3-f9b3 f9b7-f9b7 f9bb-f9bb f9bd-f9be f9c0-f9c0 f9c5-f9c6 f9d0-f9d0 f9d8-f9d9 f9dc-f9e0 f9e2-f9e4 f9e7-f9e7 f9e9-f9e9 f9f1-f9f1 f9f4-f9f5 f9fa-f9fa f9fd-f9fd f9ff-f9ff fa02-fa02 fa05-fa08 fa0a-fa0a fa0c-fa0f fa11-fa11 fa13-fa14 fa18-fa18 fa1f-fa21 fa23-fa24 fa27-fa29 fa2f-fa2f fa33-fa35 fa37-fa38 fa3a-fa3a fa47-fa47 fa49-fa49 fa4b-fa4b fa5d-fa5e fb00-fb04 fe10-fe19 fe30-fe52 fe54-fe66 fe68-fe6b ff01-ff9f ffa1-ffbe ffc2-ffc7 ffca-ffcf ffd2-ffd7 ffda-ffdc ffe0-ffe6 ffe8-ffee 1f100-1f10c 1f110-1f16c 1f170-1f1ac 1f200-1f202 1f210-1f23b 1f240-1f248 1f250-1f251 20087-20087 20089-20089 200cc-200cc 20164-20164 20628-20628 20676-20676 20cd0-20cd0 2139a-2139a 21413-21413 215d7-215d7 2298f-2298f 235cb-235cb 23c97-23c98 23e23-23e23 241fe-241fe 2420e-2420e 248e9-248e9 249db-249db 24a01-24a01 24a7d-24a7d 24ac9-24ac9 25532-25532 25562-25562 255a8-255a8 25ad7-25ad7 25ed7-25ed7 26221-26221 2648d-2648d 26676-26676 2677c-2677c 26951-26951 26b5c-26b5c 26c21-26c21 278b2-278b2 27eaf-27eaf 27fb7-27fb7 27ff9-27ff9 28408-28408 28678-28678 28695-28695 287e0-287e0 28b49-28b49 28c47-28c47 28c4f-28c4f 28c51-28c51 28c54-28c54 28e0f-28e0f 28e99-28e99 2967f-2967f 29810-29810 29f7e-29f7e 29f83-29f83 29f8c-29f8c 2a7dd-2a7dd 2a8fb-2a8fb 2a917-2a917 2aa30-2aa30 2aa36-2aa36 2aa58-2aa58 2afa2-2afa2 2b127-2b128 2b137-2b138 2b1ed-2b1ed 2b300-2b300 2b363-2b363 2b36f-2b36f 2b372-2b372 2b37d-2b37d 2b404-2b404 2b410-2b410 2b413-2b413 2b461-2b461 2b4e7-2b4e7 2b4ef-2b4ef 2b4f6-2b4f6 2b4f9-2b4f9 2b50d-2b50e 2b536-2b536 2b5ae-2b5af 2b5b3-2b5b3 2b5e7-2b5e7 2b5f4-2b5f4 2b61c-2b61d 2b626-2b628 2b62a-2b62a 2b62c-2b62c 2b695-2b696 2b6ad-2b6ad 2b6ed-2b6ed 2b7a9-2b7a9 2b7c5-2b7c5 2b7e6-2b7e6 2b7f9-2b7f9 2b7fc-2b7fc 2b806-2b806 2b80a-2b80a 2b81c-2b81c 2b8b8-2b8b8 2bac7-2bac7 2bb5f-2bb5f 2bb62-2bb62 2bb7c-2bb7c 2bb83-2bb83 2bc1b-2bc1b 2bd77-2bd77 2bd87-2bd87 2bdf7-2bdf7 2be29-2be29 2c029-2c02a 2c0a9-2c0a9 2c0ca-2c0ca 2c1d5-2c1d5 2c1d9-2c1d9 2c1f9-2c1f9 2c27c-2c27c 2c288-2c288 2c2a4-2c2a4 2c317-2c317 2c35b-2c35b 2c361-2c361 2c364-2c364 2c488-2c488 2c494-2c494 2c497-2c497 2c542-2c542 2c613-2c613 2c618-2c618 2c621-2c621 2c629-2c629 2c62b-2c62d 2c62f-2c62f 2c642-2c642 2c64a-2c64b 2c72c-2c72c 2c72f-2c72f 2c79f-2c79f 2c7c1-2c7c1 2c7fd-2c7fd 2c8d9-2c8d9 2c8de-2c8de 2c8e1-2c8e1 2c8f3-2c8f3 2c907-2c907 2c90a-2c90a 2c91d-2c91d 2ca02-2ca02 2ca0e-2ca0e 2ca7d-2ca7d 2caa9-2caa9 2cb29-2cb29 2cb2d-2cb2e 2cb31-2cb31 2cb38-2cb39 2cb3b-2cb3b 2cb3f-2cb3f 2cb41-2cb41 2cb4a-2cb4a 2cb4e-2cb4e 2cb5a-2cb5b 2cb64-2cb64 2cb69-2cb69 2cb6c-2cb6c 2cb6f-2cb6f 2cb73-2cb73 2cb76-2cb76 2cb78-2cb78 2cb7c-2cb7c 2cbb1-2cbb1 2cbbf-2cbc0 2cbce-2cbce 2cc56-2cc56 2cc5f-2cc5f 2ccf5-2ccf6 2ccfd-2ccfd 2ccff-2ccff 2cd02-2cd03 2cd0a-2cd0a 2cd8b-2cd8b 2cd8d-2cd8d 2cd8f-2cd90 2cd9f-2cda0 2cda8-2cda8 2cdad-2cdae 2cdd5-2cdd5 2ce18-2ce18 2ce1a-2ce1a 2ce23-2ce23 2ce26-2ce26 2ce2a-2ce2a 2ce7c-2ce7c 2ce88-2ce88 2ce93-2ce93 2d544-2d544 2f884-2f884 2f8b6-2f8b6 30edd-30ede 3106c-3106c";

function lireJeu(chaine) {
  return chaine.split(" ").map((p) => {
    const [a, b] = p.split("-");
    return [parseInt(a, 16), parseInt(b, 16)];
  });
}
const JEUX = {
  [POLICE_TEXTE]: lireJeu(WIN_ANSI),
  [POLICE_CODE]: lireJeu(JETBRAINS),
  [POLICE_IDEOGRAMMES]: lireJeu(IDEOGRAMMES),
};

function aLeCaractere(police, cp) {
  return JEUX[police].some(([a, b]) => cp >= a && cp <= b);
}

/** Nom du PDF d'un onglet : la dernière extension est remplacée par `.pdf` (`Makefile` → `Makefile.pdf`). */
export function nomPdf(chemin) {
  const nom = chemin.split("/").pop();
  const i = nom.lastIndexOf(".");
  return (i > 0 ? nom.slice(0, i) : nom) + ".pdf";
}

/**
 * Découpe `texte` en morceaux `{ texte, police }` : chaque caractère prend la première police qui l'a,
 * parmi `police` (celle de départ : Helvetica ou JetBrains Mono), JetBrains Mono, puis Noto Sans SC.
 * Les caractères qu'aucune n'a (emoji compris) sont retirés. `ideogrammes` : Noto Sans SC est nécessaire.
 */
export function morceaux(texte, police) {
  const ordre = [...new Set([police, POLICE_CODE, POLICE_IDEOGRAMMES])];
  const morceaux = [];
  let ideogrammes = false;
  for (const c of texte) {
    const cp = c.codePointAt(0);
    const p = ordre.find((nom) => aLeCaractere(nom, cp));
    if (!p) continue;
    if (p === POLICE_IDEOGRAMMES) ideogrammes = true;
    const dernier = morceaux[morceaux.length - 1];
    if (dernier && dernier.police === p) dernier.texte += c;
    else morceaux.push({ texte: c, police: p });
  }
  return { morceaux, ideogrammes };
}

/**
 * Définition `pdfmake` d'un fichier texte : JetBrains Mono 10 pt, lignes coupées au 80e caractère.
 * `encre` : valeur claire du token `--ink`, lue par l'appelant (aucune couleur en dur ici).
 */
export function definitionTexte(texte, nom, encre) {
  const contenu = [];
  let ideogrammes = false;
  for (const ligne of texte.replace(/\r\n?/g, "\n").split("\n")) {
    // eslint-disable-next-line no-control-regex
    const propre = ligne.replace(/\t/g, "    ").replace(/[\x00-\x1f\x7f]/g, "");
    const { morceaux: m, ideogrammes: i } = morceaux(propre, POLICE_CODE);
    if (i) ideogrammes = true;
    const caracteres = m.flatMap((x) => [...x.texte].map((c) => ({ c, police: x.police })));
    for (let debut = 0; debut === 0 || debut < caracteres.length; debut += 80) {
      const parts = [];
      for (const { c, police } of caracteres.slice(debut, debut + 80)) {
        const dernier = parts[parts.length - 1];
        if (dernier && dernier.font === police) dernier.text += c;
        else parts.push({ text: c, font: police });
      }
      contenu.push({ text: parts.length ? parts : " ", preserveLeadingSpaces: true });
    }
  }
  return {
    info: { title: nom },
    compress: false,
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [20 * MM, 20 * MM, 20 * MM, 20 * MM],
    // lineHeight 1.136 : 10 pt × (1020 + 300) / 1000 × 1.136 = 15 pt avec les métriques de JetBrains Mono.
    defaultStyle: { font: POLICE_CODE, fontSize: 10, lineHeight: 1.136, color: encre },
    content: contenu,
    ideogrammes,
  };
}
