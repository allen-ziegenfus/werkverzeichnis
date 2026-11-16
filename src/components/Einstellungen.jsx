import { useEffect, useState } from "react";
import { collection, serverTimestamp } from "firebase/firestore";
import { client, SCHLUESSEL, useKuenstler } from "./abfragen.js";
import { feldweiseSpeichern, gleich } from "./feldweise.js";
import { kuenstler } from "./firebaseClient.js";
import FelderBearbeiten, { felderFehler } from "./FelderBearbeiten.jsx";
import Skelett from "./Skelett.jsx";
import Zugang from "./Zugang.jsx";
import { hauptknopf } from "./knoepfe.js";
import { felderVon, STANDARD_FELDER } from "../werkverzeichnis/felder.js";

/**
 * Einstellungen der Künstler:in dieser Website. Speichert nur die geänderten
 * dieser Felder (#126), was andere inzwischen geändert haben, bleibt; jede
 * Änderung mit Eintrag in `einstellungsverlauf` (#106); wer
 * was darf, steht auf der Seite Personen (Personen.jsx). Die Künstler:in legt
 * die Zentrale an (#27).
 */

export const EINSTELLUNGEN = [
  ["titel", "Name"],
  ["websiteTitel", "Titel der Website"],
  ["titelZeile1", "Titel mobil, Zeile 1"],
  ["titelZeile2", "Titel mobil, Zeile 2"],
  ["copyright", "Copyright"],
];
/**
 * Die Felder aus dem Dokument, fehlende leer; wie einstellungen() in
 * firestore.rules. Dazu die Feldliste der Werke (#256), nur wenn gespeichert:
 * Die Regeln verlangen sie im Verlauf genau dann.
 */
export const lesen = d => ({ ...Object.fromEntries(EINSTELLUNGEN.map(([k]) => [k, d[k] ?? ""])),
  ...(d.felder !== undefined && { felder: d.felder }) });
/** Beschriftung eines Schlüssels aus lesen(), für den Verlauf. */
export const einstellungsName = k => k === "felder" ? "Felder der Werke" : EINSTELLUNGEN.find(([x]) => x === k)?.[1] ?? k;
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function EinstellungenSeite() {
  return <Zugang berechtigung="einstellungen.bearbeiten" kinder={({ nutzer }) => <Einstellungen ich={nutzer.email} />} />;
}

function Einstellungen({ ich }) {
  const [entwurf, setEntwurf] = useState();
  const [stand, setStand] = useState();   // die Felder beim Öffnen bzw. letzten Speichern
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();

  // Aus dem Cache, wenn schon geladen; der Entwurf wird nur einmal gefüllt.
  const { data, error } = useKuenstler();
  useEffect(() => {
    if (data && !entwurf) { setEntwurf(lesen(data)); setStand(lesen(data)); }
  }, [data]);
  useEffect(() => { if (error) setFehler(meldung(error)); }, [error]);

  const setze = (k, v) => { setEntwurf(e => ({ ...e, [k]: v })); setHinweis(undefined); };
  // Ohne gespeicherte Liste stehen die Standardfelder im Formular; geschrieben wird sie erst, wenn sich etwas ändert.
  // Eine unbrauchbare gespeicherte Liste (die Regeln prüfen die Einträge nicht
  // einzeln) zeigt die Standardfelder; Speichern ersetzt sie dann.
  const felder = felderVon(entwurf);
  const felderProblem = entwurf && felderFehler(felder);

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    try {
      // Namen ohne Leerzeichen am Rand; die Liste bleibt weg, solange sie die Standardliste ist.
      const mein = entwurf.felder ? { ...entwurf, felder: entwurf.felder.map(f => ({ ...f, name: f.name.trim() })) } : { ...entwurf };
      // Hin und zurück geändert: keine Liste schreiben, damit Änderungen an STANDARD_FELDER weiter gelten.
      if (stand.felder === undefined && gleich(mein.felder, STANDARD_FELDER)) delete mein.felder;
      const r = await feldweiseSpeichern({ ref: kuenstler, stand, mein, lesen, ergaenzen: true,
        verlauf: { sammlung: collection(kuenstler, "einstellungsverlauf"),
          eintrag: (vorher, nachher) => ({ by: ich, at: serverTimestamp(), vorher, nachher }) } });
      setEntwurf(r.formular); setStand(r.stand);
      // Der Cache bekommt nur, was gespeichert ist.
      client.setQueryData(SCHLUESSEL.kuenstler, d => d && { ...d, ...r.stand });
      if (r.konflikte.length) {
        setFehler(`Inzwischen woanders geändert: ${r.konflikte.map(k => k === "felder" ? einstellungsName(k)
          : `${einstellungsName(k)} (jetzt „${r.stand[k]}“)`).join(", ")}. `
          + "Nichts gespeichert; erneut speichern übernimmt die Werte von hier.");
        return;
      }
      setHinweis(r.fremd ? "Gespeichert; Änderungen anderer an weiteren Feldern sind übernommen." : "Gespeichert.");
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setSpeichert(false);
    }
  }

  if (!entwurf) return fehler ? <p className="text-red-700">{fehler}</p> : <Skelett />;

  return (
    <div className="space-y-3">
      {EINSTELLUNGEN.map(([k, beschriftung]) => (
        <label key={k} className="block">
          <span className="text-sm text-gray-600">{beschriftung}</span>
          {/* Während des Speicherns gesperrt: Das Ergebnis ersetzt das Formular. */}
          <input className="border p-1 w-full disabled:bg-gray-100" value={entwurf[k]} disabled={speichert}
                 onChange={e => setze(k, e.target.value)} />
        </label>
      ))}

      <h2 className="pt-4 text-lg font-semibold">Felder der Werke</h2>
      <FelderBearbeiten felder={felder} setFelder={f => setze("felder", f)} gesperrt={speichert}
                        gespeichert={new Set(felderVon(stand).map(f => f.schluessel))} />

      <div className="flex flex-wrap gap-2 items-center">
        <button className={hauptknopf} onClick={speichern} disabled={speichert || !entwurf.titel.trim() || !!felderProblem}>
          {speichert ? "Speichere…" : "Speichern"}
        </button>
        {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
        {fehler && <span className="text-red-700 text-sm">{fehler}</span>}
        {!fehler && felderProblem && <span className="text-red-700 text-sm">{felderProblem}</span>}
      </div>
    </div>
  );
}
