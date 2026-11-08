/**
 * Datenmigrationen (#261): Schritte in gcf/migrationen/NNN-name.js, je Seite der
 * Reihe nach einmal ausgeführt. Der Stand steht in artists/<k>/intern/schema:
 * { version, schritte: [{ nr, name, am, sekunden, ergebnis }] }.
 *
 * Ein Schritt exportiert `ausfuehren({ db, kuenstlerDok, bucket, log })` und gibt
 * eine kurze Zusammenfassung zurück. Er muss wiederholbar sein: Scheitert er,
 * bricht der Lauf ab, und der nächste Deploy beginnt ihn von vorn.
 *
 * Läuft im Backend-Deploy (cloudbuild-backend.yaml) nach Regeln und Funktionen,
 * als werkverzeichnis-deploy@; von Hand nur durch die Eigentümer:in:
 *
 *   cd gcf && KUENSTLER=<k> BUCKET=<bucket> FIRESTORE_DATABASE=werkverzeichnis node migrieren.js
 */
import { readdir } from "fs/promises";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const { KUENSTLER, BUCKET, FIRESTORE_DATABASE = "werkverzeichnis" } = process.env;
if (!KUENSTLER || !BUCKET) throw new Error("KUENSTLER=<k> BUCKET=<bucket> node migrieren.js");

/** Wie lange ein Lauf die anderen sperrt; danach gilt er als abgebrochen. */
const SPERRE = 30 * 60 * 1000;

initializeApp();
const db = getFirestore(FIRESTORE_DATABASE);
const kuenstlerDok = db.collection("artists").doc(KUENSTLER);
const stand = kuenstlerDok.collection("intern").doc("schema");
const bucket = getStorage().bucket(BUCKET);

const ordner = new URL("./migrationen/", import.meta.url);
const schritte = (await readdir(ordner).catch(() => []))
  .map(datei => datei.match(/^(\d{3})-(.+)\.js$/))
  .filter(Boolean)
  .map(([datei, nr, name]) => ({ datei, nr: Number(nr), name }))
  .sort((a, b) => a.nr - b.nr);

// Zwei Deploys kurz hintereinander laufen sonst gleichzeitig.
const ich = `${process.env.BUILD_ID ?? "hand"}-${Date.now()}`;
const version = await db.runTransaction(async tx => {
  const d = (await tx.get(stand)).data() ?? {};
  if (d.sperre && d.sperre.bis.toMillis() > Date.now()) return null;
  tx.set(stand, { version: d.version ?? 0, schritte: d.schritte ?? [],
    sperre: { von: ich, bis: Timestamp.fromMillis(Date.now() + SPERRE) } });
  return d.version ?? 0;
});
if (version === null) {
  console.log("Migrationen: ein anderer Lauf ist dabei, übersprungen.");
  process.exit(0);
}

let fertig = version;
try {
  const offen = schritte.filter(s => s.nr > version);
  console.log(`Migrationen für ${KUENSTLER}: Stand ${version}, ${offen.length} offen.`);
  for (const s of offen) {
    if (s.nr !== fertig + 1) throw new Error(`Schritt ${fertig + 1} fehlt (nächster ist ${s.datei}).`);
    const start = Date.now();
    console.log(`→ ${s.datei}`);
    const { ausfuehren } = await import(new URL(s.datei, ordner));
    const ergebnis = String(await ausfuehren({ db, kuenstlerDok, bucket, log: (...a) => console.log("  ", ...a) }) ?? "");
    const eintrag = { nr: s.nr, name: s.name, am: Timestamp.now(), sekunden: Math.round((Date.now() - start) / 1000), ergebnis };
    await db.runTransaction(async tx => {
      const d = (await tx.get(stand)).data();
      if (d?.sperre?.von !== ich) throw new Error("Sperre verloren, Abbruch.");
      tx.update(stand, { version: s.nr, schritte: [...d.schritte, eintrag] });
    });
    fertig = s.nr;
    console.log(`  fertig in ${eintrag.sekunden} s: ${ergebnis}`);
  }
} finally {
  await db.runTransaction(async tx => {
    const d = (await tx.get(stand)).data();
    if (d?.sperre?.von === ich) tx.update(stand, { sperre: null });
  });
}
console.log(`Migrationen: Stand ${fertig}.`);
