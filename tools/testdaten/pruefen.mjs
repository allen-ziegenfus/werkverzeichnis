/**
 * Prüft die Website aus den Testdaten (#322), nach
 *
 *   TESTDATEN=tools/testdaten/katalog.json SITE=https://example.org yarn data
 *   SITE=https://example.org npx astro build
 *   node tools/testdaten/pruefen.mjs
 *
 * Ohne Zugangsdaten, lokal und im PR (.github/workflows/pruefen.yml):
 *   - Interne und archivierte Werte und ausgeblendete Werke stehen in keiner
 *     Datei unter public/ und dist/ (#258, #181).
 *   - Die Werkseite von OB1 zeigt die Eigenschaften in der Reihenfolge der
 *     Feldliste, mit deren Namen; ohne Feldliste wie die alte Werkseite
 *     (STANDARD_FELDER). Dafür baut es die Daten ein zweites Mal, ohne `felder`,
 *     in ein eigenes Verzeichnis.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STANDARD_FELDER } from "../../src/werkverzeichnis/felder.js";

const KATALOG = "tools/testdaten/katalog.json";
const katalog = JSON.parse(fs.readFileSync(KATALOG, "utf8"));
const fehler = [];
const pruefe = (ok, text) => { if (!ok) fehler.push(text); };

// Alle Textdateien unter einem Verzeichnis: [Pfad, Inhalt].
function texte(wurzel) {
  return fs.readdirSync(wurzel, { recursive: true })
    .map(d => path.join(wurzel, d))
    .filter(p => /\.(json|html|js|xml|txt)$/.test(p) && fs.statSync(p).isFile())
    .map(p => [p, fs.readFileSync(p, "utf8")]);
}
const dateien = [...texte("public"), ...texte("dist")];
// In HTML stehen Zeichen wie „&“ oder Anführungszeichen maskiert; die Testwerte vermeiden sie.
const fundorte = (wert, liste = dateien) => liste.filter(([, t]) => t.includes(wert)).map(([p]) => p);
// Ohne den Code der Verwaltung (dist/_astro): Dort steht etwa „Ausgeblendet“ als Text der Oberfläche.
const ohneCode = dateien.filter(([p]) => !p.startsWith(path.join("dist", "_astro")));

// --- Was nicht auf die Website darf ---------------------------------------
const geheim = katalog.kuenstler.felder.filter(f => !f.oeffentlich || f.archiviert).map(f => f.schluessel);
const sichtbar = katalog.werke.filter(w => !w.ausgeblendet);
const versteckt = katalog.werke.filter(w => w.ausgeblendet);
pruefe(geheim.length && sichtbar.some(w => geheim.some(f => w[f])), "Testdaten ohne interne oder archivierte Werte; nichts zu prüfen");
for (const w of sichtbar) for (const f of geheim) {
  if (typeof w[f] !== "string" || !w[f]) continue;
  const wo = fundorte(w[f]);
  pruefe(!wo.length, `${w.InvNr}: ${f} „${w[f]}“ (intern oder archiviert) steht in ${wo.join(", ")}`);
}
pruefe(versteckt.length > 0, "Testdaten ohne ausgeblendetes Werk; nichts zu prüfen");
for (const w of versteckt) {
  for (const wert of [w.Titel, w.Beschreibung].filter(Boolean)) {
    const wo = fundorte(wert, ohneCode);
    pruefe(!wo.length, `${w.InvNr} (ausgeblendet): „${wert}“ steht in ${wo.join(", ")}`);
  }
  pruefe(!fs.existsSync(`dist/${w.werkgruppe}/${w.slug}`), `${w.InvNr} (ausgeblendet) hat eine Seite`);
  for (const f of ["searchData.json", "searchMetadata.json", "werkgruppen.json"]) {
    const t = fs.readFileSync(`public/${f}`, "utf8");
    pruefe(!t.includes(`"${w.slug}"`) && !t.includes(`"${w.InvNr}"`), `${w.InvNr} (ausgeblendet) steht in public/${f}`);
  }
}
for (const w of sichtbar) pruefe(fs.existsSync(`dist/${w.werkgruppe}/${w.slug}/index.html`), `${w.InvNr} hat keine Seite`);

// --- Eigenschaften in der Reihenfolge der Feldliste --------------------------
const OB1 = katalog.werke.find(w => w.slug === "ob1");
// Erwartet: öffentliche, nicht archivierte Felder der Liste, die OB1 hat, mit ihrem Namen.
const erwartet = felder => felder.filter(f => f.oeffentlich && !f.archiviert && OB1[f.schluessel]).map(f => f.name);
const eigenschaften = ausgabe => JSON.parse(fs.readFileSync(`${ausgabe}/werkgruppen.json`, "utf8"))
  .flatMap(g => g.Records).find(w => w.Slug === "ob1")?.Eigenschaften.map(e => e.Name);
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const mitListe = erwartet(katalog.kuenstler.felder);
pruefe(mitListe.includes("Erhaltung") && mitListe.includes("Provenienz"), "Testdaten: OB1 ohne „Erhaltung“ oder „Provenienz“");
const daten = eigenschaften("public");
pruefe(gleich(daten, mitListe), `OB1 in werkgruppen.json: ${JSON.stringify(daten)}, erwartet ${JSON.stringify(mitListe)}`);
// Auf der Seite selbst: Namen in dieser Reihenfolge.
const html = fs.readFileSync("dist/objekte/ob1/index.html", "utf8");
const seite = html.slice(html.indexOf("Eigenschaften"));
const stellen = mitListe.map(n => seite.indexOf(`>${n}<`));
pruefe(stellen.every((s, i) => s >= 0 && (i === 0 || s > stellen[i - 1])),
  `dist/objekte/ob1: Eigenschaften nicht in der Reihenfolge ${mitListe.join(", ")} (Stellen ${stellen.join(", ")})`);

// Ohne Feldliste: dieselben Daten noch einmal bauen, ohne `felder`.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "testdaten-"));
try {
  const { felder: _, ...kuenstler } = katalog.kuenstler;
  fs.writeFileSync(`${tmp}/katalog.json`, JSON.stringify({ ...katalog, kuenstler }));
  const lauf = spawnSync(process.execPath, ["--no-warnings", "--loader", "ts-node/esm", "src/werkverzeichnis/build_data.ts"], {
    env: { ...process.env, TESTDATEN: `${tmp}/katalog.json`, AUSGABE: tmp, SITE: process.env.SITE ?? "https://example.org" },
    encoding: "utf8",
  });
  pruefe(lauf.status === 0, `yarn data ohne Feldliste scheiterte:\n${lauf.stderr}`);
  if (lauf.status === 0) {
    const ohne = eigenschaften(tmp), alt = erwartet(STANDARD_FELDER);
    pruefe(gleich(ohne, alt), `Ohne Feldliste: OB1 ${JSON.stringify(ohne)}, erwartet ${JSON.stringify(alt)}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (fehler.length) {
  for (const f of fehler) console.error(`✗ ${f}`);
  process.exit(1);
}
console.log("Testdaten: Website geprüft, keine Befunde.");
