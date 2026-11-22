/**
 * Zuordnung der Spalten einer Tabelle zu den Feldern der Werke (#239, #349).
 * Ziele: "InvNr", "Titel", der Schlüssel eines nicht archivierten Felds der
 * Feldliste, oder "" (nicht übernehmen). Jedes Ziel höchstens einmal.
 * Die Werkgruppe auf der Website ist kein Feld: Sie gilt für den ganzen Import
 * oder kommt aus einer Spalte (Titel, Kurztitel oder Kennung der Werkgruppe).
 */

/** Zum Vergleichen von Namen: klein, ohne Akzente, nur Buchstaben und Ziffern. */
export const vergleichbar = s => String(s ?? "").toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// Übliche andere Namen; „Nr.“ und „Nummer“ zuletzt und schwächer (oft eine laufende Nummer).
const NAMEN = {
  InvNr: ["invnr", "inventarnr", "inventarnummer", "invnummer", "werknr", "werknummer"],
  Titel: ["titel", "title", "werktitel"],
};
const SCHWACH = { InvNr: ["nr", "nummer"] };
// Nur eigene Einträge: Ein Feld darf „constructor“ oder „toString“ heißen.
const eigene = (liste, ziel) => Object.hasOwn(liste, ziel) ? liste[ziel] : [];

/** Die Ziele zur Auswahl: [{ ziel, name }], Inv. Nr. und Titel zuerst. */
export const zieleVon = felder => [
  { ziel: "InvNr", name: "Inv. Nr." },
  { ziel: "Titel", name: "Titel" },
  ...felder.filter(f => !f.archiviert).map(f => ({ ziel: f.schluessel, name: f.name })),
];

/**
 * Vorschlag nach Namen: { [Spaltenindex]: ziel }. Erst genaue Treffer (Name
 * der Spalte = Schlüssel oder Name des Felds, vergleichbar), dann für noch
 * freie Ziele übliche andere Namen, zuletzt schwache (eine laufende „Nr.“ links soll „Inv.-Nr.“
 * rechts nicht verdrängen). Jedes Ziel bekommt nur die erste passende Spalte.
 */
export function vorschlagen(spalten, felder) {
  const ziele = zieleVon(felder);
  const genau = new Map(ziele.map(z => [z.ziel, new Set([vergleichbar(z.ziel), vergleichbar(z.name)].filter(Boolean))]));
  const vergeben = new Set();
  const ergebnis = Object.fromEntries(spalten.map(s => [s.index, ""]));
  for (const passt of [z => genau.get(z.ziel), z => new Set(eigene(NAMEN, z.ziel)), z => new Set(eigene(SCHWACH, z.ziel))]) {
    for (const s of spalten) {
      if (ergebnis[s.index]) continue;
      const n = vergleichbar(s.name);
      const z = ziele.find(z => !vergeben.has(z.ziel) && passt(z).has(n));
      if (z) { ergebnis[s.index] = z.ziel; vergeben.add(z.ziel); }
    }
  }
  return ergebnis;
}

/**
 * Zum Finden der Werkgruppe einer Zelle: Funktion Wert → Kennung oder
 * undefined, nach Kennung, dann Titel, dann Kurztitel (vergleichbar). Passt
 * ein Titel oder Kurztitel zu mehreren Werkgruppen, gilt er als unbekannt,
 * statt still die erste zu nehmen.
 */
export function gruppenFinder(gruppen) {
  const nach = new Map();
  for (const art of ["id", "titel", "kurztitel"]) {
    const stufe = new Map();
    for (const g of gruppen) {
      const v = vergleichbar(g[art]);
      if (v && !nach.has(v)) stufe.set(v, stufe.has(v) && stufe.get(v) !== g.id ? null : g.id);
    }
    for (const [v, id] of stufe) nach.set(v, id);
  }
  return wert => nach.get(vergleichbar(wert)) ?? undefined;
}

/**
 * Eine Spalte, deren Werte alle zu Werkgruppen passen (leere ausgenommen),
 * als Vorschlag für „Werkgruppe aus Spalte“ (Spaltenindex); sonst undefined.
 */
