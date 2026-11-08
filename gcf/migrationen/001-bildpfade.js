/**
 * pfade/<pfad> → md5 für alle schon verarbeiteten Originale (#259). Neue schreibt
 * die Bildfunktion selbst (process.js); ohne diesen Schritt stünden alte Bilder
 * in der Verwaltung auf „wird verarbeitet…“. Wiederholbar: set mit demselben Wert.
 */
import { fingerabdruck, kuenstlerVon, pfadSchluessel } from "../process.js";

export async function ausfuehren({ db, kuenstlerDok, bucket, log }) {
  const [dateien] = await bucket.getFiles({ prefix: `artists/${kuenstlerDok.id}/` });
  const erledigt = new Set((await kuenstlerDok.collection("medien").select().get()).docs.map(d => d.id));
  const nachtragen = dateien.filter(d => kuenstlerVon(d.name) && erledigt.has(fingerabdruck(d.metadata.md5Hash)));
  log(`${dateien.length} Dateien, ${nachtragen.length} verarbeitet`);
  for (let i = 0; i < nachtragen.length; i += 400) {
    const stapel = db.batch();
    for (const d of nachtragen.slice(i, i + 400)) {
      stapel.set(kuenstlerDok.collection("pfade").doc(pfadSchluessel(d.name)), { medium: fingerabdruck(d.metadata.md5Hash) });
    }
    await stapel.commit();
  }
  return `${nachtragen.length} Pfade eingetragen`;
}
