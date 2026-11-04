import { expect, test } from "vitest";
import { titre } from "./main.js";

test("REQ029_socle_le_titre_est_yaide", () => {
  expect(titre()).toBe("yaide");
});
