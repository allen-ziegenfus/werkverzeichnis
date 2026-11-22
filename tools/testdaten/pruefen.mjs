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
// In HTML und JS stehen Zeichen wie „&“, Anführungszeichen oder Umlaute oft
// maskiert; die gesuchten Testwerte in katalog.json bestehen darum nur aus
// ASCII ohne & < > " ', sonst fände die Suche sie nicht.
const fundorte = (wert, liste = dateien) => liste.filter(([, t]) => t.includes(wert)).map(([p]) => p);
// Ein Wert, wie er auf der Website stünde (Zahlen werden Text, catalog.ts werteVon); sonst undefined.
const alsText = v => typeof v === "number" ? String(v) : typeof v === "string" && v ? v : undefined;

// --- Was nicht auf die Website darf ---------------------------------------
const geheim = katalog.kuenstler.felder.filter(f => !f.oeffentlich || f.archiviert).map(f => f.schluessel);
const sichtbar = katalog.werke.filter(w => !w.ausgeblendet);
const versteckt = katalog.werke.filter(w => w.ausgeblendet);
pruefe(geheim.length && sichtbar.some(w => geheim.some(f => w[f])), "Testdaten ohne interne oder archivierte Werte; nichts zu prüfen");
for (const w of sichtbar) for (const f of geheim) {
  const v = alsText(w[f]);
  if (!v) continue;
  const wo = fundorte(v);
  pruefe(!wo.length, `${w.InvNr}: ${f} „${v}“ (intern oder archiviert) steht in ${wo.join(", ")}`);
}
pruefe(versteckt.length > 0, "Testdaten ohne ausgeblendetes Werk; nichts zu prüfen");
for (const w of versteckt) {
  for (const wert of [w.Titel, w.Beschreibung].filter(Boolean)) {
    const wo = fundorte(wert);
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
// „Name: “ als ein oder zwei Textknoten (React trennt sie mit <!-- -->).
const stelle = n => seite.search(new RegExp(`>${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:<!-- -->)?:\\s*<`));
const stellen = mitListe.map(stelle);
pruefe(stellen.every((s, i) => s >= 0 && (i === 0 || s > stellen[i - 1])),
  `dist/objekte/ob1: Eigenschaften nicht in der Reihenfolge ${mitListe.join(", ")} (Stellen ${stellen.join(", ")})`);

// Ohne Feldliste: dieselben Daten noch einmal bauen, ohne `felder`.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "testdaten-"));
const ausgabe = path.join(tmp, "ausgabe");
try {
  const { felder: _, ...kuenstler } = katalog.kuenstler;
  // Eingabe und Ausgabe getrennt: Die Suche nach Lecks liest nur die Ausgabe.
  fs.mkdirSync(ausgabe);
  fs.writeFileSync(`${tmp}/katalog.json`, JSON.stringify({ ...katalog, kuenstler }));
  const lauf = spawnSync(process.execPath, ["--no-warnings", "--loader", "ts-node/esm", "src/werkverzeichnis/build_data.ts"], {
    env: { ...process.env, TESTDATEN: `${tmp}/katalog.json`, AUSGABE: ausgabe, STRICT: "1", SITE: process.env.SITE ?? "https://example.org" },
    encoding: "utf8",
  });
  pruefe(lauf.status === 0, `yarn data ohne Feldliste scheiterte:\n${lauf.error?.message ?? lauf.stderr}`);
  if (lauf.status === 0) {
    // Fest, nicht aus STANDARD_FELDER gerechnet: Die Prüfung soll merken, wenn sich die Liste ändert.
    const ohne = eigenschaften(ausgabe), alt = ["Art", "Jahr", "Maße", "Zustand", "Beschreibung", "Standort", "Foto"];
    pruefe(gleich(ohne, alt), `Ohne Feldliste: OB1 ${JSON.stringify(ohne)}, erwartet ${JSON.stringify(alt)} (wie die alte Werkseite)`);
    // Material war auch auf der alten Werkseite intern.
    const daten = texte(ausgabe);
    for (const wert of [OB1.Material, ...versteckt.map(w => w.Titel)].map(alsText).filter(Boolean)) {
      const wo = fundorte(wert, daten);
      pruefe(!wo.length, `Ohne Feldliste: „${wert}“ steht in ${wo.join(", ")}`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (fehler.length) {
  for (const f of fehler) console.error(`✗ ${f}`);
  process.exit(1);
}
console.log("Testdaten: Website geprüft, keine Befunde.");
