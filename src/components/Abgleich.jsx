import { useEffect, useRef, useState } from "react";
import { getDoc, onSnapshot } from "firebase/firestore";
import { KUENSTLER } from "./firebaseClient.js";
import { Unterschied } from "./VerlaufListe.jsx";
import { wann } from "./zeit.js";

/**
 * Abgleich eines Formulars mit dem gespeicherten Stand (#203), für Seiten und
 * Werke:
 * - Der Entwurf liegt im Browser (localStorage), mit dem Stand, von dem er
 *   ausging; nach einem geschlossenen Tab lässt er sich wiederherstellen.
 * - Speichert jemand anderes, kommt das live an: ohne eigene Änderungen wird
 *   es übernommen, sonst je Feld zusammengeführt.
 * - Zusammenführen: nur hier geändert → von hier; nur dort → von dort; beide
 *   dasselbe Feld unterschiedlich → Konflikt, die Nutzer:in wählt.
 */

/** Je Feld zusammenführen; bei Konflikten steht vorerst der gespeicherte Wert im Ergebnis. */
export function zusammenfuehren(basis, mein, ihr, felder, gleich) {
  const ergebnis = {}, konflikte = [];
  for (const f of felder) {
    const hier = !gleich(f, basis[f], mein[f]), dort = !gleich(f, basis[f], ihr[f]);
    if (hier && dort && !gleich(f, mein[f], ihr[f])) konflikte.push({ feld: f, mein: mein[f], ihr: ihr[f] });
    ergebnis[f] = hier && !dort ? mein[f] : ihr[f];
  }
  return { ergebnis, konflikte };
}

const ms = t => t?.toMillis?.() ?? null;
const lesen = s => { try { return JSON.parse(localStorage.getItem(s)); } catch { return null; } };
const schreiben = (s, w) => { try { localStorage.setItem(s, JSON.stringify(w)); } catch { /* voll oder gesperrt */ } };
const entfernen = s => { try { localStorage.removeItem(s); } catch { /* gesperrt */ } };

/**
 * - art, id: wofür (Schlüssel im localStorage); ref: das Firestore-Dokument
 * - felder, gleich(feld, a, b): die bearbeitbaren Felder und ihr Vergleich
 * - stand: die gespeicherten Daten, auf denen das Formular beruht (mit updatedAt)
 * - entwurf (nur die Felder), geaendert
 * - uebernehmen(daten, entwurf?): neuen gespeicherten Stand übernehmen, das
 *   Formular auf `entwurf` (oder die Daten) setzen
 * - setzeFeld(feld, wert): für die Wahl bei einem Konflikt
 * - wer(lastChange): wer gespeichert hat (aus dem Verlauf); name(feld): Anzeige
 * - aktiv: false für ein neues, noch nicht angelegtes Dokument (dann ist ref null)
 */
