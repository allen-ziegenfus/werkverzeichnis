/**
 * Die Felder der Werke je Künstler:in (#255), im Künstler-Dokument unter
 * `felder`, bearbeitet in den Einstellungen (#256). Ohne gespeicherte Liste
 * gelten STANDARD_FELDER, die Felder von vor #255.
 *
 * Ein Feld: { schluessel, name, lang, oeffentlich, archiviert }. Der Schlüssel
 * ist der Name des Werte-Felds am Werk und bleibt beim Umbenennen gleich.
 * Archivierte Felder verschwinden aus Formular und Website, ihre Werte bleiben
 * am Werk. Inv. Nr. und Titel stehen nicht in der Liste: Sie sind immer da.
 */

const feld = (schluessel, name, { lang = false, oeffentlich = true } = {}) =>
  ({ schluessel, name, lang, oeffentlich, archiviert: false });

// Reihenfolge wie bisher im Editor; „Werkgruppe“ ist der Freitext „Art“ (#189).
export const STANDARD_FELDER = [
  feld("Werkgruppe", "Art"),
  feld("Jahr", "Jahr"),
  feld("Maße", "Maße"),
  // Steht im JSON der Seite, aber nicht auf der Werkseite.
  feld("Material", "Material", { lang: true, oeffentlich: false }),
  feld("Technik", "Technik"),
  feld("Beschreibung", "Beschreibung", { lang: true }),
  feld("Zustand", "Zustand"),
  feld("Standort", "Standort"),
  feld("Signatur", "Signatur"),
  feld("Auflage", "Auflage"),
  feld("Anzahl", "Anzahl"),
  feld("Foto", "Foto"),
  feld("Ausstellung", "Ausstellung", { lang: true }),
  feld("Literatur", "Literatur", { lang: true }),
  feld("Bibliographie", "Bibliographie", { lang: true }),
];

/** Höchstens so viele Felder; dieselbe Grenze steht in firestore.rules. */
export const HOECHSTENS_FELDER = 100;

// Namen am Werk-Dokument, die verwaltet werden oder fest sind, und die festen
// Schlüssel im JSON der Website (build_data.ts); kein Feld darf so heißen.
const VERGEBEN = ["InvNr", "Titel", "werkgruppe", "images", "updatedAt", "lastChange", "ausgeblendet", "slug",
  "InventoryNumber", "Slug", "WerkgruppeSlug", "Art", "Bilder", "Thumbnail", "Eigenschaften"];

/** Ist `d` eine brauchbare Feldliste? */
export function gueltigeFelder(d) {
  if (!Array.isArray(d) || d.length > HOECHSTENS_FELDER) return false;
  const schluessel = d.map(f => f?.schluessel);
  return d.every(f => f && typeof f.schluessel === "string" && /^\p{L}[\p{L}\p{N}]*$/u.test(f.schluessel)
      && !VERGEBEN.includes(f.schluessel) && typeof f.name === "string" && f.name.trim() !== ""
      && typeof f.lang === "boolean" && typeof f.oeffentlich === "boolean" && typeof f.archiviert === "boolean")
    && new Set(schluessel).size === schluessel.length;
}

/** Die Felder aus dem Künstler-Dokument, ohne (brauchbare) Liste die Standardfelder. */
export const felderVon = kuenstler => gueltigeFelder(kuenstler?.felder) ? kuenstler.felder : STANDARD_FELDER;

/**
 * Schlüssel für ein neues Feld aus seinem Namen: nur Buchstaben und Ziffern,
 * vorn ein Buchstabe; schon vergebene (auch archivierte) bekommen eine Zahl an.
 */
export function neuerSchluessel(name, felder) {
  const basis = name.normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "").replace(/^\p{N}+/u, "") || "Feld";
  const belegt = new Set([...VERGEBEN, ...felder.map(f => f.schluessel)]);
  let s = basis;
  for (let i = 2; belegt.has(s); i++) s = basis + i;
  return s;
}
