/**
 * Veröffentlichen. Die Verwaltungsseite legt artists/{a}/veroeffentlichungen/{id}
 * an (firestore.rules erlaubt das nur mit der Berechtigung `veroeffentlichen`);
 * `veroeffentlichen` startet den Cloud-Build-Trigger dieser Künstler:in
 * (cloudbuild.yaml), und `buildStatus` verfolgt den Build über das Pub/Sub-Topic
 * von Cloud Build.
 *
 * Status: angefordert → läuft → fertig | fehler. Eine Anfrage während eines
 * laufenden Builds wartet („wartet“); endet der Build, übernimmt ein neuer Build
 * alle wartenden Anfragen, denn ein Build liest, was beim Start in Firestore steht.
 * Hat sich seit dem, was der erfolgreiche Build gelesen hat, nichts geändert,
 * sind die wartenden ohne neuen Build fertig (#4).
 */
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { CloudBuildClient } from "@google-cloud/cloudbuild";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { logger } from "firebase-functions";

const PROJEKT = process.env.GCLOUD_PROJECT;
const REGION = "europe-west3";
const SERVICEKONTO = `publish-function@${PROJEKT}.iam.gserviceaccount.com`;

/**
 * Welcher Trigger und welcher Branch die Seite welcher Künstler:in bauen: Jedes
 * Projekt hat eine Seite (infra/gcp); cloudbuild-backend.yaml schreibt ihre
 * Künstler:in und ihren Branch nach gcf/.env (#109).
 */
const SEITEN = process.env.KUENSTLER ? {
  [process.env.KUENSTLER]: { trigger: `werkverzeichnis-${process.env.BRANCH}`, branch: process.env.BRANCH },
} : {};

const ENDE = { SUCCESS: "fertig", FAILURE: "fehler", INTERNAL_ERROR: "fehler", TIMEOUT: "fehler",
  CANCELLED: "fehler", EXPIRED: "fehler" };

const db = () => getFirestore("werkverzeichnis");
let cloudBuild;

/**
 * Wer gerade baut: artists/{a}/intern/veroeffentlichen hält `seit` und `buildId`,
 * solange ein Veröffentlichungs-Build läuft (keine Regel passt darauf, Clients
 * sehen es nicht). Beide Handler lesen und schreiben es in Transaktionen: Zwei
 * Anfragen starten nicht beide einen Build, und eine Anfrage, die beim Ende
 * eines Builds eingeht, geht nicht verloren.
 */
const sperreVon = kuenstlerRef => kuenstlerRef.collection("intern").doc("veroeffentlichen");
// Eine Sperre, älter als das Build-Timeout, hat ihre Statusmeldung verloren; nicht auf sie warten.
const VERALTET = 30 * 60 * 1000;

/**
 * Gibt die Sperre nach einem gescheiterten Start frei. Inzwischen wartende
 * Anfragen schlagen ebenfalls fehl: Kein Build wird enden, der sie übernimmt.
 */
async function freigeben(kuenstlerRef, meldung) {
  const sperre = sperreVon(kuenstlerRef);
  await db().runTransaction(async tx => {
    await tx.get(sperre);
    const wartend = await tx.get(kuenstlerRef.collection("veroeffentlichungen").where("status", "==", "wartet"));
    for (const d of wartend.docs) tx.update(d.ref, { status: "fehler", meldung });
    tx.delete(sperre);
  });
}

/** Startet einen Build für `anfragen` (einer Künstler:in, die die Sperre hält). */
async function starten(kuenstlerRef, anfragen) {
  const kuenstler = kuenstlerRef.id;
  const sperre = sperreVon(kuenstlerRef);
  const seite = SEITEN[kuenstler];
  if (!seite) {
    const meldung = `Kein Build für „${kuenstler}“ eingerichtet.`;
    await Promise.all(anfragen.map(a => a.update({ status: "fehler", meldung })));
    await freigeben(kuenstlerRef, meldung);
    return;
  }
  cloudBuild ??= new CloudBuildClient();
  try {
    const [vorgang] = await cloudBuild.runBuildTrigger({
      name: `projects/${PROJEKT}/locations/${REGION}/triggers/${seite.trigger}`,
      source: { branchName: seite.branch },
    });
    const build = vorgang.metadata.build;
    const stapel = db().batch();
    for (const a of anfragen) {
      stapel.update(a, { status: "läuft", buildId: build.id, logUrl: build.logUrl,
        gestartet: FieldValue.serverTimestamp() });
    }
    stapel.update(sperre, { buildId: build.id });
    await stapel.commit();
    logger.info(`${kuenstler}: build ${build.id} for ${anfragen.length} request(s)`);
  } catch (e) {
    logger.error(e);
    const meldung = String(e.message ?? e);
    await Promise.all(anfragen.map(a => a.update({ status: "fehler", meldung })));
    await freigeben(kuenstlerRef, meldung);
  }
}

