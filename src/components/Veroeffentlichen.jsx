import { useEffect, useRef, useState } from "react";
import {
  addDoc, collection, deleteField, doc, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, where,
} from "firebase/firestore";
import { db } from "./firebaseClient.js";

/**
 * Änderungen gehen erst online, wenn jemand auf Veröffentlichen drückt: Das legt
 * eine Anfrage an, und gcf/publish.js baut und deployt die Seite (cloudbuild.yaml).
 * Die Liste folgt den Anfragen live.
 */

export const STATUS = {
  angefordert: "angefordert", wartet: "wartet auf laufenden Build", läuft: "läuft …",
  fertig: "veröffentlicht", fehler: "fehlgeschlagen",
};
export const FARBE = { fertig: "text-green-700", fehler: "text-red-700" };
export const LAEUFT = ["angefordert", "wartet", "läuft"];
/** Dreht sich, solange eine Veröffentlichung läuft (#86). */
export const Dreht = () => <span aria-hidden="true" className="inline-block w-3 h-3 mr-1.5 align-[-1px] rounded-full border-2 border-gray-300 border-t-gray-700 animate-spin motion-reduce:[animation-duration:3s]" />;
const knopfKlein = "px-2 py-0.5 border border-gray-400 rounded bg-white disabled:opacity-40";
export const HOECHSTENS = 100;
export const NOTIZ_LAENGE = 500;   // wie in firestore.rules
export const anzahl = n => n > HOECHSTENS ? `über ${HOECHSTENS}` : n;
const wann = t => t?.toDate().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "…";
const zeit = t => t?.toMillis() ?? Infinity;   // noch ohne Serverzeit: gerade eben
export const SEITENFELDER = { titel: "Titel", kategorie: "Ort", reihenfolge: "Reihe", text: "Text" };

/**
 * Was netto seit der letzten Veröffentlichung geändert ist (#67): je Werk der
 * Stand vor dem ersten Eintrag gegen den nach dem letzten, je Feld. Felder, die
 * wieder beim veröffentlichten Wert sind, zählen nicht; ein Werk ohne solche
 * Felder fällt heraus. Ebenso Seiten, über ihre ganzen Fassungen.
 */
export function netto(history, seitenverlauf) {
  const werke = new Map();
  for (const h of [...history].sort((a, b) => zeit(a.at) - zeit(b.at))) {
    const w = werke.get(h.work) ?? { werk: h.work, felder: {}, von: new Set() };
    for (const [f, c] of Object.entries(h.changes ?? {})) {
      w.felder[f] = { from: f in w.felder ? w.felder[f].from : c.from ?? null, to: c.to ?? null };
    }
    w.von.add(h.by);
    w.t = h.at;
    werke.set(h.work, w);
  }
  for (const w of werke.values()) {
    for (const [f, c] of Object.entries(w.felder)) if (c.from === c.to) delete w.felder[f];
  }

  const seiten = new Map();
  for (const e of [...seitenverlauf].sort((a, b) => zeit(a.at) - zeit(b.at))) {
    const s = seiten.get(e.seite) ?? { seite: e.seite, vorher: e.vorher, von: new Set() };
    s.nachher = e.nachher;
    s.von.add(e.by);
    s.t = e.at;
    seiten.set(e.seite, s);
  }
  const gleich = (a, b) => (!a && !b) || (a && b && Object.keys(SEITENFELDER).every(k => a[k] === b[k]));

  return {
    werke: [...werke.values()].filter(w => Object.keys(w.felder).length),
    seiten: [...seiten.values()].filter(s => !gleich(s.vorher, s.nachher)),
  };
}

/**
 * Setzt die netto geänderten Felder eines Werks (aus netto()) auf ihren Wert
 * davor zurück, als neue Änderung mit Verlaufseintrag. Felder, deren Wert sich
 * inzwischen noch einmal geändert hat, bleiben. Gibt die zurückgesetzten Felder.
 */
