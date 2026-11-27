/*! Icônes copiées de Lucide (https://lucide.dev). LICENSE de lucide-icons/lucide, branche main, copié tel quel :

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Icônes Lucide (ISC) utilisées ici : power, panel-left-close, panel-left-open, panel-right-close, panel-bottom-close, panel-bottom-open, bot, message-square-plus, history, send-horizontal, circle-stop, circle-dashed, circle-check, circle-x, circle-arrow-up, type, users, user-plus, sliders-horizontal, text-align-start, text-align-center, text-align-end, arrow-left, asterisk, code-xml, circle-minus, brain, messages-square, server, copy, clipboard-paste, locate-fixed, square-dashed, bring-to-front, send-to-back, mouse-pointer-2, circle, diamond, baseline, workflow, move-up-right, square-plus, zoom-out, zoom-in, scan, bold, italic, underline, strikethrough, shapes.
Icônes Lucide (ISC) de la barre « Mise en forme » (REQ-170) : heading, code, text-quote, list-ordered, square-code, table, separator-horizontal.
Icônes Lucide (ISC) des workflows (REQ-190, REQ-191) : waypoints, folder-search, clock, webhook, bot-message-square, square-terminal, square-asterisk, file-cog ; scroll-text (REQ-195).
Dessinées pour Yaide : info, triangle-alert-plein, circle-alert-plein (REQ-187), liste-puces, couleur-texte, opacite-100, opacite-75, opacite-50, opacite-25, opacite-0, taille-petit, taille-normal, taille-grand, taille-tres-grand, epaisseur-fin, epaisseur-moyen, epaisseur-epais, position-haut, position-milieu, position-bas ; les vingt-cinq contenus `symbole-<shape>` (REQ-149) sont de Lucide (database, user-round, users-round, lock, lock-open, circle-check, circle-x, network, wifi, ethernet-port, server, cloud, monitor, smartphone, file-text, mail, settings, triangle-alert, brick-wall, hard-drive, globe, smile, meh, frown), sauf `symbole-pipe`, dessiné pour Yaide ; `forme-point` et `forme-barre` (REQ-156) sont pleins, dessinés pour Yaide.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const CHEMINS = {
  "waypoints": "<circle cx=\"12\" cy=\"4\" r=\"2\"/><circle cx=\"4\" cy=\"12\" r=\"2\"/><circle cx=\"20\" cy=\"12\" r=\"2\"/><circle cx=\"12\" cy=\"20\" r=\"2\"/><path d=\"M6 12h12\"/><path d=\"m10.586 5.414-5.172 5.172\"/><path d=\"m18.586 13.414-5.172 5.172\"/>",
  "folder-search": "<path d=\"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1\"/><path d=\"m21 21-1.9-1.9\"/><circle cx=\"17\" cy=\"17\" r=\"3\"/>",
  "clock": "<path d=\"M12 6v6l4 2\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>",
  "webhook": "<path d=\"M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2\"/><path d=\"m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06\"/><path d=\"m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8\"/>",
  "bot-message-square": "<path d=\"M12 6V2H8\"/><path d=\"m8 18-4 4V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2Z\"/><path d=\"M2 12h2\"/><path d=\"M9 11v2\"/><path d=\"M15 11v2\"/><path d=\"M20 12h2\"/>",
  "square-terminal": "<path d=\"m7 11 2-2-2-2\"/><path d=\"M11 13h4\"/><rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/>",
  "square-asterisk": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M12 8v8\"/><path d=\"m8.5 14 7-4\"/><path d=\"m8.5 10 7 4\"/>",
  "file-cog": "<path d=\"M4 6V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2\"/><path d=\"M14 2v6h6\"/><circle cx=\"6\" cy=\"14\" r=\"3\"/><path d=\"M6 10v1\"/><path d=\"M6 17v1\"/><path d=\"M10 14H9\"/><path d=\"M3 14H2\"/><path d=\"m9 11-.88.88\"/><path d=\"M3.88 16.12 3 17\"/><path d=\"m9 17-.88-.88\"/><path d=\"M3.88 11.88 3 11\"/>",
  "scroll-text": "<path d=\"M15 12h-5\"/><path d=\"M15 8h-5\"/><path d=\"M19 17V5a2 2 0 0 0-2-2H4\"/><path d=\"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3\"/>",
  "files": "<path d=\"M14 3H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7z\"/><path d=\"M14 3v4h4\"/><path d=\"M3 8v11a2 2 0 0 0 2 2h9\"/>",
  "search": "<circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"m20 20-4.2-4.2\"/>",
  "branch": "<circle cx=\"6\" cy=\"5\" r=\"2\"/><circle cx=\"6\" cy=\"19\" r=\"2\"/><circle cx=\"18\" cy=\"7\" r=\"2\"/><path d=\"M6 7v10\"/><path d=\"M18 9c0 5-6 4-12 8\"/>",
  "terminal": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"m7 9 3 3-3 3M12.5 15H17\"/>",
  "square-x": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/><path d=\"m15 9-6 6\"/><path d=\"m9 9 6 6\"/>",
  "log-out": "<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"/><polyline points=\"16 17 21 12 16 7\"/><line x1=\"21\" x2=\"9\" y1=\"12\" y2=\"12\"/>",
  "power": "<path d=\"M12 2v10\"/><path d=\"M18.4 6.6a9 9 0 1 1-12.77.04\"/>",
  "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/>",
  "file-plus": "<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"/><path d=\"M14 3v5h5M12 11v6M9 14h6\"/>",
  "folder-plus": "<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/><path d=\"M12 10v6M9 13h6\"/>",
  "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>",
  "trash": "<path d=\"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3\"/>",
  "copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"/><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>",
  "clipboard-paste": "<path d=\"M11 14h10\"/><path d=\"M16 4h2a2 2 0 0 1 2 2v1.344\"/><path d=\"m17 18 4-4-4-4\"/><path d=\"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113\"/><rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\"/>",
  "locate-fixed": "<path d=\"M2 12h3\"/><path d=\"M19 12h3\"/><path d=\"M12 2v3\"/><path d=\"M12 19v3\"/><circle cx=\"12\" cy=\"12\" r=\"7\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "eye": "<path d=\"M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "x": "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  "zone-gauche": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path fill=\"currentColor\" stroke=\"none\" d=\"M5 3h7v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\"/>",
  "zone-droite": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path fill=\"currentColor\" stroke=\"none\" d=\"M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7z\"/>",
  "zone-haut": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path fill=\"currentColor\" stroke=\"none\" d=\"M3 12V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7z\"/>",
  "zone-bas": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path fill=\"currentColor\" stroke=\"none\" d=\"M3 12h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>",
  "zone-centre": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" fill=\"currentColor\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "check": "<path d=\"m5 12.5 4.5 4.5L19 7.5\"/>",
  "arrow-down": "<path d=\"M12 5v14M6 13l6 6 6-6\"/>",
  "arrow-up": "<path d=\"M12 19V5M6 11l6-6 6 6\"/>",
  "folder": "<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>",
  "file": "<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"/><path d=\"M14 3v5h5\"/>",
  "file-code": "<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"m10 12-2 2 2 2M14 12l2 2-2 2\"/>",
  "md": "<rect x=\"2.5\" y=\"6\" width=\"19\" height=\"12\" rx=\"2\"/><path d=\"M6 15V9l2.5 3L11 9v6M16 9v6M14 13l2 2 2-2\"/>",
  "minimize-2": "<path d=\"m14 10 7-7\"/><path d=\"M20 10h-6V4\"/><path d=\"m3 21 7-7\"/><path d=\"M4 14h6v6\"/>",
  "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"/><path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\"/><path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\"/>",
  "chevron": "<path d=\"m9 6 6 6-6 6\"/>",
  "chevron-down": "<path d=\"m6 9 6 6 6-6\"/>",
  "chevron-up": "<path d=\"m18 15-6-6-6 6\"/>",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
  "panel-left-close": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/><path d=\"m16 15-3-3 3-3\"/>",
  "panel-left-open": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/><path d=\"m14 9 3 3-3 3\"/>",
  "panel-right-close": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M15 3v18\"/><path d=\"m8 9 3 3-3 3\"/>",
  "panel-bottom-close": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 15h18\"/><path d=\"m15 8-3 3-3-3\"/>",
  "panel-bottom-open": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 15h18\"/><path d=\"m9 10 3-3 3 3\"/>",
  "bot": "<path d=\"M12 8V4H8\"/><rect width=\"16\" height=\"12\" x=\"4\" y=\"8\" rx=\"2\"/><path d=\"M2 14h2\"/><path d=\"M20 14h2\"/><path d=\"M15 13v2\"/><path d=\"M9 13v2\"/>",
  "message-square-plus": "<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/><path d=\"M12 7v6\"/><path d=\"M9 10h6\"/>",
  "messages-square": "<path d=\"M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z\"/><path d=\"M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1\"/>",
  "server": "<rect x=\"2\" y=\"2\" width=\"20\" height=\"8\" rx=\"2\"/><rect x=\"2\" y=\"14\" width=\"20\" height=\"8\" rx=\"2\"/><path d=\"M6 6h.01\"/><path d=\"M6 18h.01\"/>",
  "history": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/><path d=\"M12 7v5l4 2\"/>",
  "send-horizontal": "<path d=\"M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z\"/><path d=\"M6 12h16\"/>",
  "circle-stop": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><rect x=\"9\" y=\"9\" width=\"6\" height=\"6\" rx=\"1\"/>",
  "circle-dashed": "<path d=\"M10.1 2.182a10 10 0 0 1 3.8 0\"/><path d=\"M13.9 21.818a10 10 0 0 1-3.8 0\"/><path d=\"M17.609 3.721a10 10 0 0 1 2.69 2.7\"/><path d=\"M2.182 13.9a10 10 0 0 1 0-3.8\"/><path d=\"M20.279 17.609a10 10 0 0 1-2.7 2.69\"/><path d=\"M21.818 10.1a10 10 0 0 1 0 3.8\"/><path d=\"M3.721 6.391a10 10 0 0 1 2.7-2.69\"/><path d=\"M6.391 20.279a10 10 0 0 1-2.69-2.7\"/>",
  "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m9 12 2 2 4-4\"/>",
  "circle-arrow-up": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m16 12-4-4-4 4\"/><path d=\"M12 16V8\"/>",
  "circle-x": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m15 9-6 6\"/><path d=\"m9 9 6 6\"/>",
  "type": "<path d=\"M12 4v16\"/><path d=\"M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2\"/><path d=\"M9 20h6\"/>",
  "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/>",
  "user-plus": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M19 8v6M22 11h-6\"/>",
  "sliders-horizontal": "<path d=\"M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4\"/>",
  "arrow-left": "<path d=\"m12 19-7-7 7-7\"/><path d=\"M19 12H5\"/>",
  "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"/>",
  "link": "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"/><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"/>",
  "asterisk": "<path d=\"M12 4v16\"/><path d=\"M18.93 8 5.07 16\"/><path d=\"m5.07 8 13.86 8\"/>",
  "code-xml": "<path d=\"m18 16 4-4-4-4\"/><path d=\"m6 8-4 4 4 4\"/><path d=\"m14.5 4-5 16\"/>",
  "circle-minus": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M8 12h8\"/>",
  "brain": "<path d=\"M12 18V5\"/><path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\"/><path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\"/><path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\"/><path d=\"M18 18a4 4 0 0 0 2-7.464\"/><path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\"/><path d=\"M6 18a4 4 0 0 1-2-7.464\"/><path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\"/>",
  "book-open": "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>",
  "book-alert": "<path d=\"M12 13h.01\"/><path d=\"M12 6v3\"/><path d=\"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20\"/>",
  "square-plus": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M8 12h8\"/><path d=\"M12 8v8\"/>",
  "zoom-out": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\"/><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\"/>",
  "zoom-in": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\"/><line x1=\"11\" x2=\"11\" y1=\"8\" y2=\"14\"/><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\"/>",
  "scan": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\"/><path d=\"M17 3h2a2 2 0 0 1 2 2v2\"/><path d=\"M21 17v2a2 2 0 0 1-2 2h-2\"/><path d=\"M7 21H5a2 2 0 0 1-2-2v-2\"/>",
  "bold": "<path d=\"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8\"/>",
  "italic": "<path d=\"M19 4h-9\"/><path d=\"M14 20H5\"/><path d=\"M15 4 9 20\"/>",
  "underline": "<path d=\"M6 4v6a6 6 0 0 0 12 0V4\"/><path d=\"M4 20h16\"/>",
  "strikethrough": "<path d=\"M16 4H9a3 3 0 0 0-2.83 4\"/><path d=\"M14 12a4 4 0 0 1 0 8H6\"/><path d=\"M4 12h16\"/>",
  "heading": "<path d=\"M6 12h12\"/><path d=\"M6 20V4\"/><path d=\"M18 20V4\"/>",
  "code": "<path d=\"m16 18 6-6-6-6\"/><path d=\"m8 6-6 6 6 6\"/>",
  "text-quote": "<path d=\"M17 6H3\"/><path d=\"M21 12H8\"/><path d=\"M21 18H8\"/><path d=\"M3 12v6\"/>",
  "liste-puces": "<circle cx=\"4.5\" cy=\"6\" r=\"1.6\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4.5\" cy=\"12\" r=\"1.6\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4.5\" cy=\"18\" r=\"1.6\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M9 6h12\"/><path d=\"M9 12h12\"/><path d=\"M9 18h12\"/>",
  "list-ordered": "<path d=\"M10 12h11\"/><path d=\"M10 18h11\"/><path d=\"M10 6h11\"/><path d=\"M4 10h2\"/><path d=\"M4 6h1v4\"/><path d=\"M6 18H4c0-1 2-2 2-3s-1-1.5-2-1\"/>",
  "square-code": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"m10 9-3 3 3 3\"/><path d=\"m14 15 3-3-3-3\"/>",
  "table": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M3 15h18\"/><path d=\"M12 3v18\"/>",
  "separator-horizontal": "<path d=\"M3 12h18\"/><path d=\"m8 8 4-4 4 4\"/><path d=\"m16 16-4 4-4-4\"/>",
  "text-align-start": "<path d=\"M21 5H3\"/><path d=\"M15 12H3\"/><path d=\"M17 19H3\"/>",
  "text-align-center": "<path d=\"M21 5H3\"/><path d=\"M17 12H7\"/><path d=\"M19 19H5\"/>",
  "text-align-end": "<path d=\"M21 5H3\"/><path d=\"M21 12H9\"/><path d=\"M21 19H7\"/>",
  "position-haut": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M7.5 7.5h9\"/><path d=\"M9.5 11h5\"/>",
  "position-milieu": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M7.5 10.25h9\"/><path d=\"M9.5 13.75h5\"/>",
  "position-bas": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M7.5 13h9\"/><path d=\"M9.5 16.5h5\"/>",
  "couleur-texte": "<path d=\"m7 15 5-11 5 11\"/><path d=\"M8.8 11h6.4\"/><rect class=\"ya-barre-texte\" x=\"4\" y=\"18\" width=\"16\" height=\"3.5\" rx=\"1\" stroke=\"none\"/>",
  "list": "<path d=\"M3 6h.01\"/><path d=\"M3 12h.01\"/><path d=\"M3 18h.01\"/><path d=\"M8 6h13\"/><path d=\"M8 12h13\"/><path d=\"M8 18h13\"/>",
  "mouse-pointer-2": "<path d=\"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z\"/>",
  "circle": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/>",
  "diamond": "<path d=\"M12 3 21 12 12 21 3 12z\"/>",
  "baseline": "<path d=\"M4 20h16\"/><path d=\"m6 16 6-12 6 12\"/><path d=\"M8 12h8\"/>",
  "workflow": "<rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M7 11v4a2 2 0 0 0 2 2h4\"/><rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\"/>",
  "move-up-right": "<path d=\"M13 5h6v6\"/><path d=\"M19 5 5 19\"/>",
  "forme-rectangle": "<rect x=\"3\" y=\"6\" width=\"18\" height=\"12\" rx=\"1\"/>",
  "forme-arrondi": "<rect x=\"3\" y=\"6\" width=\"18\" height=\"12\" rx=\"5\"/>",
  "forme-note": "<path d=\"M3 5h12l6 6v8H3z\"/><path d=\"M15 5v6h6\"/>",
  "trace-droit": "<path d=\"M6.5 17.5 17.5 6.5\"/><circle cx=\"5\" cy=\"19\" r=\"1.6\"/><circle cx=\"19\" cy=\"5\" r=\"1.6\"/>",
  "trace-coude": "<path d=\"M6.6 19H12V5h5.4\"/><circle cx=\"5\" cy=\"19\" r=\"1.6\"/><circle cx=\"19\" cy=\"5\" r=\"1.6\"/>",
  "trace-courbe": "<path d=\"M6.6 19C14 19 10 5 17.4 5\"/><circle cx=\"5\" cy=\"19\" r=\"1.6\"/><circle cx=\"19\" cy=\"5\" r=\"1.6\"/>",
  "bout-arrivee": "<path d=\"M4 12h15\"/><path d=\"m14 7 5 5-5 5\"/>",
  "bout-aucun": "<path d=\"M6.6 12h10.8\"/><circle cx=\"5\" cy=\"12\" r=\"1.6\"/><circle cx=\"19\" cy=\"12\" r=\"1.6\"/>",
  "bout-depart": "<path d=\"M5 12h15\"/><path d=\"m10 7-5 5 5 5\"/>",
  "bout-deux": "<path d=\"M4 12h16\"/><path d=\"m8 8-4 4 4 4\"/><path d=\"m16 8 4 4-4 4\"/>",
  "trait-plein": "<path d=\"M3 12h18\" stroke-width=\"2\"/>",
  "trait-tirets": "<path d=\"M3 12h4M10 12h4M17 12h4\" stroke-width=\"2\" stroke-linecap=\"butt\"/>",
  "trait-points": "<path d=\"M4 12h.01M8 12h.01M12 12h.01M16 12h.01M20 12h.01\" stroke-width=\"2.6\"/>",
  "inserer-colonne": "<path d=\"M5 4v16\" stroke-width=\"2\"/><path d=\"M19 4v16\" stroke-width=\"2\"/><path d=\"M12 8.5v7\" stroke-width=\"2\"/><path d=\"M8.5 12h7\" stroke-width=\"2\"/>",
  "inserer-ligne": "<path d=\"M4 5h16\" stroke-width=\"2\"/><path d=\"M4 19h16\" stroke-width=\"2\"/><path d=\"M12 8.5v7\" stroke-width=\"2\"/><path d=\"M8.5 12h7\" stroke-width=\"2\"/>",
  "supprimer-colonne": "<path d=\"M5 4v16\" stroke-width=\"2\"/><path d=\"M19 4v16\" stroke-width=\"2\"/><path d=\"M8.5 12h7\" stroke-width=\"2\"/>",
  "supprimer-ligne": "<path d=\"M4 5h16\" stroke-width=\"2\"/><path d=\"M4 19h16\" stroke-width=\"2\"/><path d=\"M8.5 12h7\" stroke-width=\"2\"/>",
  "square-dashed": "<path d=\"M5 3a2 2 0 0 0-2 2\"/><path d=\"M19 3a2 2 0 0 1 2 2\"/><path d=\"M21 19a2 2 0 0 1-2 2\"/><path d=\"M5 21a2 2 0 0 1-2-2\"/><path d=\"M9 3h1\"/><path d=\"M9 21h1\"/><path d=\"M14 3h1\"/><path d=\"M14 21h1\"/><path d=\"M3 9v1\"/><path d=\"M21 9v1\"/><path d=\"M3 14v1\"/><path d=\"M21 14v1\"/>",
  "bring-to-front": "<rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"2\"/><path d=\"M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2\"/><path d=\"M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2\"/>",
  "send-to-back": "<rect x=\"14\" y=\"14\" width=\"8\" height=\"8\" rx=\"2\"/><rect x=\"2\" y=\"2\" width=\"8\" height=\"8\" rx=\"2\"/><path d=\"M7 14v1a2 2 0 0 0 2 2h1\"/><path d=\"M14 7h1a2 2 0 0 1 2 2v1\"/>",
  "opacite-100": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\" fill=\"currentColor\"/>",
  "opacite-75": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".75\"/>",
  "opacite-50": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".5\"/>",
  "opacite-25": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".25\"/>",
  "opacite-0": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\"/>",
  "taille-petit": "<path d=\"m9 19 3-8 3 8\"/><path d=\"M10.1 16.2h3.8\"/>",
  "taille-normal": "<path d=\"m8 19 4-11 4 11\"/><path d=\"M9.5 15h5\"/>",
  "taille-grand": "<path d=\"m7 19 5-14 5 14\"/><path d=\"M8.8 14h6.4\"/>",
  "taille-tres-grand": "<path d=\"m5 21 7-18 7 18\"/><path d=\"M7.3 15h9.4\"/>",
  "epaisseur-fin": "<path d=\"M4 8v8M20 8v8\"/><rect x=\"7\" y=\"11.25\" width=\"10\" height=\"1.5\" rx=\".75\" fill=\"currentColor\" stroke=\"none\"/>",
  "epaisseur-moyen": "<path d=\"M4 8v8M20 8v8\"/><rect x=\"7\" y=\"10.5\" width=\"10\" height=\"3\" rx=\"1\" fill=\"currentColor\" stroke=\"none\"/>",
  "epaisseur-epais": "<path d=\"M4 8v8M20 8v8\"/><rect x=\"7\" y=\"9.5\" width=\"10\" height=\"5\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\"/>",
  "shapes": "<path d=\"M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><circle cx=\"17.5\" cy=\"17.5\" r=\"3.5\"/>",
  "symbole-database": "<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"/><path d=\"M3 5v14a9 3 0 0 0 18 0V5\"/><path d=\"M3 12a9 3 0 0 0 18 0\"/>",
  "symbole-pipe": "<ellipse cx=\"18\" cy=\"12\" rx=\"3\" ry=\"6\"/><path d=\"M18 6H6a3 6 0 0 0 0 12h12\"/>",
  "symbole-person": "<circle cx=\"12\" cy=\"8\" r=\"5\"/><path d=\"M20 21a8 8 0 0 0-16 0\"/>",
  "symbole-people": "<path d=\"M18 21a8 8 0 0 0-16 0\"/><circle cx=\"10\" cy=\"8\" r=\"5\"/><path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\"/>",
  "symbole-secure": "<rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>",
  "symbole-insecure": "<rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 9.9-1\"/>",
  "symbole-check": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m9 12 2 2 4-4\"/>",
  "symbole-failure": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m15 9-6 6M9 9l6 6\"/>",
  "symbole-network": "<rect x=\"16\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"2\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"9\" y=\"2\" width=\"6\" height=\"6\" rx=\"1\"/><path d=\"M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3\"/><path d=\"M12 12V8\"/>",
  "symbole-wifi": "<path d=\"M12 20h.01\"/><path d=\"M2 8.82a15 15 0 0 1 20 0\"/><path d=\"M5 12.86a10 10 0 0 1 14 0\"/><path d=\"M8.5 16.43a5 5 0 0 1 7 0\"/>",
  "symbole-ethernet": "<path d=\"m15 20 3-3h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2l3 3z\"/><path d=\"M6 8v1M10 8v1M14 8v1M18 8v1\"/>",
  "symbole-server": "<rect x=\"2\" y=\"2\" width=\"20\" height=\"8\" rx=\"2\"/><rect x=\"2\" y=\"14\" width=\"20\" height=\"8\" rx=\"2\"/><path d=\"M6 6h.01M6 18h.01\"/>",
  "symbole-cloud": "<path d=\"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z\"/>",
  "symbole-computer": "<rect x=\"2\" y=\"3\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M8 21h8M12 17v4\"/>",
  "symbole-phone": "<rect x=\"5\" y=\"2\" width=\"14\" height=\"20\" rx=\"2\"/><path d=\"M12 18h.01\"/>",
  "symbole-file": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\"/><path d=\"M14 2v4a2 2 0 0 0 2 2h4\"/><path d=\"M10 9H8M16 13H8M16 17H8\"/>",
  "symbole-mail": "<rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/><path d=\"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7\"/>",
  "symbole-settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "symbole-warning": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/><path d=\"M12 9v4M12 17h.01\"/>",
  "symbole-firewall": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M12 9v6M16 15v6M16 3v6M3 15h18M3 9h18M8 15v6M8 3v6\"/>",
  "symbole-disk": "<path d=\"M22 12H2\"/><path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"/><path d=\"M6 16h.01M10 16h.01\"/>",
  "symbole-internet": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"/><path d=\"M2 12h20\"/>",
  "symbole-happy": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M8 14s1.5 2 4 2 4-2 4-2\"/><circle cx=\"9\" cy=\"9.5\" r=\".6\" fill=\"currentColor\"/><circle cx=\"15\" cy=\"9.5\" r=\".6\" fill=\"currentColor\"/>",
  "symbole-neutral": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M8 15h8\"/><circle cx=\"9\" cy=\"9.5\" r=\".6\" fill=\"currentColor\"/><circle cx=\"15\" cy=\"9.5\" r=\".6\" fill=\"currentColor\"/>",
  "symbole-sad": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M16 16.5s-1.5-2-4-2-4 2-4 2\"/><circle cx=\"9\" cy=\"9.5\" r=\".6\" fill=\"currentColor\"/><circle cx=\"15\" cy=\"9.5\" r=\".6\" fill=\"currentColor\"/>",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"9.2\"/><path d=\"M12 16.5v-5\"/><path d=\"M12 7.8h.01\"/>",
  "triangle-alert-plein": "<path class=\"icone-plein\" d=\"M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z\"/><path class=\"icone-marque\" d=\"M12 9.5v4\"/><path class=\"icone-marque\" d=\"M12 17.2h.01\"/>",
  "circle-alert-plein": "<circle class=\"icone-plein\" cx=\"12\" cy=\"12\" r=\"9.6\"/><path class=\"icone-marque\" d=\"M12 7.5v5.2\"/><path class=\"icone-marque\" d=\"M12 16.5h.01\"/>",
  "forme-point": "<circle cx=\"12\" cy=\"12\" r=\"5\" fill=\"currentColor\"/>",
  "forme-barre": "<rect x=\"3\" y=\"10\" width=\"18\" height=\"4\" fill=\"currentColor\" stroke-linejoin=\"miter\"/>",
};

export const NOMS = Object.keys(CHEMINS);

export function icone(nom, taille = 16) {
  if (!Object.hasOwn(CHEMINS, nom)) throw new Error(`icone : nom inconnu « ${nom} »`);
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(taille));
  s.setAttribute("height", String(taille));
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.6");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("data-icone", nom);
  s.innerHTML = CHEMINS[nom];
  return s;
}