export function gruppenSpalteVorschlagen(spalten, daten, gruppen) {
  const finden = gruppenFinder(gruppen);
  return spalten.find((s, i) => {
    const werte = daten.map(z => z.werte[i]).filter(Boolean);
    return werte.length > 0 && werte.every(finden);
  })?.index;
}

/** Werte einer Spalte (Spaltenindex) ohne passende Werkgruppe: [{ wert, anzahl }]. */
export function unbekannteGruppen(spalte, spalten, daten, gruppen) {
  const i = spalten.findIndex(s => s.index === spalte);
  if (i < 0) return [];
  const finden = gruppenFinder(gruppen);
  const zaehler = new Map();
  for (const z of daten) {
    const w = z.werte[i];
    if (w && !finden(w)) zaehler.set(w, (zaehler.get(w) ?? 0) + 1);
  }
  return [...zaehler].map(([wert, anzahl]) => ({ wert, anzahl }));
}

/**
 * Die Zuordnung, bereinigt gegen den heutigen Stand: Ziele, die es nicht mehr
 * gibt (archiviertes Feld), werden „nicht übernehmen“; eine feste Werkgruppe,
 * die es nicht mehr gibt, und eine Spalte, die die Tabelle nicht hat, leer.
 * `zuordnung` = { ziele: { [Spaltenindex]: ziel }, gruppe: { art: "fest" | "spalte", fest, spalte } }
 * mit `fest` = Kennung und `spalte` = Spaltenindex als Zahl oder "".
 */
export function bereinigen(zuordnung, t, felder, gruppen) {
  const gueltig = new Set(zieleVon(felder).map(z => z.ziel));
  const { art, fest, spalte } = zuordnung.gruppe;
  return {
    ziele: Object.fromEntries(t.spalten.map(s => [s.index, gueltig.has(zuordnung.ziele[s.index]) ? zuordnung.ziele[s.index] : ""])),
    gruppe: {
      art,
      fest: gruppen.some(g => g.id === fest) ? fest : "",
      spalte: t.spalten.some(s => s.index === spalte) ? spalte : "",
    },
  };
}

/** Was noch fehlt, bevor sich importieren lässt: [Text], leer wenn bereit. */
export function fehlt(zuordnung) {
  const f = [];
  if (!Object.values(zuordnung.ziele).includes("InvNr")) f.push("Ohne eine Spalte für die Inv. Nr. lässt sich nicht importieren.");
  const { art, fest, spalte } = zuordnung.gruppe;
  if (art === "fest" && !fest) f.push("Bitte eine Werkgruppe wählen.");
  if (art === "spalte" && spalte === "") f.push("Bitte die Spalte mit der Werkgruppe wählen.");
  return f;
}

/**
 * Ein Werk aus einer Zeile (für #350): { nr, InvNr, werte: { ziel: Text },
 * werkgruppe, gruppeWert }. `werte` sind Felder des Werk-Dokuments wie im Editor, Titel
 * eingeschlossen; alle zugeordneten Zellen außer Inv. Nr., auch leere
 * (was leer überschreibt nichts, entscheidet das Schreiben). `werkgruppe` ist
 * die Kennung oder undefined (unbekannt oder leer), `gruppeWert` die Zelle
 * dazu (leer bei fester Werkgruppe). `finden` aus gruppenFinder.
 */
export function werkAusZeile(zeile, zuordnung, t, finden) {
  const werte = {};
  let InvNr = "";
  t.spalten.forEach((s, i) => {
    const ziel = zuordnung.ziele[s.index];
    if (ziel === "InvNr") InvNr = zeile.werte[i];
    else if (ziel) werte[ziel] = zeile.werte[i];
  });
  const { art, fest, spalte } = zuordnung.gruppe;
  const gruppeWert = art === "fest" ? "" : zeile.werte[t.spalten.findIndex(s => s.index === spalte)] ?? "";
  const werkgruppe = art === "fest" ? fest || undefined : finden(gruppeWert);
  return { nr: zeile.nr, InvNr, werte, werkgruppe, gruppeWert };
}
