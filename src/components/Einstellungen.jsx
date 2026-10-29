import { useEffect, useState } from "react";
import { getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { kuenstler } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import Zugang from "./Zugang.jsx";

/**
 * Einstellungen der Künstler:in dieser Website. Speichert nur diese Felder; wer
 * was darf, steht auf der Seite Personen (Personen.jsx). Die Künstler:in legt
 * die Zentrale an (#27).
 */

const EINSTELLUNGEN = [
  ["titel", "Name"],
  ["websiteTitel", "Titel der Website"],
  ["titelZeile1", "Titel mobil, Zeile 1"],
  ["titelZeile2", "Titel mobil, Zeile 2"],
  ["copyright", "Copyright"],
];
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function EinstellungenSeite() {
  return <Zugang berechtigung="einstellungen.bearbeiten" kinder={() => <Einstellungen />} />;
}

function Einstellungen() {
  const [entwurf, setEntwurf] = useState();
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();

  useEffect(() => {
    getDoc(kuenstler)
      .then(d => setEntwurf(Object.fromEntries(EINSTELLUNGEN.map(([k]) => [k, d.get(k) ?? ""]))))
      .catch(e => setFehler(meldung(e)));
  }, []);

  const setze = (k, v) => { setEntwurf(e => ({ ...e, [k]: v })); setHinweis(undefined); };

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    try {
      await updateDoc(kuenstler, { ...entwurf, updatedAt: serverTimestamp() });
      setHinweis("Gespeichert.");
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
