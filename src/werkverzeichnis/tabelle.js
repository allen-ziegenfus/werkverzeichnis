/**
 * Tabellen für den Import (#239, #348): CSV, XLS und XLSX lesen, im Browser.
 * SheetJS (`xlsx`) kommt erst mit `import()`, also nur, wenn jemand eine Datei
 * wählt. Alle Werte sind Text, wie in der Tabelle zu sehen: Gespeichert wird
 * ohnehin Text (catalog.ts), und „0012“ soll nicht zu 12 werden.
 */

/** Größte Datei und meiste Zeilen, die der Import liest. */
export const HOECHSTENS = { bytes: 20 * 1024 * 1024, zeilen: 20_000 };

/** Spaltenbuchstabe wie in Excel: 0 → A, 26 → AA. */
export function buchstabe(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

/**
 * Text einer CSV-Datei: UTF-8, sonst Windows-1252 (so speichert Excel unter
 * Windows „CSV“). Ein BOM am Anfang fällt weg.
 */
export function csvText(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder("windows-1252").decode(bytes); }
  return text.replace(/^﻿/, "");
}

const istCsv = name => /\.(csv|tsv|txt)$/i.test(name);

/**
 * Liest eine Datei (`name`, `bytes` als ArrayBuffer) in Blätter mit Zeilen aus
 * Text: [{ name, zeilen: string[][] }]. Leere Blätter bleiben drin (zum Wählen),
 * mit leeren Zeilen.
 */
export async function blaetterLesen(name, bytes) {
  if (bytes.byteLength > HOECHSTENS.bytes) throw new Error(`Die Datei ist größer als ${HOECHSTENS.bytes / 1024 / 1024} MB.`);
  const XLSX = await import("xlsx");
  // raw: Text in CSV nicht als Zahl oder Datum deuten. Trennzeichen (, ; Tab) erkennt SheetJS.
  const mappe = istCsv(name)
    ? XLSX.read(csvText(bytes), { type: "string", raw: true, dense: true })
    : XLSX.read(bytes, { type: "array", dense: true });
  return mappe.SheetNames.map(n => {
    // raw: false liefert den Text, wie die Zelle ihn zeigt (formatierte Zahlen und Daten).
    const zeilen = XLSX.utils.sheet_to_json(mappe.Sheets[n], { header: 1, raw: false, defval: "", blankrows: true });
    return { name: n, zeilen: zeilen.map(z => z.map(z => String(z ?? "").trim())) };
  });
}

const leer = z => z.every(c => c === "");

/**
 * Die vermutliche Kopfzeile (Index): unter den ersten 20 Zeilen die erste, die
 * mindestens halb so viele Zellen füllt wie die vollste. So zählt ein Titel
 * über der Tabelle („Werkverzeichnis 2024“) nicht als Kopfzeile.
 */
export function kopfzeileRaten(zeilen) {
  const gefuellt = zeilen.slice(0, 20).map(z => z.filter(c => c !== "").length);
  const meiste = Math.max(0, ...gefuellt);
  return Math.max(0, gefuellt.findIndex(n => n > 0 && n >= Math.min(2, meiste) && n * 2 >= meiste));
}

/**
 * Aus den Zeilen eines Blatts und der Kopfzeile (Index): die Spalten
 * [{ index, name }] und die Datenzeilen darunter ohne leere, jede so lang wie
 * die Spalten. Spalten ohne Namen heißen nach ihrem Buchstaben, doppelte Namen
 * bekommen eine Zahl; Spalten ohne Namen und ohne Werte fallen weg.
 * `nr` an jeder Zeile ist die Zeilennummer in der Tabelle (ab 1), für Meldungen.
 */
export function tabelle(zeilen, kopf) {
  const kopfzeile = zeilen[kopf] ?? [];
  const darunter = zeilen.slice(kopf + 1).map((werte, i) => ({ nr: kopf + 2 + i, werte })).filter(z => !leer(z.werte));
  if (darunter.length > HOECHSTENS.zeilen) throw new Error(`Mehr als ${HOECHSTENS.zeilen} Zeilen; bitte aufteilen.`);
  const breite = Math.max(kopfzeile.length, ...darunter.map(z => z.werte.length), 0);
  const vergeben = new Map();
  const spalten = [];
  for (let i = 0; i < breite; i++) {
    const titel = kopfzeile[i] ?? "";
    if (!titel && darunter.every(z => !z.werte[i])) continue;
    let name = titel || `Spalte ${buchstabe(i)}`;
    const n = (vergeben.get(name) ?? 0) + 1;
    vergeben.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    spalten.push({ index: i, name });
  }
  return { spalten, daten: darunter.map(z => ({ nr: z.nr, werte: spalten.map(s => z.werte[s.index] ?? "") })) };
}
