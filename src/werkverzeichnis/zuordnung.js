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

const NAMEN = {
  InvNr: ["invnr", "inventarnr", "inventarnummer", "invnummer", "nr", "nummer", "werknr", "werknummer"],
  Titel: ["titel", "title", "werktitel"],
};

/** Die Ziele zur Auswahl: [{ ziel, name }], Inv. Nr. und Titel zuerst. */
export const zieleVon = felder => [
  { ziel: "InvNr", name: "Inv. Nr." },
  { ziel: "Titel", name: "Titel" },
  ...felder.filter(f => !f.archiviert).map(f => ({ ziel: f.schluessel, name: f.name })),
];

/**
 * Vorschlag nach Namen: { [Spaltenindex]: ziel }. Eine Spalte passt zu einem
 * Ziel, wenn ihr Name dem Schlüssel oder dem Namen des Felds entspricht
 * (vergleichbar), bei Inv. Nr. und Titel auch üblichen anderen Namen. Jedes
 * Ziel bekommt nur die erste passende Spalte.
 */
export function vorschlagen(spalten, felder) {
  const ziele = zieleVon(felder);
  const namen = new Map(ziele.map(z => [z.ziel,
    new Set([vergleichbar(z.ziel), vergleichbar(z.name), ...(NAMEN[z.ziel] ?? [])].filter(Boolean))]));
  const vergeben = new Set();
  const ergebnis = {};
  for (const s of spalten) {
    const n = vergleichbar(s.name);
    const z = ziele.find(z => !vergeben.has(z.ziel) && namen.get(z.ziel).has(n));
    ergebnis[s.index] = z?.ziel ?? "";
    if (z) vergeben.add(z.ziel);
  }
  return ergebnis;
}

/** Wert einer Zelle → Werkgruppe (Kennung) oder undefined: nach Titel, Kurztitel oder Kennung. */
export function gruppeFinden(wert, gruppen) {
  const v = vergleichbar(wert);
  if (!v) return undefined;
  return gruppen.find(g => [g.id, g.titel, g.kurztitel].some(x => x && vergleichbar(x) === v))?.id;
}

/**
 * Eine Spalte, deren Werte alle zu Werkgruppen passen (leere ausgenommen),
 * als Vorschlag für „Werkgruppe aus Spalte“; sonst undefined.
 */
export function gruppenSpalteVorschlagen(spalten, daten, gruppen) {
  return spalten.find(s => {
    const werte = daten.map(z => z.werte[spalten.indexOf(s)]).filter(Boolean);
    return werte.length > 0 && werte.every(w => gruppeFinden(w, gruppen));
  })?.index;
}

/** Werte einer Spalte ohne passende Werkgruppe: [{ wert, anzahl }]. */
export function unbekannteGruppen(spalte, spalten, daten, gruppen) {
  const i = spalten.findIndex(s => s.index === spalte);
  const zaehler = new Map();
  for (const z of daten) {
    const w = z.werte[i];
    if (w && !gruppeFinden(w, gruppen)) zaehler.set(w, (zaehler.get(w) ?? 0) + 1);
  }
  return [...zaehler].map(([wert, anzahl]) => ({ wert, anzahl }));
}
