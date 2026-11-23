import { useEffect, useRef, useState } from "react";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { darf } from "../werkverzeichnis/permissions.js";
import { client, SCHLUESSEL, useWerkgruppen } from "./abfragen.js";
import { db, KUENSTLER } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import { useUngespeichert } from "./ungespeichert.js";
import Zugang from "./Zugang.jsx";
import { hauptknopf, knopfKlein } from "./knoepfe.js";
import { Vorschaubild } from "./BildVorschau.jsx";
import { ablehnen, hochladen, TYPEN } from "./hochladen.js";
import { werkgruppeAendern, werkgruppenFassung } from "./werkgruppeSchreiben.js";

/**
 * Die Werkgruppen der Künstler:in dieser Website: Titel, Kurztitel, Reihenfolge,
 * Titelbild (#380, hochgeladen, gehört zu keinem Werk). Jede Änderung schreibt
 * einen Eintrag in `werkgruppenverlauf` (#106).
 */

/** Titelbilder nur als Bild, kein PDF. */
const BILDTYPEN = Object.keys(TYPEN).filter(e => TYPEN[e].startsWith("image/")).map(e => "." + e).join(",");

export { werkgruppenFassung };
export const WERKGRUPPENFELDER = { titel: "Titel", kurztitel: "Kurztitel", reihenfolge: "Reihe", cover: "Titelbild" };

const zuKennung = (s, max) => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, max);
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function WerkgruppenSeite() {
  return <Zugang berechtigung="werkgruppen.bearbeiten" kinder={({ nutzer, wer }) =>
    <Werkgruppen kuenstlerId={KUENSTLER} ich={nutzer.email} bearbeitbar={darf(wer, "werkgruppen.bearbeiten")} />} />;
}

function Werkgruppen({ kuenstlerId, ich, bearbeitbar }) {
  const { data: gruppen, error: ladefehler } = useWerkgruppen();
  const [titel, setTitel] = useState("");
  const [laedt, setLaedt] = useState();                 // { id, name, anteil }; bis das cover gespeichert ist
  const [nichtGesetzt, setNichtGesetzt] = useState();   // hochgeladen, aber cover nicht gespeichert: { g, pfad }
  // Neue Werkgruppe eingetippt, aber nicht hinzugefügt (#324); Titelbild lädt oder ist noch nicht gespeichert (#380).
  useUngespeichert(!!titel.trim() || !!laedt || !!nichtGesetzt);
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
  const [hinweis, setHinweis] = useState();

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
    setFehler(undefined); setHinweis(undefined);
    try {
      await werkgruppeAendern(g.id, aenderungen, ich);
      await laden();
      return true;
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  // Titelbild setzen: Die Webversionen entstehen erst nach dem Hochladen (17–45 s);
  // ein Veröffentlichen davor scheitert (build_data.ts: „web versions … not made yet“, STRICT).
  async function titelbildSetzen(g, pfad) {
    if (!await aendern(g, { cover: pfad })) { setNichtGesetzt({ g, pfad }); return; }
    setNichtGesetzt(undefined);
    setHinweis(`Titelbild von „${g.titel}“ gespeichert. Die Webversionen entstehen in etwa einer Minute; erst danach veröffentlichen.`);
  }

  async function titelbildHochladen(g, datei) {
    const grund = ablehnen(datei) ?? (TYPEN[datei.name.split(".").pop().toLowerCase()]?.startsWith("image/")
      ? undefined : `${datei.name}: Ein Titelbild muss ein Bild sein (JPEG, PNG, WebP, GIF, TIFF).`);
    setHinweis(undefined); setNichtGesetzt(undefined);
    if (grund) { setFehler(grund); return; }
    setFehler(undefined);
    setLaedt({ id: g.id, name: datei.name, anteil: 0 });
    // Gesperrt bis das cover gespeichert ist: sonst liefen zwei Speichervorgänge gegeneinander.
    try {
      const pfad = await hochladen({ werkgruppe: g.id, datei, von: ich,
        fortschritt: anteil => setLaedt(l => l && { ...l, anteil }) });
      await titelbildSetzen(g, pfad);
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setLaedt(undefined);
    }
  }

  return (
    <div className="space-y-2">
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      {nichtGesetzt && <p className="text-sm">
        Hochgeladen, aber nicht als Titelbild von „{nichtGesetzt.g.titel}“ gespeichert.{" "}
        <button className={knopfKlein} onClick={() => titelbildSetzen(nichtGesetzt.g, nichtGesetzt.pfad)}>Noch einmal speichern</button>{" "}
        <button className={knopfKlein} onClick={() => setNichtGesetzt(undefined)}>Verwerfen</button>
      </p>}
      {hinweis && <p className="text-green-800 text-sm" role="status">{hinweis}</p>}
      {laedt && <p className="text-sm" role="status">{laedt.anteil < 1
        ? <>Lade „{laedt.name}“ hoch… {Math.round(laedt.anteil * 100)} %</> : <>Speichere „{laedt.name}“ als Titelbild…</>}</p>}
      {ladefehler && !gruppen && <p className="text-red-700 text-sm">{meldung(ladefehler)}</p>}
      {!gruppen && !ladefehler && <Skelett />}
      {gruppen && <table className="text-sm w-full">
        <thead>
          <tr className="text-left text-gray-600">
            <th className="w-16">Reihe</th><th>Titel</th><th>Kurztitel</th><th>Kennung</th><th>Titelbild</th>
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
              <td>
                <div className="flex gap-2 items-center">
                  {g.cover ? <Vorschaubild key={g.cover} pfad={g.cover} /> : <span className="text-gray-600 text-xs w-12">keins</span>}
                  {bearbeitbar && (
                    <label className={knopfKlein + " whitespace-nowrap" + (laedt || nichtGesetzt ? " opacity-40 cursor-not-allowed" : " cursor-pointer")}>
                      Titelbild hochladen…
                      <input type="file" className="sr-only" accept={BILDTYPEN} disabled={!!laedt || !!nichtGesetzt}
                             aria-label={`Titelbild von ${g.titel} hochladen`}
                             onChange={e => { const d = e.target.files[0]; e.target.value = ""; if (d) titelbildHochladen(g, d); }} />
                    </label>
                  )}
                </div>
              </td>
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
            <button className={hauptknopf} disabled={!gruppen || !zuKennung(titel, 60)} onClick={hinzufuegen}>Hinzufügen</button>
          </div>
        </>
      )}
    </div>
  );
}
