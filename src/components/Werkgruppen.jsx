import { useEffect, useState } from "react";
import { collection, doc, getDocs, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { darf } from "../werkverzeichnis/permissions.js";
import { db, KUENSTLER } from "./firebaseClient.js";
import Zugang from "./Zugang.jsx";

/** Die Werkgruppen der Künstler:in dieser Website: Titel, Kurztitel, Reihenfolge. */

const zuKennung = (s, max) => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, max);
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function WerkgruppenSeite() {
  return <Zugang berechtigung="werkgruppen.bearbeiten" kinder={({ wer }) =>
    <Werkgruppen kuenstlerId={KUENSTLER} bearbeitbar={darf(wer, "werkgruppen.bearbeiten")} />} />;
}

function Werkgruppen({ kuenstlerId, bearbeitbar }) {
  const [gruppen, setGruppen] = useState();
  const [titel, setTitel] = useState("");
  const [fehler, setFehler] = useState();
  const sammlung = collection(db, "artists", kuenstlerId, "werkgruppen");

  async function laden() {
    const snap = await getDocs(sammlung);
    setGruppen(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.reihenfolge - b.reihenfolge));
  }
  useEffect(() => { laden().catch(e => setFehler(meldung(e))); }, [kuenstlerId]);

  async function hinzufuegen() {
    setFehler(undefined);
    const id = zuKennung(titel, 60);
    const ref = doc(sammlung, id);
    const reihenfolge = Math.max(0, ...gruppen.map(g => g.reihenfolge)) + 1;
    try {
      await runTransaction(db, async tx => {
        if ((await tx.get(ref)).exists()) throw new Error(`„${id}“ gibt es schon.`);
        tx.set(ref, { titel: titel.trim(), kurztitel: null, reihenfolge, updatedAt: serverTimestamp() });
      });
      setTitel("");
      await laden();
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  async function aendern(g, aenderungen) {
    setFehler(undefined);
    try {
      await updateDoc(doc(sammlung, g.id), { ...aenderungen, updatedAt: serverTimestamp() });
      await laden();
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  return (
    <div className="space-y-2">
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      <table className="text-sm w-full">
        <thead>
          <tr className="text-left text-gray-600">
            <th className="w-16">Reihe</th><th>Titel</th><th>Kurztitel</th><th>Kennung</th>
          </tr>
        </thead>
        <tbody>
          {(gruppen ?? []).map(g => (
            <tr key={g.id}>
              <td>
                <input type="number" className="border p-1 w-14 disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.reihenfolge}
                       onBlur={e => Number(e.target.value) !== g.reihenfolge
                         && aendern(g, { reihenfolge: Math.trunc(Number(e.target.value)) })} />
              </td>
              <td>
                <input className="border p-1 w-full disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.titel}
                       onBlur={e => e.target.value.trim() && e.target.value !== g.titel
                         && aendern(g, { titel: e.target.value.trim() })} />
              </td>
              <td>
                <input className="border p-1 w-full disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.kurztitel ?? ""}
                       onBlur={e => e.target.value !== (g.kurztitel ?? "")
                         && aendern(g, { kurztitel: e.target.value.trim() || null })} />
              </td>
              <td className="font-mono text-gray-600">{g.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bearbeitbar && (
        <>
          <p className="text-xs text-gray-600">Änderungen werden beim Verlassen des Feldes gespeichert.</p>
          <div className="flex gap-2">
            <input className="border p-1 flex-1" placeholder="Neue Werkgruppe" value={titel}
                   onChange={e => setTitel(e.target.value)} />
            <button className={knopf} disabled={!gruppen || !zuKennung(titel, 60)} onClick={hinzufuegen}>Hinzufügen</button>
          </div>
        </>
      )}
    </div>
  );
}
