import { useEffect, useState } from "react";
import { collection, serverTimestamp } from "firebase/firestore";
import { client, SCHLUESSEL, useKuenstler } from "./abfragen.js";
import { feldweiseSpeichern } from "./feldweise.js";
import { kuenstler } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import Zugang from "./Zugang.jsx";

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
/** Die Felder aus dem Dokument, fehlende leer; wie einstellungen() in firestore.rules. */
export const lesen = d => Object.fromEntries(EINSTELLUNGEN.map(([k]) => [k, d[k] ?? ""]));
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
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

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    try {
      const r = await feldweiseSpeichern({ ref: kuenstler, stand, mein: entwurf, lesen, ergaenzen: true,
        verlauf: { sammlung: collection(kuenstler, "einstellungsverlauf"),
          eintrag: (vorher, nachher) => ({ by: ich, at: serverTimestamp(), vorher, nachher }) } });
      setEntwurf(r.formular); setStand(r.stand);
      // Der Cache bekommt nur, was gespeichert ist.
      client.setQueryData(SCHLUESSEL.kuenstler, d => d && { ...d, ...r.stand });
      if (r.konflikte.length) {
        const name = k => EINSTELLUNGEN.find(([x]) => x === k)[1];
        setFehler(`Inzwischen woanders geändert: ${r.konflikte.map(k => `${name(k)} (jetzt „${r.stand[k]}“)`).join(", ")}. `
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
          <input className="border p-1 w-full" value={entwurf[k]} onChange={e => setze(k, e.target.value)} />
        </label>
      ))}

      <div className="flex gap-2 items-center">
        <button className={knopf} onClick={speichern} disabled={speichert || !entwurf.titel.trim()}>
          {speichert ? "Speichere…" : "Speichern"}
        </button>
        {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
        {fehler && <span className="text-red-700 text-sm">{fehler}</span>}
      </div>
    </div>
  );
}
