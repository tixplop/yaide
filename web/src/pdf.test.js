import { afterEach, expect, test, vi } from "vitest";

vi.mock("pdfmake/build/pdfmake.js", () => ({
  default: {
    addFontContainer: vi.fn(),
    setUrlAccessPolicy: vi.fn(),
    sharedVirtualfs: { writeFileSync: vi.fn() },
    addFonts: vi.fn(),
  },
}));
vi.mock("pdfmake/build/standard-fonts/Helvetica.js", () => ({ default: {} }));

afterEach(() => vi.unstubAllGlobals());

test("REQ177_AC15_fetch_de_police_rejete_donne_connexion_perdue", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  await import("./pdf.js");
  await expect(
    window.yaidePdf.produire({ content: [] }, "notes.md"),
  ).rejects.toThrow("connexion perdue");
});
