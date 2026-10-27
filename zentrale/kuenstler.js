import { api } from "./gcp.js";
import { pruefeEmail } from "./personen.js";

/**
 * Das Künstler:in-Dokument artists/{a} einer Website (#80). Die Regeln erlauben
 * kein Anlegen; das macht die Zentrale mit IAM und prüft selbst, was
 * gueltigerKuenstler in firestore.rules prüft. Bearbeitet wird es in der
 * Verwaltung (Einstellungen.jsx, dieselben Felder).
 */

export const FELDER = [
  ["titel", "Name"],
  ["websiteTitel", "Titel der Website"],
  ["titelZeile1", "Titel mobil, Zeile 1"],
  ["titelZeile2", "Titel mobil, Zeile 2"],
  ["copyright", "Copyright"],
];
const LAENGE = 200;

/** Was die übrigen Felder bekommen, wenn nur der Name angegeben ist. */
export const vorgaben = titel => ({
  websiteTitel: `Werkverzeichnis von ${titel}`,
  titelZeile1: "Werkverzeichnis von",
  titelZeile2: titel,
  copyright: titel,
});

/** Legt das Dokument mit einer ersten Admin an; scheitert, wenn es schon eins gibt. */
export async function anlegen(w, eingaben, admin) {
  const titel = String(eingaben.titel ?? "").trim();
  if (!titel) throw new Error("Der Name fehlt");
  const werte = { titel };
  for (const [k] of FELDER.slice(1)) werte[k] = String(eingaben[k] ?? "").trim() || vorgaben(titel)[k];
  for (const [k, name] of FELDER) {
    if (werte[k].length > LAENGE) throw new Error(`${name}: höchstens ${LAENGE} Zeichen`);
  }
  const email = pruefeEmail(admin);
  const pfad = `projects/${w.projekt}/databases/${w.datenbank}/documents`;
  await api(`https://firestore.googleapis.com/v1/${pfad}:commit`, {
    writes: [{
      update: {
        name: `${pfad}/artists/${w.kuenstler}`,
        fields: {
          ...Object.fromEntries(Object.entries(werte).map(([k, v]) => [k, { stringValue: v }])),
          roles: { mapValue: { fields: { [email]: { stringValue: "admin" } } } },
        },
      },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { exists: false },
    }],
  }).catch(f => {
    throw /ALREADY_EXISTS/.test(f.message) ? new Error("Es gibt schon ein Künstler:in-Dokument") : f;
  });
}