export async function werkZuruecksetzen(kuenstlerId, ich, w) {
  const ref = doc(db, "artists", kuenstlerId, "works", w.werk);
  const eintrag = doc(collection(db, "artists", kuenstlerId, "history"));
  return runTransaction(db, async tx => {
    const daten = (await tx.get(ref)).data() ?? {};
    const zurueck = Object.entries(w.felder).filter(([f, c]) => (daten[f] ?? null) === c.to);
    if (!zurueck.length) return [];
    tx.set(eintrag, { work: w.werk, by: ich, at: serverTimestamp(), zurueckgesetzt: true,
      changes: Object.fromEntries(zurueck.map(([f, c]) => [f, { from: c.to, to: c.from }])) });
    tx.update(ref, {
      ...Object.fromEntries(zurueck.map(([f, c]) => [f, c.from ?? deleteField()])),
      updatedAt: serverTimestamp(),
      lastChange: eintrag.id,
    });
    return zurueck.map(([f]) => f);
  });
}

/** Der Stand der Veröffentlichung, live; geteilt von Verwaltung und Werkzeugleiste. */
export function useVeroeffentlichung(kuenstlerId, ich) {
  const [liste, setListe] = useState();
  const [zuletzt, setZuletzt] = useState();  // null: nie veröffentlicht
  const [aenderungen, setAenderungen] = useState();
  const [fehler, setFehler] = useState();
  const sammlung = collection(db, "artists", kuenstlerId, "veroeffentlichungen");

  useEffect(() => onSnapshot(query(sammlung, orderBy("angefordert", "desc"), limit(5)),
    snap => setListe(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => setFehler(e.message)), [kuenstlerId]);

  // Welchen Stand der letzte erfolgreiche Build gelesen hat; eigens abgefragt,
  // denn er kann älter sein als die fünf gelisteten Anfragen. `gelesen` meldet
  // der Build selbst (#67); ältere Anfragen haben nur `gestartet`, das etwas zu
  // früh liegt: Was kurz danach gespeichert wurde, ist schon online.
  useEffect(() => onSnapshot(query(sammlung, where("status", "==", "fertig"), orderBy("gestartet", "desc"), limit(1)),
    snap => setZuletzt(snap.docs[0]?.get("gelesen") ?? snap.docs[0]?.get("gestartet") ?? null),
    e => setFehler(e.message)), [kuenstlerId]);

  // Änderungen seitdem, live, damit das Speichern einer Seite sie aktualisiert;
  // höchstens HOECHSTENS + 1 werden gelesen.
  useEffect(() => {
    if (zuletzt === undefined) return;
    setAenderungen({});
    const seit = (c, feld, nachsichtig = false) => onSnapshot(
      query(collection(db, "artists", kuenstlerId, c), ...(zuletzt ? [where(feld, ">", zuletzt)] : []),
        orderBy(feld, "desc"), limit(HOECHSTENS + 1)),
      snap => setAenderungen(a => ({ ...a, [c]: snap.docs.map(d => ({ id: d.id, ...d.data() })) })),
      // Bildeinträge dürfen erst die Regeln aus #4 lesen; bis die deployt sind, ohne sie.
      e => nachsichtig ? setAenderungen(a => ({ ...a, [c]: [] })) : setFehler(e.message));
    // Die Einstellungen der Künstler:in (Titel, Copyright) baut catalog.ts mit ein.
    // updatedAt ändert sich auch bei Rollen; dann zählt eine Änderung zu viel.
    const einstellungen = onSnapshot(doc(db, "artists", kuenstlerId), d => {
      const t = d.get("updatedAt");
      setAenderungen(a => ({ ...a, einstellungen:
        t && (!zuletzt || t.toMillis() > zuletzt.toMillis()) ? [{ id: "einstellungen", updatedAt: t }] : [] }));
    }, e => setFehler(e.message));
    // Seiten über ihren Verlauf (#41), damit auch gelöschte zählen (#2).
    // Bilder, die die Bildfunktion erst nach dem letzten Build fertig hatte (#4).
    const beenden = [seit("history", "at"), seit("seitenverlauf", "at"), seit("werkgruppen", "updatedAt"),
      seit("medien", "erstellt", true), einstellungen];
    return () => beenden.forEach(f => f());
  }, [kuenstlerId, zuletzt]);

  const geladen = ["history", "seitenverlauf", "werkgruppen", "medien", "einstellungen"].every(c => aenderungen?.[c] !== undefined);
  // Mehr als HOECHSTENS Einträge sind nicht alle gelesen; dann nur „über …“.
  const zuViele = geladen && Object.values(aenderungen).some(l => l.length > HOECHSTENS);
  // Unvollständig gelesen ergäbe netto() einen falschen veröffentlichten Stand,
  // und Zurücksetzen schriebe ihn ins Werk.
  const n = geladen && !zuViele && netto(aenderungen.history, aenderungen.seitenverlauf);
  const offen = !geladen ? undefined : zuViele ? HOECHSTENS + 1
    : n.werke.length + n.seiten.length + aenderungen.werkgruppen.length + aenderungen.medien.length
      + aenderungen.einstellungen.length;
  // „wartet“ heißt: Ein Build läuft schon, diese Anfrage kommt danach.
  const beschaeftigt = liste?.some(v => LAEUFT.includes(v.status));

  /** Legt die Anfrage an; eine Notiz (#48) wird nur mitgeschickt, wenn es eine gibt. */
  async function veroeffentlichen(notiz = "") {
    setFehler(undefined);
    notiz = notiz.trim();
    try {
      await addDoc(sammlung, { von: ich, angefordert: serverTimestamp(), status: "angefordert",
        ...(notiz ? { notiz } : {}) });
      return true;
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
      return false;
    }
  }

  /** Setzt ein Werk auf den veröffentlichten Stand zurück (werkZuruecksetzen). */
  async function zuruecksetzen(w) {
    setFehler(undefined);
    try {
      return await werkZuruecksetzen(kuenstlerId, ich, w);
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    }
  }

  return { liste, zuletzt, aenderungen: geladen ? aenderungen : undefined, netto: n || undefined, zuViele, offen, fehler,
    beschaeftigt, veroeffentlichen, zuruecksetzen };
}

/**
 * Der Stand für Werkzeugleiste und Verwaltungskopf: offene Änderungen, läuft,
 * fehlgeschlagen oder alles veröffentlicht, mit dem Knopf für Admins. Ein Klick
 * auf den Stand klappt die Einzelheiten auf (Tafel), nach oben in der Leiste
 * unten, nach unten im Kopf. „Veröffentlichen“ klappt sie mit einem Feld für
 * eine Notiz auf; erst der Knopf dort legt die Anfrage an.
 */
export function Stand({ kuenstlerId, ich, erlaubt, darfWerke = false, darfSeiten = false, nachOben = false, className = "" }) {
  const v = useVeroeffentlichung(kuenstlerId, ich);
  const { liste, offen: n, fehler, beschaeftigt, veroeffentlichen } = v;
  const letzte = liste?.[0];
  // Ohne Änderungen seit dem letzten Build ist der Knopf aus (#4); nach einem
  // Fehler bleibt er an. Für den Notfall (z. B. ein kaputter Build nach Push)
  // bietet die Tafel „Trotzdem veröffentlichen“.
  const nichtsZuTun = n === 0 && letzte?.status !== "fehler";
  const [auf, setAuf] = useState(false);
  const [fragen, setFragen] = useState(false);   // Tafel mit Notizfeld
  const ref = useRef();

  useEffect(() => {
    if (!auf) { setFragen(false); return; }
    const schliessen = e => { if (e.key === "Escape" || (e.type === "pointerdown" && !ref.current.contains(e.target))) setAuf(false); };
    document.addEventListener("pointerdown", schliessen);
    document.addEventListener("keydown", schliessen);
    return () => {
      document.removeEventListener("pointerdown", schliessen);
      document.removeEventListener("keydown", schliessen);
    };
  }, [auf]);

  return (
    <span ref={ref} className={`relative flex items-center gap-2 ${className}`}>
      <button className="hover:underline text-left" aria-expanded={auf} onClick={() => setAuf(!auf)}>
        {fehler ? <span className="text-red-700">{fehler}</span>
          : beschaeftigt ? <span><Dreht />Veröffentlichung läuft …</span>
          : letzte?.status === "fehler" ? <span className="text-red-700">Letzte Veröffentlichung fehlgeschlagen</span>
          : n === undefined ? <span>…</span>
          : n === 0 ? <span className="text-green-700">Alles veröffentlicht</span>
          : <span>● {anzahl(n)} offene Änderung{n === 1 ? "" : "en"}</span>}
        {" "}<span className="text-gray-600">{auf === nachOben ? "▾" : "▴"}</span>
      </button>
      {erlaubt && (
        <button className={knopfKlein} onClick={() => { setAuf(true); setFragen(true); }}
                disabled={!liste || (auf && fragen) || nichtsZuTun}
                title={nichtsZuTun ? "Keine offenen Änderungen" : undefined}>Veröffentlichen</button>
      )}
      {auf && (
        <div className={"absolute z-50 w-[min(32rem,calc(100vw-2rem))] max-h-[60vh] overflow-auto p-3 "
          + "bg-white text-black border border-gray-400 rounded shadow-lg text-sm "
          + (nachOben ? "bottom-full left-0 mb-2" : "top-full right-0 mt-2")}>
          {fragen && <Notiz {...v} fertig={() => setAuf(false)} />}
          <Tafel {...v} darfWerke={darfWerke} darfSeiten={darfSeiten}
                 trotzdem={erlaubt && nichtsZuTun && !fragen ? () => setFragen(true) : undefined} />
        </div>
      )}
    </span>
  );
}

/** Notiz eingeben und die Anfrage abschicken. */
function Notiz({ veroeffentlichen, beschaeftigt, fertig }) {
  const [notiz, setNotiz] = useState("");
  const [sendet, setSendet] = useState(false);
  async function senden(e) {
    e.preventDefault();
    setSendet(true);
    if (await veroeffentlichen(notiz)) fertig();
    else setSendet(false);
  }
  return (
    <form className="mb-3 pb-3 border-b space-y-2" onSubmit={senden}>
      <label className="block">
        <span className="font-bold">Notiz (freiwillig)</span>
        <input className="border border-gray-400 rounded p-1 w-full bg-white text-black" autoFocus maxLength={NOTIZ_LAENGE}
               placeholder="z. B. Neue Werkgruppe" value={notiz}
               onChange={e => setNotiz(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <button className={knopfKlein} disabled={sendet}>Jetzt veröffentlichen</button>
        <button type="button" className="underline" onClick={fertig}>Abbrechen</button>
        {beschaeftigt && <span className="text-gray-600">Läuft gerade; kommt danach dran.</span>}
      </div>
    </form>
  );
}

/** Was seit der letzten Veröffentlichung geändert wurde, und die letzten Veröffentlichungen. */
function Tafel({ liste, zuletzt, aenderungen, netto, zuViele, fehler, darfWerke, darfSeiten, zuruecksetzen, trotzdem }) {
  const [laeuft, setLaeuft] = useState();   // Werk, das gerade zurückgesetzt wird
  const [hinweis, setHinweis] = useState();
  const von = s => [...s].join(", ");

  async function zurueck(w) {
    const text = ["Auf den veröffentlichten Stand zurücksetzen?", "",
      ...Object.entries(w.felder).map(([f, c]) => `  ${f}: „${c.to ?? "∅"}“ → „${c.from ?? "∅"}“`)].join("\n");
    if (!window.confirm(text)) return;
    setLaeuft(w.werk); setHinweis(undefined);
    const felder = await zuruecksetzen(w);
    setLaeuft(undefined);
    if (felder) setHinweis(felder.length
      ? `Werk ${w.werk} zurückgesetzt (${felder.join(", ")}).`
      : `Werk ${w.werk}: inzwischen erneut geändert, nichts zurückgesetzt.`);
  }

  const zeilen = netto && [
    ...netto.werke.map(w => ({ id: "w" + w.werk, t: w.t,
      text: <>
        {darfWerke
          ? <a className="underline" href={`/verwaltung/werke/?werk=${encodeURIComponent(w.werk)}`}>Werk {w.werk}</a>
          : <>Werk {w.werk}</>}
        : {Object.keys(w.felder).join(", ")} · {von(w.von)}
        {darfWerke && <> · <button className="underline disabled:opacity-40" disabled={!!laeuft}
          onClick={() => zurueck(w)}>{laeuft === w.werk ? "setzt zurück…" : "Zurücksetzen"}</button></>}
      </> })),
    ...netto.seiten.map(s => ({ id: "s" + s.seite, t: s.t,
      text: <>
        {s.nachher && darfSeiten
          ? <a className="underline" href={`/verwaltung/seiten/?seite=${encodeURIComponent(s.seite)}`}>Seite „{s.nachher.titel}“</a>
          : <>Seite „{s.nachher?.titel ?? s.vorher?.titel ?? s.seite}“</>}
        {" "}{!s.vorher ? "angelegt" : !s.nachher ? "gelöscht"
          : Object.keys(SEITENFELDER).filter(k => s.vorher[k] !== s.nachher[k]).map(k => SEITENFELDER[k]).join(", ")}
        {" "}· {von(s.von)}
      </> })),
    ...aenderungen.werkgruppen.slice(0, HOECHSTENS).map(g => ({ id: "g" + g.id, t: g.updatedAt,
      text: <>Werkgruppe „{g.titel || g.id}“</> })),
    ...aenderungen.medien.slice(0, HOECHSTENS).map(m => ({ id: "m" + m.id, t: m.erstellt,
      text: <>Bild verarbeitet: {m.original?.split("/").pop() ?? m.id}{m.art === "fehler" && <span className="text-red-700"> (nicht lesbar)</span>}</> })),
    ...aenderungen.einstellungen.map(e => ({ id: "e", t: e.updatedAt, text: <>Einstellungen oder Personen</> })),
  ].sort((a, b) => (b.t?.toMillis() ?? 0) - (a.t?.toMillis() ?? 0));

  return (
    <div className="space-y-3">
      {fehler && <p className="text-red-700">{fehler}</p>}
      {hinweis && <p className="text-green-700">{hinweis}</p>}
      <div>
        <h3 className="font-bold">
          {zuletzt ? `Seit der letzten Veröffentlichung (${wann(zuletzt)})` : "Noch nie veröffentlicht"}
        </h3>
        {zuViele ? <p className="text-gray-600">Über {HOECHSTENS} Änderungen, zu viele für eine Übersicht hier.</p>
          : !zeilen ? <p>…</p> : !zeilen.length ? (
            <p className="text-gray-600">
              Keine offenen Änderungen; die Website ist auf dem Stand.
              {trotzdem && <> <button className="underline" onClick={trotzdem}>Trotzdem veröffentlichen</button></>}
            </p>
          ) : (
          <ul className="space-y-0.5">
            {zeilen.map(z => <li key={z.id}><span className="text-gray-600">{wann(z.t)}</span> · {z.text}</li>)}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-bold">Letzte Veröffentlichungen</h3>
        {!liste?.length ? <p className="text-gray-600">Noch keine.</p> : (
          <ul className="space-y-0.5">
            {liste.map(v => (
              <li key={v.id}>
                <span className="text-gray-600">{wann(v.angefordert)}</span> · {v.von} ·{" "}
                <span className={FARBE[v.status] ?? ""}>{LAEUFT.includes(v.status) && <Dreht />}{STATUS[v.status] ?? v.status}</span>
                {v.meldung && <span className="text-red-700"> ({v.meldung})</span>}
                {v.hinweis && <span className="text-gray-600"> ({v.hinweis})</span>}
                {v.logUrl && <> · <a className="underline" href={v.logUrl} target="_blank" rel="noreferrer">Log</a></>}
                {v.notiz && <div className="pl-4 italic break-words">„{v.notiz}“</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
