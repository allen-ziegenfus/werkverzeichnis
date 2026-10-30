import { useEffect, useRef, useState } from "react";
import { getDoc, onSnapshot } from "firebase/firestore";
import { KUENSTLER } from "./firebaseClient.js";
import { ENTWURF } from "./ungespeichert.js";
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
 *   dasselbe Feld unterschiedlich → Konflikt, die Nutzer:in wählt. Bis dahin
 *   steht der eigene Wert im Formular (und im Entwurf), der gespeicherte im Konflikt.
 */

/**
 * Je Feld zusammenführen; bei Konflikten bleibt vorerst der eigene Wert im
 * Ergebnis, damit er weder beim Neuladen noch bei einem weiteren fremden
 * Speichern verloren geht.
 */
export function zusammenfuehren(basis, mein, ihr, felder, gleich) {
  const ergebnis = {}, konflikte = [];
  for (const f of felder) {
    const hier = !gleich(f, basis[f], mein[f]), dort = !gleich(f, basis[f], ihr[f]);
    if (hier && dort && !gleich(f, mein[f], ihr[f])) konflikte.push({ feld: f, mein: mein[f], ihr: ihr[f] });
    ergebnis[f] = hier ? mein[f] : ihr[f];
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
 * - ich: wer angemeldet ist; Entwürfe gehören zu einer Person (Abmelden löscht sie)
 * - aktiv: false für ein neues, noch nicht angelegtes Dokument (dann ist ref null)
 */
export function useAbgleich({ art, id, ref, ich, felder, gleich, name = f => f, stand, entwurf, geaendert,
  uebernehmen, setzeFeld, wer, aktiv = true }) {
  const schluessel = `${ENTWURF}${ich}:${KUENSTLER}:${art}:${id}`;
  const auswahl = d => Object.fromEntries(felder.map(f => [f, d?.[f] ?? null]));
  const [fremd, setFremd] = useState();         // { daten, by } oder { geloescht: true }
  const [konflikte, setKonflikte] = useState([]);
  const [meldung, setMeldung] = useState();
  // Ein gesicherter Entwurf, der sich vom gespeicherten Stand unterscheidet; je
  // Dokument neu nachgesehen (der Werk-Editor wechselt das Werk, ohne neu aufgebaut zu werden).
  const [fund, setFund] = useState({});
  if (fund.fuer !== schluessel) {
    let e = aktiv ? lesen(schluessel) : null;
    // Unverändert oder älter als 30 Tage: nicht mehr anbieten.
    if (e && (Date.now() - e.at > 30 * 864e5 || !felder.some(f => !gleich(f, e.entwurf?.[f], stand[f])))) {
      entfernen(schluessel); e = null;
    }
    setFund({ fuer: schluessel, wert: e });
    setFremd(undefined); setKonflikte([]); setMeldung(undefined);
  }
  const gefunden = fund.fuer === schluessel ? fund.wert : undefined;
  const setGefunden = wert => setFund({ fuer: schluessel, wert });
  // Eigene Verlaufseinträge: deren Speichern ist kein fremdes.
  const eigene = useRef(new Set());
  const aktuell = useRef();
  aktuell.current = { stand, entwurf, geaendert, uebernehmen, wer, konflikte, fremd };

  // Den Entwurf sichern, solange er ungespeichert ist. Ein alter, der noch auf
  // Antwort wartet, gilt als verworfen, sobald hier etwas geändert wird.
  useEffect(() => {
    if (!aktiv || gefunden === undefined) return;
    if (gefunden) { if (geaendert) setGefunden(null); return; }
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

  // Speichern anderer live mitbekommen. Entschieden wird sofort; wer es war,
  // kommt danach, und nur, wenn bis dahin nichts Neueres kam.
  useEffect(() => {
    if (!aktiv) return;
    let gueltig = true, letzte = 0;
    const abmelden = onSnapshot(ref, snap => {
      const { stand, geaendert: eigenes, konflikte, uebernehmen, wer } = aktuell.current;
      // Offene Konflikte zählen als eigene Änderung: Sie werden neu abgeglichen, nicht überschrieben.
      const geaendert = eigenes || konflikte.length > 0;
      const nr = ++letzte;
      if (!snap.exists()) { setFremd({ geloescht: true }); return; }
      const daten = snap.data();
      if (eigene.current.has(daten.lastChange) || ms(daten.updatedAt) === ms(stand.updatedAt)) return;
      const text = by => `Gerade von ${by ?? "jemand anderem"} gespeichert; der neue Stand ist übernommen.`;
      if (!geaendert) { uebernehmen(daten); setMeldung(text()); }
      else setFremd({ daten });
      wer(daten.lastChange).then(by => {
        if (!gueltig || nr !== letzte || !by) return;
        if (!geaendert) setMeldung(text(by));
        else setFremd(f => f?.daten === daten ? { daten, by } : f);
      }, () => {});
    }, () => { /* ohne Live-Hinweis geht es weiter; Speichern prüft selbst */ });
    return () => { gueltig = false; abmelden(); };
  }, [aktiv, schluessel]);

  return {
    eigene, konflikte,
    /** Nach erfolgreichem Speichern: kein Entwurf und keine Meldung mehr. */
    gespeichert() { entfernen(schluessel); setGefunden(null); setMeldung(undefined); },
    /**
     * Nach „Verwerfen“: keine Konflikte mehr; wartet ein fremdes Speichern,
     * kommt dessen Stand ins Formular.
     */
    verworfen() {
      const { fremd } = aktuell.current;
      if (fremd?.daten) aktuell.current.uebernehmen(fremd.daten);
      if (!fremd?.geloescht) setFremd(undefined);
      setKonflikte([]); setMeldung(undefined);
    },
    /**
     * Nach einem abgelehnten Speichern: mit dem aktuellen Stand zusammenführen.
     * Eine Rücknahme schreibt nicht den Entwurf; dann nur den neuen Stand übernehmen.
     */
    async nachKonflikt({ ruecknahme = false } = {}) {
      const snap = await getDoc(ref);
      if (!snap.exists()) { setFremd({ geloescht: true }); return; }
      if (ruecknahme) {
        aktuell.current.uebernehmen(snap.data());
        setMeldung("Inzwischen woanders gespeichert; der neue Stand ist übernommen. Bitte im Verlauf erneut zurücknehmen.");
        return;
      }
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