export const veroeffentlichen = onDocumentCreated({
  document: "artists/{kuenstler}/veroeffentlichungen/{id}",
  database: "werkverzeichnis",
  region: REGION,
  serviceAccount: SERVICEKONTO,
}, async ereignis => {
  const ref = ereignis.data.ref;
  const kuenstlerRef = ref.parent.parent;
  const sperre = sperreVon(kuenstlerRef);
  const meine = await db().runTransaction(async tx => {
    const seit = (await tx.get(sperre)).get("seit");
    if (seit && seit.toMillis() > Date.now() - VERALTET) {
      tx.update(ref, { status: "wartet" });
      // Das Schreiben der Sperre lässt die Transaktion eines endenden Builds diese Anfrage sehen.
      tx.update(sperre, { wartend: FieldValue.increment(1) });
      return false;
    }
    tx.set(sperre, { seit: Timestamp.now(), buildId: null });
    return true;
  });
  if (meine) await starten(kuenstlerRef, [ref]);
});

/**
 * Wann der Build die Daten gelesen hat: build_data.ts meldet es als Ergebnis
 * seines Schritts. Veröffentlichen zählt Änderungen ab diesem Zeitpunkt (#67).
 */
function lesezeit(build) {
  for (const ausgabe of build.results?.buildStepOutputs ?? []) {
    try {
      const { gelesen } = JSON.parse(Buffer.from(ausgabe, "base64").toString());
      if (gelesen) return Timestamp.fromDate(new Date(gelesen));
    } catch { /* ein anderer Schritt oder leer */ }
  }
  return null;
}

/**
 * Ob sich seit `t` etwas geändert hat, das der Build liest (catalog.ts): Werke
 * (Verlauf), Seiten (Verlauf, auch gelöschte), Werkgruppen, Bildeinträge, die
 * Einstellungen der Künstler:in. Dieselben Zeitstempel wie die Tafel in
 * Veroeffentlichen.jsx. Liest in der Transaktion `tx`.
 */
async function geaendertSeit(tx, kuenstlerRef, t) {
  const proben = [["history", "at"], ["seitenverlauf", "at"], ["werkgruppen", "updatedAt"], ["medien", "erstellt"]]
    .map(([c, feld]) => tx.get(kuenstlerRef.collection(c).where(feld, ">", t).limit(1)));
  const [k, ...rest] = await Promise.all([tx.get(kuenstlerRef), ...proben]);
  return (k.get("updatedAt")?.toMillis() ?? 0) > t.toMillis() || rest.some(s => !s.empty);
}

export const buildStatus = onMessagePublished({
  topic: "cloud-builds",
  region: REGION,
  serviceAccount: SERVICEKONTO,
}, async ereignis => {
  const build = ereignis.data.message.json;
  const status = ENDE[build.status];
  if (!status) return;                       // wartet noch oder läuft
  const anfragen = await db().collectionGroup("veroeffentlichungen").where("buildId", "==", build.id).get();
  if (anfragen.empty) return;                // ein Build nach Push, keine Veröffentlichung
  const gelesen = lesezeit(build);
  const stapel = db().batch();
  for (const d of anfragen.docs) {
    stapel.update(d.ref, { status, buildStatus: build.status,
      fertig: build.finishTime ? Timestamp.fromDate(new Date(build.finishTime)) : FieldValue.serverTimestamp(),
      ...(gelesen && { gelesen }) });
  }
  await stapel.commit();

  // Die Sperre an die wartenden Anfragen übergeben oder freigeben. Nur einmal je
  // Build: Pub/Sub kann die Nachricht erneut zustellen.
  const kuenstlerRef = anfragen.docs[0].ref.parent.parent;
  const sperre = sperreVon(kuenstlerRef);
  const naechste = await db().runTransaction(async tx => {
    if ((await tx.get(sperre)).get("buildId") !== build.id) return [];
    const wartend = await tx.get(kuenstlerRef.collection("veroeffentlichungen").where("status", "==", "wartet"));
    // Erst nach den wartenden Anfragen prüfen: Wer erst ändert und dann anfragt,
    // dessen Änderung ist hier schon zu sehen. Ohne `gelesen` (ältere Builds)
    // im Zweifel neu bauen.
    const nichtsNeues = !wartend.empty && status === "fertig" && gelesen
      && !(await geaendertSeit(tx, kuenstlerRef, gelesen));
    if (wartend.empty || nichtsNeues) {
      for (const d of wartend.docs) {
        tx.update(d.ref, { status: "fertig", buildId: build.id, logUrl: build.logUrl ?? null, gelesen,
          fertig: FieldValue.serverTimestamp(), hinweis: "keine neuen Änderungen, schon mit dem vorigen Build online" });
      }
      tx.delete(sperre);
      return [];
    }
    tx.set(sperre, { seit: Timestamp.now(), buildId: null });
    return wartend.docs.map(d => d.ref);
  });
  if (naechste.length) await starten(kuenstlerRef, naechste);
});
