/**
 * Tabellen für den Import (#239, #348): CSV, XLS und XLSX lesen, im Browser.
 * SheetJS (`xlsx`) kommt erst mit `import()`, also nur, wenn jemand eine Datei
 * wählt. Alle Werte sind Text, wie in der Tabelle zu sehen: Gespeichert wird
 * ohnehin Text (catalog.ts), und „0012“ soll nicht zu 12 werden.
 */

/** Größte Datei, meiste Zeilen und Spalten, die der Import liest. */
export const HOECHSTENS = { bytes: 20 * 1024 * 1024, zeilen: 20_000, spalten: 200 };

/** Vor dem Einlesen: zu große Dateien gar nicht erst in den Speicher holen. */
export const zuGross = bytes => bytes > HOECHSTENS.bytes
  ? `Die Datei ist größer als ${HOECHSTENS.bytes / 1024 / 1024} MB.` : undefined;

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

const istCsv = name => /\.csv$/i.test(name);

/**
 * Liest eine Datei (`name`, `bytes` als ArrayBuffer) in Blätter mit Zeilen aus
 * Text: [{ name, zeilen: string[][] }]. Leere Blätter bleiben drin (zum Wählen),
 * mit leeren Zeilen.
 */
export async function blaetterLesen(name, bytes) {
  const zuviel = zuGross(bytes.byteLength);
  if (zuviel) throw new Error(zuviel);
  const XLSX = await import("xlsx");
  // sheetRows: Formatierte leere Zeilen (bis 1048576) nicht alle einlesen; etwas
  // Luft für Zeilen über der Kopfzeile, tabelle() meldet, wenn es zu viele sind.
  const optionen = { dense: true, sheetRows: HOECHSTENS.zeilen + 21 };
  // raw: Text in CSV nicht als Zahl oder Datum deuten. Trennzeichen (, ; Tab) erkennt SheetJS.
  const mappe = istCsv(name)
    ? XLSX.read(csvText(bytes), { ...optionen, type: "string", raw: true })
    : XLSX.read(bytes, { ...optionen, type: "array", dateNF: "dd\\.mm\\.yyyy" });   // Daten im Standardformat deutsch; Punkte maskiert, sonst Sekundenbruchteil
  return mappe.SheetNames.map(n => {
    const blatt = mappe.Sheets[n];
    // Ebenso Spalten: Ein formatierter Bereich bis XFD wären 16384 je Zeile.
    let abgeschnitten = false;
    if (blatt["!ref"]) {
      const bereich = XLSX.utils.decode_range(blatt["!ref"]);
      if (bereich.e.c - bereich.s.c >= HOECHSTENS.spalten) {
        bereich.e.c = bereich.s.c + HOECHSTENS.spalten - 1;
        blatt["!ref"] = XLSX.utils.encode_range(bereich);
        abgeschnitten = true;
      }
    }
    // raw: false liefert den Text, wie die Zelle ihn zeigt.
    const zeilen = XLSX.utils.sheet_to_json(blatt, { header: 1, raw: false, defval: "", blankrows: true });
    const text = zeilen.map(z => z.map(z => String(z ?? "").trim()));
    // sheetRows schneidet ohne Fehler ab; !fullref ist dann der Bereich laut
    // Datei. Der kann auch nur formatierte leere Zellen umfassen. Zu lang, wenn
    // der Inhalt bis an die Grenze reicht; sonst warnen, dass danach nichts
    // gelesen ist (dort kann noch etwas stehen, nach einer Lücke).
    const grenze = optionen.sheetRows - 1;   // sheetRows zählt eins mehr, als es liefert
    const bis = blatt["!fullref"] ? XLSX.utils.decode_range(blatt["!fullref"]).e.r + 1 : 0;
    const zeilenAus = bis <= text.length ? undefined : text.length >= grenze - 100 ? "zu lang" : "ende";
    return { name: n, abgeschnitten, zeilenAus, gelesen: text.length, bis, zeilen: text };
  });
}

const leer = z => z.every(c => c === "");

/**
 * Die vermutliche Kopfzeile (Index): unter den ersten 20 nicht leeren Zeilen die erste, die
 * mindestens halb so viele Zellen füllt wie die vollste. So zählt ein Titel
 * über der Tabelle („Werkverzeichnis 2024“) nicht als Kopfzeile.
 */
export function kopfzeileRaten(zeilen) {
  const gefuellt = zeilen.map((z, i) => ({ i, n: z.filter(c => c !== "").length })).filter(x => x.n > 0).slice(0, 20);
  const meiste = Math.max(0, ...gefuellt.map(x => x.n));
  return gefuellt.find(x => x.n >= Math.min(2, meiste) && x.n * 2 >= meiste)?.i ?? 0;
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
  // Erst die echten Namen, damit „Spalte B“ oder „Titel (2)“ aus der Datei Vorrang haben.
  const vergeben = new Set(kopfzeile.filter(Boolean));
  const gesehen = new Set();
  const spalten = [];
  for (let i = 0; i < breite; i++) {
    const titel = kopfzeile[i] ?? "";
    if (!titel && darunter.every(z => !z.werte[i])) continue;
    let name = titel;
    if (!name || gesehen.has(name)) {
      const basis = titel || `Spalte ${buchstabe(i)}`;
      name = basis;
      for (let n = 2; vergeben.has(name) || gesehen.has(name); n++) name = `${basis} (${n})`;
    }
    gesehen.add(name); vergeben.add(name);
    spalten.push({ index: i, name });
  }
  return { spalten, daten: darunter.map(z => ({ nr: z.nr, werte: spalten.map(s => z.werte[s.index] ?? "") })) };
}
