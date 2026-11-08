/**
 * Cloud Functions: die Webversionen jedes Originals, das in den Firebase-Bucket
 * hochgeladen wird (process.js), das Veröffentlichen (publish.js) und die
 * Upload-URLs der Verwaltung (upload.js).
 * Deployen mit `firebase deploy --only functions`.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { logger } from "firebase-functions";
import os from "node:os";
import sharp from "sharp";
import { kuenstlerVon, originalVerarbeiten, r2Client } from "./process.js";

// Threads je sharp-Pipeline wie vCPUs (cpu unten). Auf Linux mit glibc ist der
// Standard 1; dann lief das AVIF in 2000 px allein auf einem Thread (#299).
const VCPUS = 4;
sharp.concurrency(VCPUS);

// Setzt die Firebase CLI beim Deployen und in der Funktion (#109); BUCKET
// kommt aus gcf/.env (#137).
const PROJEKT = process.env.GCLOUD_PROJECT;
const BUCKET = process.env.BUCKET;
if (!BUCKET) throw new Error("BUCKET fehlt (gcf/.env, #137)");

initializeApp();
const db = getFirestore("werkverzeichnis");

// Der R2-Schlüssel, einmal je Instanz aus dem Secret Manager gelesen. Nur das
// Servicekonto dieser Funktion darf ihn lesen.
let r2;
async function r2Einmal() {
  if (!r2) {
    const sm = new SecretManagerServiceClient();
    const lesen = async name => (await sm.accessSecretVersion({
      name: `projects/${PROJEKT}/secrets/${name}/versions/latest`,
    }))[0].payload.data.toString().trim();
    r2 = r2Client(await lesen("r2-access-key-id"), await lesen("r2-secret-access-key"));
  }
  return r2;
}

export const bilder = onObjectFinalized({
  bucket: BUCKET,
  region: "europe-west3",
  // Vier vCPUs für die parallelen Fassungen (process.js, #295); 4 GiB, weil die
  // Fassungen eines großen Originals gleichzeitig im Speicher liegen.
  memory: "4GiB",
  cpu: VCPUS,
  timeoutSeconds: 300,
  concurrency: 1,
  maxInstances: 10,
  retry: true,
  serviceAccount: `bilder-function@${PROJEKT}.iam.gserviceaccount.com`,
}, async ereignis => {
  const start = Date.now();
  const { name, md5Hash } = ereignis.data;
  const kuenstler = kuenstlerVon(name);
  if (!kuenstler) return;                   // kein Original, das wir verarbeiten
  const kuenstlerDok = db.collection("artists").doc(kuenstler);
  const copyright = (await kuenstlerDok.get()).get("copyright");
  const ergebnis = await originalVerarbeiten({
    datei: getStorage().bucket(BUCKET).file(name), md5: md5Hash, kuenstlerDok, r2: await r2Einmal(),
    copyright: copyright ? `© ${copyright}` : undefined,
  });
  // Dauer und Threads, um #295 nach dem Deploy zu messen: Zeigt die Instanz mehr
  // Kerne als die vier vCPUs, überbuchen die parallelen Pipelines.
  logger.info(`${name}: ${ergebnis?.art}`, { breiten: ergebnis?.breiten, dauerMs: Date.now() - start,
    kerne: os.availableParallelism(), sharpThreads: sharp.concurrency() });
});

export { veroeffentlichen, buildStatus } from "./publish.js";
export { hochladen } from "./upload.js";
