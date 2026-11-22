import { useRef, useState } from "react";
import { collection, doc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { client } from "./abfragen.js";
import { db, kuenstler } from "./firebaseClient.js";
import { hauptknopf, knopf } from "./knoepfe.js";
import { useUngespeichert } from "./ungespeichert.js";
import { werkWert } from "./werkFeld.js";
import { fehlt, gruppenFinder, werkAusZeile, zieleVon } from "../werkverzeichnis/zuordnung.js";
import { pruefen, stapeln } from "../werkverzeichnis/importPruefen.js";

/**
 * Prüfen und schreiben (#350): Übersicht gegen die Werke in Firestore, dann in
 * kleinen Stapeln schreiben, jedes Werk mit eigenem Verlaufseintrag wie im
 * Werk-Editor (Anlegen, Speichern). Bilder nicht.
 *
 * Je Werk prüfen die Regeln den Verlaufseintrag (getAfter, exists); mehr als
 * 20 solche Zugriffe je Schreibvorgang lehnen sie ab. Darum wenige Werke je
 * Stapel, und lehnen sie einen Stapel ab, die Werke darin noch einmal einzeln:
 * So bleibt der Fehler beim Werk, das ihn hat.
 */
const JE_STAPEL = 5;
const LISTE = 50;   // so viele Einträge je Gruppe der Übersicht, der Rest gezählt

const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function ImportSchreiben({ t, zuordnung, felder, gruppen, nutzer, laeuft }) {
  // Die Prüfung gilt für genau diese Tabelle und Zuordnung; ändert sich etwas, neu prüfen.
  // `t` hängt an Datei, Blatt und Kopfzeile (memoisiert), die Zuordnung als Inhalt.
  const fuer = JSON.stringify(zuordnung);
  const [geprueft, setGeprueft] = useState();   // { fuer, plan, t }
  const [prueft, setPrueft] = useState(false);
  const [fehler, setFehler] = useState();
  const [lauf, setLauf] = useState();           // { gesamt, fertig, angelegt, geaendert, fehler: [], abgebrochen, ende }
  const abbrechen = useRef(false);
  const plan = geprueft?.fuer === fuer && geprueft.t === t ? geprueft.plan : undefined;
  const name = new Map(zieleVon(felder).map(z => [z.ziel, z.name]));
  const gruppenTitel = new Map(gruppen.map(g => [g.id, g.titel]));
  const schreibt = lauf && !lauf.ende;
  useUngespeichert(!!schreibt);   // Verlassen mitten im Lauf: nachfragen

  async function pruefenKlick() {
    setPrueft(true); setFehler(undefined); setLauf(undefined);
    try {
      // Alle Werke, auch ausgeblendete und die anderer Werkgruppen: Die Inv. Nr. gibt es nur einmal.
      const s = await getDocs(collection(kuenstler, "works"));
      const vorhanden = new Map(s.docs.map(d => [d.id, { data: d.data(), stand: d.data().updatedAt?.toMillis() }]));
      const finden = gruppenFinder(gruppen);
      const werke = t.daten.map(z => werkAusZeile(z, zuordnung, t, finden));
      setGeprueft({ fuer, t, plan: pruefen(werke, vorhanden, { titel: id => gruppenTitel.get(id) ?? id }) });
    } catch (e) {
      setFehler(`Die Werke ließen sich nicht laden: ${meldung(e)}`);
    } finally {
      setPrueft(false);
    }
  }

  /**
   * Ein Stapel in einer Transaktion. Fremde Änderungen seit dem Prüfen (Werk
   * inzwischen angelegt oder gespeichert) schreiben nichts und kommen als Fehler
   * zurück; der Rest des Stapels wird geschrieben.
   */
  async function stapelSchreiben(stapel) {
    return runTransaction(db, async tx => {
      const refs = stapel.map(p => doc(kuenstler, "works", p.id));
      const jetzt = await Promise.all(refs.map(r => tx.get(r)));
      const fehler = [];
      stapel.forEach((p, i) => {
        const d = jetzt[i];
        if (p.art === "neu" ? d.exists() : !d.exists() || d.data().updatedAt?.toMillis() !== p.stand) {
          fehler.push({ ...p, text: p.art === "neu" ? "Inzwischen angelegt; bitte neu prüfen." : "Inzwischen geändert; bitte neu prüfen." });
          return;
        }
        const eintrag = doc(collection(kuenstler, "history"));
        if (p.art === "neu") {
          const werte = { InvNr: p.InvNr, ...p.felder };
          tx.set(eintrag, { work: p.id, by: nutzer.email, at: serverTimestamp(),
            changes: Object.fromEntries(Object.entries(werte).map(([f, w]) => [f, { from: null, to: w }])) });
          tx.set(refs[i], { ...werte, werkgruppe: p.werkgruppe, updatedAt: serverTimestamp(), lastChange: eintrag.id });
        } else {
          const davor = d.data();
          tx.set(eintrag, { work: p.id, by: nutzer.email, at: serverTimestamp(),
            changes: Object.fromEntries(Object.entries(p.aenderungen).map(([f, a]) => [f, { from: davor[f] ?? null, to: a.zu }])) });
          tx.update(refs[i], {
            ...Object.fromEntries(Object.entries(p.aenderungen).map(([f, a]) => [f, a.zu])),
            updatedAt: serverTimestamp(), lastChange: eintrag.id,
          });
        }
      });
      return fehler;
    });
  }

  async function schreiben() {
    const auftraege = [...plan.neu.map(p => ({ ...p, art: "neu" })), ...plan.geaendert.map(p => ({ ...p, art: "aendern" }))];
    abbrechen.current = false;
    let stand = { gesamt: auftraege.length, fertig: 0, angelegt: 0, geaendert: 0, fehler: [] };
    const melden = teil => { stand = { ...stand, ...teil, bricht: abbrechen.current }; setLauf(stand); };
    melden({});
    laeuft(true);
    try {
      for (const stapel of stapeln(auftraege, JE_STAPEL)) {
        if (abbrechen.current) { melden({ abgebrochen: true }); break; }
        let ergebnisse;   // [{ p, text? }]
        try {
          const f = await stapelSchreiben(stapel);
          ergebnisse = stapel.map(p => ({ p, text: f.find(x => x.id === p.id)?.text }));
        } catch (e) {
          if (stapel.length === 1 || e.code !== "permission-denied") {
            // Nichts aus diesem Stapel geschrieben (eine Transaktion); bei anderen Fehlern (Netz) aufhören.
            melden({ fertig: stand.fertig + stapel.length, fehler: [...stand.fehler, ...stapel.map(p => ({ ...p, text: meldung(e) }))] });
            if (e.code !== "permission-denied") { melden({ abgebrochen: true }); break; }
            continue;
          }
          ergebnisse = [];
          for (const p of stapel) {
            if (abbrechen.current) break;
            try { ergebnisse.push({ p, text: (await stapelSchreiben([p]))[0]?.text }); }
            catch (e) {
              ergebnisse.push({ p, text: meldung(e) });
              if (e.code !== "permission-denied") { abbrechen.current = true; break; }
            }
          }
        }
        const ok = ergebnisse.filter(x => !x.text).map(x => x.p);
        melden({
          fertig: stand.fertig + ergebnisse.length,
          angelegt: stand.angelegt + ok.filter(p => p.art === "neu").length,
          geaendert: stand.geaendert + ok.filter(p => p.art === "aendern").length,
          fehler: [...stand.fehler, ...ergebnisse.filter(x => x.text).map(x => ({ ...x.p, text: x.text }))],
        });
      }
    } finally {
      // Auch wenn ein Einzelversuch im letzten Stapel abbrach oder etwas Unerwartetes warf.
      melden({ ende: true, abgebrochen: stand.abgebrochen || stand.fertig < stand.gesamt });
      laeuft(false);
      setGeprueft(undefined);   // Der Stand in Firestore ist ein anderer; erneut prüfen zeigt ihn.
      client.invalidateQueries({ queryKey: ["werke"] });
      client.invalidateQueries({ queryKey: ["werteJeFeld"] });
    }
  }

  if (fehlt(zuordnung).length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Prüfen und übernehmen</h2>
      {!schreibt && (
        <button type="button" className={plan ? knopf : hauptknopf} disabled={prueft} onClick={pruefenKlick}>
          {prueft ? "Prüft…" : plan ? "Neu prüfen" : "Prüfen"}
        </button>
      )}
      {fehler && <p className="text-red-700" role="alert">{fehler}</p>}
      {plan && !lauf && <Uebersicht plan={plan} name={name} gruppenTitel={gruppenTitel} />}
      {plan && !lauf && (plan.neu.length + plan.geaendert.length > 0 ? (
        <div className="space-y-1">
          <button type="button" className={hauptknopf} onClick={schreiben}>
            {[plan.neu.length && `${plan.neu.length} ${plan.neu.length === 1 ? "Werk" : "Werke"} anlegen`,
              plan.geaendert.length && `${plan.geaendert.length} ändern`].filter(Boolean).join(" und ")}
          </button>
          {plan.fehler.length > 0 && <p className="text-sm text-gray-600">Zeilen mit Fehlern werden übersprungen.</p>}
        </div>
      ) : <p>Nichts zu übernehmen.</p>)}
      {lauf && <Lauf lauf={lauf} abbrechen={() => { abbrechen.current = true; setLauf(l => ({ ...l, bricht: true })); }} />}
    </section>
  );
}

function Lauf({ lauf, abbrechen }) {
  const { gesamt, fertig, angelegt, geaendert, fehler, abgebrochen, ende, bricht } = lauf;
  return (
    <div className="space-y-2">
      <progress className="w-full" max={gesamt} value={fertig} aria-label="Fortschritt" />
      <p role="status">
        {ende ? (abgebrochen ? "Abgebrochen. " : "Fertig. ") : `${fertig} von ${gesamt}… `}
        {angelegt} angelegt, {geaendert} geändert{fehler.length > 0 && `, ${fehler.length} nicht übernommen`}.
        {ende && abgebrochen && fertig < gesamt && ` ${gesamt - fertig} nicht mehr versucht.`}
      </p>
      {!ende && <button type="button" className={knopf} disabled={bricht} onClick={abbrechen}>{bricht ? "Bricht nach diesem Stapel ab…" : "Abbrechen"}</button>}
      {fehler.length > 0 && (
        <ul className="text-red-700 list-disc pl-6">
          {fehler.slice(0, LISTE).map(f => <li key={f.nr}>Zeile {f.nr} ({f.InvNr}): {f.text}</li>)}
          {fehler.length > LISTE && <li>und {fehler.length - LISTE} weitere</li>}
        </ul>
      )}
      {ende && <p className="text-sm text-gray-600">Auf der Website erscheint es mit der nächsten Veröffentlichung.</p>}
    </div>
  );
}

function Gruppe({ titel, liste, offen, farbe = "", kinder }) {
  if (!liste.length) return null;
  return (
    <details open={offen} className="border border-gray-200 rounded">
      <summary className={"px-3 py-2 cursor-pointer font-semibold " + farbe}>{titel}: {liste.length}</summary>
      <ul className="px-3 pb-2 space-y-1 text-sm">
        {liste.slice(0, LISTE).map(x => <li key={x.nr}>{kinder(x)}</li>)}
        {liste.length > LISTE && <li className="text-gray-600">und {liste.length - LISTE} weitere</li>}
      </ul>
    </details>
  );
}

function Uebersicht({ plan, name, gruppenTitel }) {
  const zeile = x => <><span className="text-gray-500">Zeile {x.nr}</span> <span className="font-semibold">{x.InvNr || "–"}</span></>;
  return (
    <div className="space-y-2">
      <Gruppe titel="Fehler" farbe="text-red-700" liste={plan.fehler} offen kinder={x => <>{zeile(x)}: {x.text}</>} />
      <Gruppe titel="Neu" liste={plan.neu} kinder={x => (
        <>{zeile(x)} in {gruppenTitel.get(x.werkgruppe) ?? x.werkgruppe}
          {x.felder.Titel && <>: {x.felder.Titel}</>}</>
      )} />
      <Gruppe titel="Geändert" liste={plan.geaendert} offen kinder={x => (
        <>
          {zeile(x)}{x.ausgeblendet && <span className="text-gray-600"> (ausgeblendet)</span>}
          <ul className="pl-4">
            {Object.entries(x.aenderungen).map(([f, a]) => (
              <li key={f}><span className="text-gray-600">{name.get(f) ?? f}:</span>{" "}
                <span className="line-through text-gray-500">{werkWert(a.von)}</span> → {a.zu}</li>
            ))}
          </ul>
        </>
      )} />
      <Gruppe titel="Unverändert" liste={plan.gleich} kinder={zeile} />
    </div>
  );
}
