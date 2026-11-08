/**
 * Bilder hochladen (#180). Die Verwaltung legt artists/{a}/uploads/{id} an
 * (firestore.rules: nur mit `werke.bearbeiten`, Typ und Größe geprüft); diese
 * Funktion prüft noch einmal und schreibt eine signierte URL zurück, mit der der
 * Browser genau eine neue Datei unter artists/{a}/works/{werk}/ anlegt. Daraus
 * macht die Bildfunktion (index.js) wie bei jedem Original die Webversionen; ans
 * Werk hängt sie der Editor mit Verlaufseintrag.
 *
 * Status: angefordert → bereit (url, pfad, ablauf) | fehler (meldung).
 *
 * Unterschrieben wird ohne Schlüssel über die IAM-API (signBlob) mit dem Konto
 * upload-function, das im Bucket nur anlegen darf: Die URL überschreibt nichts.
 * Die Größe ist mitunterschrieben (x-goog-content-length-range); Cloud Storage
 * nimmt den PUT nur an, wenn der Browser genau diesen Header schickt und die
 * Datei hineinpasst.
 */
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

const PROJEKT = process.env.GCLOUD_PROJECT;
const BUCKET = process.env.BUCKET;

/** Was hochgeladen werden darf: Endung → Typ; wie BILD und PDF in process.js. */
export const TYPEN = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  tif: "image/tiff", tiff: "image/tiff", pdf: "application/pdf",
};
export const HOECHSTENS = 50 * 1024 * 1024;
const GUELTIG = 15 * 60 * 1000;

/**
 * Der Pfad der neuen Datei, oder ein Grund, warum nicht. Der Name kommt vom
 * Browser; vorne steht die Zeit, damit zwei gleichnamige Dateien sich nicht
 * treffen (anlegen kann die URL ohnehin nur, was es noch nicht gibt).
 */
export function pruefen({ kuenstler, werk, name, typ, groesse }, jetzt = Date.now()) {
  if (typeof werk !== "string" || !/^[a-z0-9.-]+$/.test(werk)) return { fehler: "Ungültiges Werk." };
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(name)) return { fehler: "Ungültiger Dateiname." };
  const endung = name.split(".").pop();
  if (!TYPEN[endung] || TYPEN[endung] !== typ) return { fehler: "Dateityp nicht erlaubt (JPEG, PNG, WebP, GIF, TIFF, PDF)." };
  if (!Number.isInteger(groesse) || groesse <= 0) return { fehler: "Ungültige Dateigröße." };
  if (groesse > HOECHSTENS) return { fehler: "Datei zu groß (höchstens 50 MB)." };
  return { pfad: `artists/${kuenstler}/works/${werk}/${jetzt.toString(36)}-${name}` };
}

export const hochladen = onDocumentCreated({
  document: "artists/{kuenstler}/uploads/{id}",
  database: "werkverzeichnis",
  region: "europe-west3",
  serviceAccount: `upload-function@${PROJEKT}.iam.gserviceaccount.com`,
}, async ereignis => {
  const ref = ereignis.data.ref;
  const anfrage = ereignis.data.data();
  const { kuenstler } = ereignis.params;
  const { pfad, fehler } = pruefen({ kuenstler, ...anfrage });
  // Die Regeln prüfen, dass es das Werk gibt; gelöscht werden Werke nicht.
  if (fehler) {
    await ref.update({ status: "fehler", meldung: fehler });
    return;
  }
  try {
    const ablauf = Date.now() + GUELTIG;
    const [url] = await getStorage().bucket(BUCKET).file(pfad).getSignedUrl({
      version: "v4",
      action: "write",
      expires: ablauf,
      contentType: anfrage.typ,
      extensionHeaders: { "x-goog-content-length-range": `0,${anfrage.groesse}` },
    });
    await ref.update({ status: "bereit", url, pfad, ablauf: Timestamp.fromMillis(ablauf), bereit: FieldValue.serverTimestamp() });
    logger.info(`${pfad}: URL für ${anfrage.von}`);
  } catch (e) {
    logger.error(`${pfad}: ${e.message}`);
    await ref.update({ status: "fehler", meldung: "Upload-URL ging nicht; bitte noch einmal versuchen." });
  }
});
