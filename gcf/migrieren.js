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

/** Wie lange ein Lauf die anderen sperrt (so lang wie der Build höchstens); danach gilt er als abgebrochen. */
const SPERRE = 60 * 60 * 1000;
/** Wie lange ein Lauf auf einen anderen wartet. */
const WARTEN = 45 * 60 * 1000;

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

// Zwei Deploys kurz hintereinander laufen sonst gleichzeitig. Auf den anderen
// warten statt aufgeben: Er kennt vielleicht die neuen Schritte nicht.
const ich = `${process.env.BUILD_ID ?? "hand"}-${Date.now()}`;
const sperren = () => db.runTransaction(async tx => {
  const d = (await tx.get(stand)).data() ?? {};
  if (d.sperre && d.sperre.bis.toMillis() > Date.now()) return null;
  tx.set(stand, { version: d.version ?? 0, schritte: d.schritte ?? [],
    sperre: { von: ich, bis: Timestamp.fromMillis(Date.now() + SPERRE) } }, { merge: true });
  return { version: d.version ?? 0, erledigt: d.schritte ?? [] };
});
let gesperrt;
for (const bis = Date.now() + WARTEN; !(gesperrt = await sperren());) {
  if (Date.now() > bis) throw new Error("Ein anderer Lauf sperrt seit über 45 min; Build später wiederholen.");
  console.log("Migrationen: ein anderer Lauf ist dabei, warte…");
  await new Promise(r => setTimeout(r, 15_000));
}
const { version, erledigt } = gesperrt;

let fertig = version;
try {
  // Erst alles prüfen, dann ausführen: kein halber Lauf. Zwei Branches mit
  // derselben Nummer fallen hier auf, statt dass einer still übersprungen wird.
  const doppelt = schritte.find((s, i) => schritte[i + 1]?.nr === s.nr);
  if (doppelt) throw new Error(`Schritt ${doppelt.nr} gibt es zweimal; umnummerieren.`);
  for (const s of schritte.filter(s => s.nr <= version)) {
    const war = erledigt.find(e => e.nr === s.nr);
    if (war && war.name !== s.name) throw new Error(`${s.datei} passt nicht zum Stand (${s.nr} war ${war.name}); umnummerieren.`);
  }
  const offen = schritte.filter(s => s.nr > version);
  offen.forEach((s, i) => {
    if (s.nr !== version + 1 + i) throw new Error(`Schritt ${version + 1 + i} fehlt (nächster ist ${s.datei}).`);
  });
  console.log(`Migrationen für ${KUENSTLER}: Stand ${version}, ${offen.length} offen.`);
  for (const s of offen) {
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
