import { useEffect, useRef, useState } from "react";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { darf } from "../werkverzeichnis/permissions.js";
import { client, SCHLUESSEL, useWerkgruppen } from "./abfragen.js";
import { db, KUENSTLER } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import Zugang from "./Zugang.jsx";

/**
 * Die Werkgruppen der Künstler:in dieser Website: Titel, Kurztitel, Reihenfolge.
 * Jede Änderung schreibt einen Eintrag in `werkgruppenverlauf` (#106).
 */

/** Was der Verlauf je Werkgruppe festhält, wie werkgruppenFassung() in firestore.rules. */
export const werkgruppenFassung = d => d && ({ titel: d.titel, kurztitel: d.kurztitel ?? null,
  reihenfolge: d.reihenfolge, cover: d.cover ?? null });
export const WERKGRUPPENFELDER = { titel: "Titel", kurztitel: "Kurztitel", reihenfolge: "Reihe", cover: "Titelbild" };

const zuKennung = (s, max) => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, max);
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function WerkgruppenSeite() {
  return <Zugang berechtigung="werkgruppen.bearbeiten" kinder={({ nutzer, wer }) =>
    <Werkgruppen kuenstlerId={KUENSTLER} ich={nutzer.email} bearbeitbar={darf(wer, "werkgruppen.bearbeiten")} />} />;
}

function Werkgruppen({ kuenstlerId, ich, bearbeitbar }) {
  const { data: gruppen, error: ladefehler } = useWerkgruppen();
  const [titel, setTitel] = useState("");
  const [fehler, setFehler] = useState();
  const sammlung = collection(db, "artists", kuenstlerId, "werkgruppen");
  const verlauf = collection(db, "artists", kuenstlerId, "werkgruppenverlauf");
  // ?werkgruppe=<Kennung> (aus der Werkzeugleiste): Zeile hervorheben, Titel fokussieren.
  const [ziel] = useState(() => new URLSearchParams(location.search).get("werkgruppe"));
  const zielFeld = useRef();
  useEffect(() => {
    zielFeld.current?.scrollIntoView({ block: "center" });
    zielFeld.current?.focus();
  }, [gruppen === undefined]);

  const laden = () => client.invalidateQueries({ queryKey: SCHLUESSEL.werkgruppen });

  async function hinzufuegen() {
    setFehler(undefined);
    const id = zuKennung(titel, 60);
    const ref = doc(sammlung, id);
    const reihenfolge = Math.max(0, ...gruppen.map(g => g.reihenfolge)) + 1;
    try {
      await runTransaction(db, async tx => {
        if ((await tx.get(ref)).exists()) throw new Error(`„${id}“ gibt es schon.`);
        const neu = { titel: titel.trim(), kurztitel: null, reihenfolge };
        const eintrag = doc(verlauf);
        tx.set(eintrag, { werkgruppe: id, by: ich, at: serverTimestamp(), vorher: null, nachher: werkgruppenFassung(neu) });
        tx.set(ref, { ...neu, updatedAt: serverTimestamp(), lastChange: eintrag.id });
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
      const ref = doc(sammlung, g.id);
      await runTransaction(db, async tx => {
        const jetzt = (await tx.get(ref)).data();
        const eintrag = doc(verlauf);
        tx.set(eintrag, { werkgruppe: g.id, by: ich, at: serverTimestamp(),
          vorher: werkgruppenFassung(jetzt), nachher: werkgruppenFassung({ ...jetzt, ...aenderungen }) });
        tx.update(ref, { ...aenderungen, updatedAt: serverTimestamp(), lastChange: eintrag.id });
      });
      await laden();
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  return (
    <div className="space-y-2">
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      {ladefehler && !gruppen && <p className="text-red-700 text-sm">{meldung(ladefehler)}</p>}
      {!gruppen && !ladefehler && <Skelett />}
      {gruppen && <table className="text-sm w-full">
        <thead>
          <tr className="text-left text-gray-600">
            <th className="w-16">Reihe</th><th>Titel</th><th>Kurztitel</th><th>Kennung</th>
          </tr>
        </thead>
        <tbody>
          {gruppen.map(g => (
            <tr key={g.id} className={g.id === ziel ? "bg-yellow-100" : ""}>
              <td>
                {/* key: Neu geladene Werte ersetzen das Feld; sonst speicherte onBlur den alten Wert zurück. */}
                <input key={g.reihenfolge} type="number" className="border p-1 w-14 disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.reihenfolge}
                       onBlur={e => Number(e.target.value) !== g.reihenfolge
                         && aendern(g, { reihenfolge: Math.trunc(Number(e.target.value)) })} />
              </td>
              <td>
                <input key={g.titel} className="border p-1 w-full disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.titel}
                       ref={g.id === ziel ? zielFeld : undefined}
                       onBlur={e => e.target.value.trim() && e.target.value !== g.titel
                         && aendern(g, { titel: e.target.value.trim() })} />
              </td>
              <td>
                <input key={g.kurztitel ?? ""} className="border p-1 w-full disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.kurztitel ?? ""}
                       onBlur={e => e.target.value !== (g.kurztitel ?? "")
                         && aendern(g, { kurztitel: e.target.value.trim() || null })} />
              </td>
              <td className="font-mono text-gray-600">{g.id}</td>
            </tr>
          ))}
        </tbody>
      </table>}
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
