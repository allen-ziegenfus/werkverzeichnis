/**
 * Prüfen vor dem Schreiben (#239, #350): was der Import mit jedem Werk täte.
 * Rein, ohne Firestore: Die Werke aus den Zeilen (werkAusZeile) gegen die
 * vorhandenen. Leere Zellen überschreiben nichts.
 */
import { slugify } from "./slugify";

// Erlaubte neue Inv. Nr. wie in den Regeln (auch im Werk-Editor): Kennung = Inv. Nr. klein, passend
// zu slugify (catalog.ts); Bindestriche nur einzeln und innen, slugify fasst sie sonst zusammen oder kürzt sie.
export const INVNR_MUSTER = /^[A-Za-z0-9.]+(-[A-Za-z0-9.]+)*$/;

/** Kennung eines Werks zur Inv. Nr., wie catalog.ts sie prüft. */
export const kennung = invNr => slugify(invNr, { lower: true });

const text = v => v == null ? "" : String(v);
/** Ein Feld des Dokuments, nur eigene Eigenschaften: Ein Feld darf „constructor“ heißen. */
export const feldWert = (daten, f) => Object.hasOwn(daten, f) ? daten[f] ?? null : null;

/**
 * `werke` aus werkAusZeile, `vorhanden` = Map Kennung → { data, stand }
 * (stand: updatedAt in ms, zum Erkennen fremder Änderungen beim Schreiben).
 * Ein vorhandenes Werk muss in der Werkgruppe der Zeile stehen (fest oder aus
 * der Spalte; eine leere Zelle lässt sie, wie sie ist).
 * `titel`: Kennung der Werkgruppe → Titel, für Meldungen.
 * Ergebnis: { neu, geaendert, gleich, fehler }, je eine Liste von
 * { nr, id, InvNr, ... }:
 *   neu:       werkgruppe, felder { Feld: Text } (ohne leere)
 *   geaendert: stand, aenderungen { Feld: { von, zu } }, ausgeblendet
 *   gleich:    –
 *   fehler:    text
 */
export function pruefen(werke, vorhanden, { titel = id => id } = {}) {
  const ergebnis = { neu: [], geaendert: [], gleich: [], fehler: [] };
  // Altbestand, dessen Kennung nicht zur Inv. Nr. passt (catalog.ts meldet ihn): sonst entstünde ein zweites Werk.
  const nachInvNr = new Map([...vorhanden].map(([id, d]) => [text(d.data.InvNr).trim().toLowerCase(), id]));
  // Doppelte erst zählen: Alle Zeilen mit derselben Kennung sind Fehler, nicht nur die späteren.
  const zeilenJe = new Map();
  for (const w of werke) {
    const id = w.InvNr.trim() && kennung(w.InvNr.trim());
    if (id) zeilenJe.set(id, [...(zeilenJe.get(id) ?? []), w.nr]);
  }
  for (const w of werke) {
    const InvNr = w.InvNr.trim();
    const id = InvNr && kennung(InvNr);
    const fehler = t => ergebnis.fehler.push({ nr: w.nr, id, InvNr, text: t });
    if (!InvNr) { fehler("Ohne Inv. Nr."); continue; }
    if (InvNr.length > 100) { fehler("Inv. Nr. länger als 100 Zeichen."); continue; }
    // „.“ und „..“ sind als Kennung in Firestore nicht erlaubt.
    if (!id || id === "." || id === "..") { fehler("Aus dieser Inv. Nr. ergibt sich keine Kennung."); continue; }
    const zeilen = zeilenJe.get(id);
    if (zeilen.length > 1) {
      // Höchstens 10 Zeilennummern: Bei Tausenden Doppelten wäre jede Meldung sonst riesig.
      fehler(`Dieselbe Inv. Nr. in den Zeilen ${zeilen.slice(0, 10).join(", ")}${zeilen.length > 10 ? ` und ${zeilen.length - 10} weiteren` : ""}.`);
      continue;
    }
    const anders = nachInvNr.get(InvNr.toLowerCase());
    if (anders !== undefined && anders !== id) { fehler(`Diese Inv. Nr. hat schon das Werk mit der Kennung „${anders}“.`); continue; }
    if (w.gruppeWert && !w.werkgruppe) { fehler(`Keine Werkgruppe „${w.gruppeWert}“, oder sie passt zu mehreren.`); continue; }
    const felder = Object.fromEntries(Object.entries(w.werte).map(([f, v]) => [f, text(v).trim()]).filter(([, v]) => v));
    const da = vorhanden.get(id);
    if (!da) {
      if (!INVNR_MUSTER.test(InvNr)) { fehler("Für ein neues Werk nur Buchstaben, Ziffern, Punkt und einzelne Bindestriche (nicht am Anfang oder Ende)."); continue; }
      if (!w.werkgruppe) { fehler("Keine Werkgruppe für das neue Werk."); continue; }
      ergebnis.neu.push({ nr: w.nr, id, InvNr, werkgruppe: w.werkgruppe, felder });
      continue;
    }
    // Gleiche Kennung, andere Schreibweise („OB-1“ zu „OB 1“): wohl nicht dasselbe Werk.
    if (text(da.data.InvNr).toLowerCase() !== InvNr.toLowerCase()) {
      fehler(`Im Werkverzeichnis steht dazu die Inv. Nr. „${text(da.data.InvNr)}“.`);
      continue;
    }
    if (w.werkgruppe && w.werkgruppe !== da.data.werkgruppe) {
      fehler(`Das Werk steht in der Werkgruppe „${titel(da.data.werkgruppe)}“, nicht „${titel(w.werkgruppe)}“.`);
      continue;
    }
    const aenderungen = Object.fromEntries(Object.entries(felder)
      .filter(([f, v]) => text(feldWert(da.data, f)).trim() !== v)
      .map(([f, v]) => [f, { von: feldWert(da.data, f), zu: v }]));
    if (Object.keys(aenderungen).length) {
      ergebnis.geaendert.push({ nr: w.nr, id, InvNr: da.data.InvNr, stand: da.stand, aenderungen, ausgeblendet: !!da.data.ausgeblendet });
    } else {
      ergebnis.gleich.push({ nr: w.nr, id, InvNr: da.data.InvNr });
    }
  }
  return ergebnis;
}

/** In Stapel zu je `n` teilen (Grenzen der Regeln je Schreibvorgang). */
export const stapeln = (liste, n) => Array.from({ length: Math.ceil(liste.length / n) }, (_, i) => liste.slice(i * n, i * n + n));