export function useAbgleich({ art, id, ref, felder, gleich, name = f => f, stand, entwurf, geaendert,
  uebernehmen, setzeFeld, wer, aktiv = true }) {
  const schluessel = `werkverzeichnis-entwurf:${KUENSTLER}:${art}:${id}`;
  const auswahl = d => Object.fromEntries(felder.map(f => [f, d?.[f] ?? null]));
  const [fremd, setFremd] = useState();         // { daten, by } oder { geloescht: true }
  const [konflikte, setKonflikte] = useState([]);
  const [meldung, setMeldung] = useState();
  // Ein gesicherter Entwurf, der sich vom gespeicherten Stand unterscheidet; je
  // Dokument neu nachgesehen (der Werk-Editor wechselt das Werk, ohne neu aufgebaut zu werden).
  const [fund, setFund] = useState({});
  if (fund.fuer !== schluessel) {
    let e = aktiv ? lesen(schluessel) : null;
    if (e && !felder.some(f => !gleich(f, e.entwurf?.[f], stand[f]))) { entfernen(schluessel); e = null; }
    setFund({ fuer: schluessel, wert: e });
    setFremd(undefined); setKonflikte([]); setMeldung(undefined);
  }
  const gefunden = fund.fuer === schluessel ? fund.wert : undefined;
  const setGefunden = wert => setFund({ fuer: schluessel, wert });
  // Eigene Verlaufseinträge: deren Speichern ist kein fremdes.
  const eigene = useRef(new Set());
  const aktuell = useRef();
  aktuell.current = { stand, entwurf, geaendert, uebernehmen, wer };

  // Den Entwurf sichern, solange er ungespeichert ist; nicht, solange ein alter auf Antwort wartet.
  useEffect(() => {
    if (!aktiv || gefunden !== null) return;
    if (!geaendert) { entfernen(schluessel); return; }
    const t = setTimeout(() => schreiben(schluessel,
      { basis: auswahl(stand), basisAm: ms(stand.updatedAt), entwurf, at: Date.now() }), 400);
    return () => clearTimeout(t);
  }, [aktiv, gefunden, geaendert, entwurf, stand]);

  function abgleichen(basis, mein, daten, text) {
    const { ergebnis, konflikte } = zusammenfuehren(basis, mein, auswahl(daten), felder, gleich);
    aktuell.current.uebernehmen(daten, ergebnis);
    setKonflikte(konflikte);
    setFremd(undefined);
    setMeldung(konflikte.length
      ? `${text} Bei ${konflikte.length === 1 ? "einem Feld" : `${konflikte.length} Feldern`} bitte wählen.`
      : `${text} Bitte prüfen und speichern.`);
  }

  // Speichern anderer live mitbekommen.
  useEffect(() => {
    if (!aktiv) return;
    return onSnapshot(ref, async snap => {
      const { stand, uebernehmen, wer } = aktuell.current;
      if (!snap.exists()) { setFremd({ geloescht: true }); return; }
      const daten = snap.data();
      if (eigene.current.has(daten.lastChange) || ms(daten.updatedAt) === ms(stand.updatedAt)) return;
      const by = await wer(daten.lastChange).catch(() => undefined);
      if (!aktuell.current.geaendert) {
        uebernehmen(daten);
        setMeldung(`Gerade von ${by ?? "jemand anderem"} gespeichert; der neue Stand ist übernommen.`);
      } else {
        setFremd({ daten, by });
      }
    }, () => { /* ohne Live-Hinweis geht es weiter; Speichern prüft selbst */ });
  }, [aktiv, schluessel]);

  return {
    eigene, konflikte, meldung, setMeldung,
    /** Nach einem abgelehnten Speichern: mit dem aktuellen Stand zusammenführen. */
    async nachKonflikt() {
      const snap = await getDoc(ref);
      if (!snap.exists()) { setFremd({ geloescht: true }); return; }
      const { stand, entwurf } = aktuell.current;
      abgleichen(auswahl(stand), entwurf, snap.data(), "Inzwischen woanders gespeichert; zusammengeführt.");
    },
    hinweise: (
      <Hinweise gefunden={gefunden} name={name} fremd={fremd} konflikte={konflikte} meldung={meldung}
        wiederherstellen={() => {
          setGefunden(null);
          abgleichen(gefunden.basis, gefunden.entwurf, aktuell.current.stand, "Entwurf wiederhergestellt.");
        }}
        verwerfen={() => { entfernen(schluessel); setGefunden(null); }}
        zusammenfuehren={() => {
          const { stand, entwurf } = aktuell.current;
          abgleichen(auswahl(stand), entwurf, fremd.daten, "Zusammengeführt.");
        }}
        waehlen={(f, wert) => { setzeFeld(f, wert); setKonflikte(k => k.filter(x => x.feld !== f)); }} />
    ),
  };
}

const knopf = "px-2 py-0.5 border rounded bg-white";
const kurz = w => !String(w ?? "").includes("\n") && String(w ?? "").length <= 120;

function Hinweise({ gefunden, name, fremd, konflikte, meldung, wiederherstellen, verwerfen, zusammenfuehren, waehlen }) {
  return (
    <>
      {gefunden && (
        <div className="border border-amber-400 bg-amber-50 rounded p-2 text-sm flex gap-2 items-center flex-wrap">
          <span className="flex-1">Ungespeicherter Entwurf vom {wann({ toDate: () => new Date(gefunden.at) })}.</span>
          <button className={knopf} onClick={wiederherstellen}>Wiederherstellen</button>
          <button className={knopf} onClick={verwerfen}>Verwerfen</button>
        </div>
      )}
      {fremd?.geloescht && (
        <p className="border border-red-400 bg-red-50 rounded p-2 text-sm">Inzwischen woanders gelöscht. Was hier steht, ist nicht mehr gespeichert.</p>
      )}
      {fremd?.daten && (
        <div className="border border-amber-400 bg-amber-50 rounded p-2 text-sm flex gap-2 items-center flex-wrap">
          <span className="flex-1">Gerade von {fremd.by ?? "jemand anderem"} gespeichert ({wann(fremd.daten.updatedAt)}).</span>
          <button className={knopf} onClick={zusammenfuehren}>Mit meinen Änderungen zusammenführen</button>
        </div>
      )}
      {meldung && !fremd && <p className="text-sm text-amber-800">{meldung}</p>}
      {konflikte.map(k => (
        <div key={k.feld} className="border border-amber-400 rounded p-2 text-sm space-y-1">
          <b>{name(k.feld)}</b>: hier und woanders unterschiedlich geändert.
          {kurz(k.ihr) && kurz(k.mein) ? (
            <div className="pl-3">
              <div><span className="text-gray-600">Gespeichert:</span> {String(k.ihr ?? "∅")}</div>
              <div><span className="text-gray-600">Meins:</span> {String(k.mein ?? "∅")}</div>
            </div>
          ) : <Unterschied von={k.ihr} zu={k.mein} beschriftung="Unterschied (− gespeichert, + meins)" />}
          <div className="flex gap-2 flex-wrap">
            <button className={knopf} onClick={() => waehlen(k.feld, k.mein)}>Meins nehmen</button>
            <button className={knopf} onClick={() => waehlen(k.feld, k.ihr)}>Gespeichertes behalten</button>
          </div>
        </div>
      ))}
    </>
  );
}
