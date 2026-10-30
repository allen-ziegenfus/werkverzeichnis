import { deleteField, doc, FieldPath, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebaseClient.js";

/**
 * Feldweise speichern (#126), für Einstellungen und Personen: Geschrieben wird
 * nur, was hier gegenüber dem Stand beim Öffnen (`stand`) geändert ist. Was
 * jemand anderes inzwischen an anderen Feldern gespeichert hat, bleibt und
 * kommt ins Formular. Hat er dasselbe Feld anders geändert, wird nichts
 * geschrieben: Das Formular behält den Wert von hier, der Stand wird der
 * gespeicherte, und erneutes Speichern überschreibt ihn bewusst.
 *
 * - pfad(k): wohin im Dokument (Feldname oder FieldPath)
 * - lesen(daten): die Felder aus dem Dokument, wie im Formular
 * - Ein fehlender Wert (null/undefined) heißt entfernt.
 * - ergaenzen: Felder, die im Dokument ganz fehlen, mit dem Wert von hier
 *   mitschreiben (ältere Dokumente; die Regeln verlangen alle Felder).
 * - verlauf: { sammlung, eintrag(vorher, nachher) }: im selben Schreibvorgang
 *   einen Verlaufseintrag anlegen, auf den `lastChange` zeigt (#106).
 *
 * Ergebnis: { stand, formular, konflikte, fremd } – fremd: ob andere
 * inzwischen etwas anderes geändert haben.
 */
const w = v => v ?? null;

export async function feldweiseSpeichern({ ref, stand, mein, lesen, pfad = k => k, ergaenzen = false, verlauf }) {
  const schluessel = [...new Set([...Object.keys(stand), ...Object.keys(mein)])];
  const geaendert = schluessel.filter(k => w(stand[k]) !== w(mein[k]));
  const ergebnis = await runTransaction(db, async tx => {
    const roh = (await tx.get(ref)).data() ?? {};
    const jetzt = lesen(roh);
    const konflikte = geaendert.filter(k => w(jetzt[k]) !== w(stand[k]) && w(jetzt[k]) !== w(mein[k]));
    const alle = new Set([...Object.keys(jetzt), ...schluessel]);
    const fremd = [...alle].some(k => !geaendert.includes(k) && w(jetzt[k]) !== w(stand[k]));
    const schreiben = [...new Set([...geaendert,
      ...(ergaenzen ? Object.keys(mein).filter(k => !(k in roh)) : [])])];
    if (!konflikte.length && schreiben.length) {
      const zusatz = [];
      if (verlauf) {
        const nachher = { ...jetzt };
        for (const k of schreiben) { if (w(mein[k]) === null) delete nachher[k]; else nachher[k] = mein[k]; }
        const e = doc(verlauf.sammlung);
        tx.set(e, verlauf.eintrag(jetzt, nachher));
        zusatz.push("lastChange", e.id);
      }
      tx.update(ref, ...schreiben.flatMap(k => [pfad(k), w(mein[k]) ?? deleteField()]),
        "updatedAt", serverTimestamp(), ...zusatz);
    }
    return { jetzt, konflikte, fremd };
  });
  const { jetzt, konflikte, fremd } = ergebnis;
  const formular = { ...jetzt };
  for (const k of geaendert) { if (w(mein[k]) === null) delete formular[k]; else formular[k] = mein[k]; }
  return { stand: konflikte.length ? jetzt : formular, formular, konflikte, fremd };
}

export const rollenPfad = email => new FieldPath("roles", email);
