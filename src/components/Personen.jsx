import { useEffect, useState } from "react";
import { getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { ROLLEN_NAMEN, ROLLEN } from "../werkverzeichnis/permissions.js";
import { kuenstler } from "./firebaseClient.js";
import Zugang from "./Zugang.jsx";

/** Wer bei der Künstler:in dieser Website was darf (artists/{a}.roles). Speichert nur die Rollen. */

const istEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function PersonenSeite() {
  return <Zugang berechtigung="rollen.verwalten" kinder={({ nutzer, wer }) =>
    <Personen ich={wer.superAdmin ? null : nutzer.email} />} />;
}

function Personen({ ich }) {
  const [rollen, setRollen] = useState();
  const [geaendert, setGeaendert] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();

  useEffect(() => {
    getDoc(kuenstler).then(d => setRollen(d.get("roles") ?? {})).catch(e => setFehler(meldung(e)));
  }, []);

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    try {
      await updateDoc(kuenstler, { roles: rollen, updatedAt: serverTimestamp() });
      setGeaendert(false);
      setHinweis("Gespeichert.");
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setSpeichert(false);
    }
  }

  if (!rollen) return fehler ? <p className="text-red-700">{fehler}</p> : <p>…</p>;

  return (
    <div className="space-y-3">
      <Rollen rollen={rollen} ich={ich} nurLesen={speichert}
              onAenderung={r => { setRollen(r); setGeaendert(true); setHinweis(undefined); }} />
      <div className="flex gap-2 items-center">
        <button className={knopf} onClick={speichern} disabled={speichert || !geaendert}>
          {speichert ? "Speichere…" : "Speichern"}
        </button>
        {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
        {fehler && <span className="text-red-700 text-sm">{fehler}</span>}
      </div>
    </div>
  );
}

/**
 * Wer welche Rolle bei dieser Künstler:in hat. `ich` (null bei Super-Admins)
 * kann den eigenen Eintrag nicht ändern, damit sich ein Admin nicht versehentlich
 * aussperrt.
 */
function Rollen({ rollen, ich, onAenderung, nurLesen = false }) {
  const [eingabe, setEingabe] = useState("");
  const [rolle, setRolle] = useState("editor");
  const email = eingabe.trim().toLowerCase();
  const gueltig = istEmail(email) && !(email in rollen);
  const hinzufuegen = () => { if (gueltig) { onAenderung({ ...rollen, [email]: rolle }); setEingabe(""); } };
  const ohne = e => Object.fromEntries(Object.entries(rollen).filter(([k]) => k !== e));
  const auswahl = "border p-1 disabled:bg-gray-100";

  return (
    <div>
      <ul className="text-sm space-y-1">
        {Object.entries(rollen).sort(([a], [b]) => a.localeCompare(b)).map(([e, r]) => (
          <li key={e} className="flex gap-2 items-center">
            <span className="flex-1">{e}</span>
            <select className={auswahl} value={r} disabled={nurLesen || e === ich}
                    onChange={ev => onAenderung({ ...rollen, [e]: ev.target.value })}>
              {ROLLEN.map(x => <option key={x} value={x}>{ROLLEN_NAMEN[x]}</option>)}
            </select>
            {!nurLesen && e !== ich && (
              <button className="text-red-700" title="Entfernen" onClick={() => onAenderung(ohne(e))}>×</button>
            )}
          </li>
        ))}
        {!Object.keys(rollen).length && <li className="text-gray-600">—</li>}
      </ul>
      {!nurLesen && (
        <div className="flex gap-2 pt-1">
          <input className="border p-1 flex-1" placeholder="name@gmail.com" value={eingabe}
                 onChange={e => setEingabe(e.target.value)} onKeyDown={e => e.key === "Enter" && hinzufuegen()} />
          <select className={auswahl} value={rolle} onChange={e => setRolle(e.target.value)}>
            {ROLLEN.map(x => <option key={x} value={x}>{ROLLEN_NAMEN[x]}</option>)}
          </select>
          <button className={knopf} disabled={!gueltig} onClick={hinzufuegen}>Hinzufügen</button>
        </div>
      )}
    </div>
  );
}
