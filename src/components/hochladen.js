import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { kuenstler } from "./firebaseClient.js";

/**
 * Ein Original in den Bucket laden (#180): Upload-Anfrage in Firestore, die
 * Funktion `hochladen` (gcf/upload.js) antwortet mit einer signierten URL, dann
 * der PUT direkt aus dem Browser. Ergebnis ist der Pfad im Bucket; ans Werk
 * hängt ihn der Editor. Typen und Größe wie TYPEN und HOECHSTENS in upload.js.
 */
export const TYPEN = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  tif: "image/tiff", tiff: "image/tiff", pdf: "application/pdf",
};
export const HOECHSTENS = 50 * 1024 * 1024;
export const ANNEHMEN = Object.keys(TYPEN).map(e => "." + e).join(",");

/** Dateiname, wie Regeln und Funktion ihn nehmen: klein, ohne Umlaute und Leerzeichen. */
export function dateiname(name) {
  const punkt = name.lastIndexOf(".");
  const endung = (punkt > 0 ? name.slice(punkt + 1) : "").toLowerCase();
  const stamm = (punkt > 0 ? name.slice(0, punkt) : name).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "")
    .slice(0, 90) || "bild";
  return `${stamm}.${endung}`;
}

/** Warum die Datei nicht geht, oder nichts. */
export function ablehnen(datei) {
  const endung = dateiname(datei.name).split(".").pop();
  if (!TYPEN[endung]) return `${datei.name}: Dateityp nicht erlaubt (JPEG, PNG, WebP, GIF, TIFF, PDF).`;
  if (datei.size === 0) return `${datei.name}: Die Datei ist leer.`;
  if (datei.size > HOECHSTENS) return `${datei.name}: zu groß (höchstens 50 MB).`;
}

const WARTEN = 60_000;

function antwortAbwarten(ref) {
  return new Promise((ok, fehler) => {
    const zeit = setTimeout(() => { ab(); fehler(new Error("Keine Upload-URL bekommen; bitte noch einmal versuchen.")); }, WARTEN);
    const ab = onSnapshot(ref, d => {
      const s = d.get("status");
      if (s === "bereit") { clearTimeout(zeit); ab(); ok(d.data()); }
      if (s === "fehler") { clearTimeout(zeit); ab(); fehler(new Error(d.get("meldung") ?? "Upload abgelehnt.")); }
    }, e => { clearTimeout(zeit); fehler(e); });
  });
}

function hochschicken(url, datei, typ, fortschritt) {
  return new Promise((ok, fehler) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", typ);
    xhr.setRequestHeader("x-goog-content-length-range", `0,${datei.size}`);
    xhr.upload.onprogress = e => e.lengthComputable && fortschritt?.(e.loaded / e.total);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? ok()
      : fehler(new Error(`Hochladen fehlgeschlagen (${xhr.status}).`));
    xhr.onerror = () => fehler(new Error("Hochladen fehlgeschlagen (Netz)."));
    xhr.send(datei);
  });
}

export async function hochladen({ werk, datei, von, fortschritt }) {
  const name = dateiname(datei.name);
  const typ = TYPEN[name.split(".").pop()];
  const ref = await addDoc(collection(kuenstler, "uploads"), {
    von, angefordert: serverTimestamp(), status: "angefordert", werk, name, typ, groesse: datei.size,
  });
  const { url, pfad } = await antwortAbwarten(ref);
  await hochschicken(url, datei, typ, fortschritt);
  return pfad;
}
