/**
 * Erzeugt die Webversionen aller Originale, die schon im Bucket liegen, genau wie
 * die Upload-Funktion (process.js). Für Originale, die hochgeladen wurden, bevor
 * es die Funktion gab, oder nachdem sich geändert hat, was sie erzeugt (dann
 * vorher die medien-Einträge löschen, sonst gelten sie als erledigt). Trägt für
 * die erledigten nur pfade nach (#259).
 *
 *   cd gcf && npm install && BUCKET=<bucket> R2_BUCKET=<r2-bucket> node backfill.js <projekt> <kuenstler>
 *
 * Die Buckets stehen in infra/sites/<seite>/ (bucket, bilder_bucket; #137).
 *
 * Läuft mit deinen gcloud Application Default Credentials, auch für den R2-Schlüssel
 * aus dem Secret Manager.
 */
import os from "os";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { fingerabdruck, kuenstlerVon, originalVerarbeiten, pfadSchluessel, r2Client } from "./process.js";

const [PROJEKT, KUENSTLER] = process.argv.slice(2);
const BUCKET = process.env.BUCKET;
if (!PROJEKT || !KUENSTLER || !BUCKET || !process.env.R2_BUCKET) {
  throw new Error("BUCKET=<bucket> R2_BUCKET=<r2-bucket> node backfill.js <projekt> <kuenstler>");
}

initializeApp({ projectId: PROJEKT });
const sm = new SecretManagerServiceClient();
const geheimnis = async name => (await sm.accessSecretVersion({
  name: `projects/${PROJEKT}/secrets/${name}/versions/latest`,
}))[0].payload.data.toString().trim();
const r2 = r2Client(await geheimnis("r2-access-key-id"), await geheimnis("r2-secret-access-key"));

const kuenstlerDok = getFirestore("werkverzeichnis").collection("artists").doc(KUENSTLER);
const copyright = (await kuenstlerDok.get()).get("copyright");
const [dateien] = await getStorage().bucket(BUCKET).getFiles({ prefix: `artists/${KUENSTLER}/` });
const erledigt = new Set((await kuenstlerDok.collection("medien").select().get()).docs.map(d => d.id));
const offen = dateien.filter(d => !erledigt.has(Buffer.from(d.metadata.md5Hash, "base64").toString("hex")));
console.log(`${dateien.length} originals, ${dateien.length - offen.length} already done, ${offen.length} to process`);

// Die erledigten bekommen nur ihren Eintrag in pfade.
const nachtragen = dateien.filter(d => kuenstlerVon(d.name) && erledigt.has(fingerabdruck(d.metadata.md5Hash)));
for (let i = 0; i < nachtragen.length; i += 400) {
  const stapel = getFirestore("werkverzeichnis").batch();
  for (const d of nachtragen.slice(i, i + 400)) {
    stapel.set(kuenstlerDok.collection("pfade").doc(pfadSchluessel(d.name)), { medium: fingerabdruck(d.metadata.md5Hash) });
  }
  await stapel.commit();
}
console.log(`pfade: ${nachtragen.length} nachgetragen`);

const zaehler = {};
let naechste = 0, fertig = 0;
const start = Date.now();
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 2) }, async () => {
  while (naechste < offen.length) {
    const datei = offen[naechste++];
    const d = await originalVerarbeiten({ datei, md5: datei.metadata.md5Hash, kuenstlerDok, r2,
      copyright: copyright ? `© ${copyright}` : undefined });
    const art = d?.art ?? "übersprungen";
    zaehler[art] = (zaehler[art] ?? 0) + 1;
    if (art === "fehler") console.log(`  ${datei.name}: ${d.fehler}`);
    if (++fertig % 100 === 0) {
      const tempo = fertig / ((Date.now() - start) / 1000);
      console.log(`  ${fertig}/${offen.length}, ~${Math.round((offen.length - fertig) / tempo / 60)} min left`);
    }
  }
}));
console.log(`done in ${Math.round((Date.now() - start) / 60000)} min:`, zaehler);
