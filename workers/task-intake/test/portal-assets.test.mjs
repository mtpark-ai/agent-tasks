import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const OFFICIAL_SHORTCUT_URL =
  "https://www.icloud.com/shortcuts/5005bf386b2447ca855aec7ecb67fd15";

test("portal ships a local QR installer for the official Shortcut", async () => {
  const [script, stylesheet, svg, wrangler] = await Promise.all([
    readFile("public/pat-guide.js", "utf8"),
    readFile("public/shortcut-qr.css", "utf8"),
    readFile("public/shortcut-qr.svg", "utf8"),
    readFile("wrangler.jsonc", "utf8"),
  ]);

  const config = JSON.parse(wrangler);
  assert.equal(config.vars.SHORTCUT_URL, OFFICIAL_SHORTCUT_URL);
  assert.match(script, /shortcut-qr\.svg/);
  assert.ok(script.includes(OFFICIAL_SHORTCUT_URL));
  assert.match(stylesheet, /\.shortcut-qr-figure/);
  assert.match(svg, /<svg\b/);
  assert.match(svg, /id="qr-path"/);
  assert.ok(svg.includes(`Encodes: ${OFFICIAL_SHORTCUT_URL}`));
  assert.doesNotMatch(script, /api\.qrserver|quickchart|chart\.google/i);
});
