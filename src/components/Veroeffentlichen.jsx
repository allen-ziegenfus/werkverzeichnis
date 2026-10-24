import { useEffect, useRef, useState } from "react";
import {
  addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, where,
} from "firebase/firestore";
import { db } from "./firebaseClient.js";

/**
 * Änderungen gehen erst online, wenn jemand auf Veröffentlichen drückt: Das legt
 * eine Anfrage an, und gcf/publish.js baut und deployt die Seite (cloudbuild.yaml).
 * Die Liste folgt den Anfragen live.
 */

const STATUS = {
  angefordert: "angefordert", wartet: "wartet auf laufenden Build", läuft: "läuft …",
  fertig: "veröffentlicht", fehler: "fehlgeschlagen",
};
const FARBE = { fertig: "text-green-700", fehler: "text-red-700" };
const knopfKlein = "px-2 py-0.5 border border-gray-400 rounded bg-white disabled:opacity-40";
export const HOECHSTENS = 100;
export const anzahl = n => n > HOECHSTENS ? `über ${HOECHSTENS}` : n;
const wann = t => t?.toDate().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "…";

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

  // Wann der letzte erfolgreiche Build gestartet ist; eigens abgefragt, denn er
  // kann älter sein als die fünf gelisteten Anfragen.
  useEffect(() => onSnapshot(query(sammlung, where("status", "==", "fertig"), orderBy("gestartet", "desc"), limit(1)),
    snap => setZuletzt(snap.docs[0]?.get("gestartet") ?? null),
    e => setFehler(e.message)), [kuenstlerId]);

  // Änderungen seitdem, live, damit das Speichern einer Seite sie aktualisiert;
  // höchstens HOECHSTENS + 1 werden gelesen.
  useEffect(() => {
    if (zuletzt === undefined) return;
    setAenderungen({});
    const seit = (c, feld) => onSnapshot(
      query(collection(db, "artists", kuenstlerId, c), ...(zuletzt ? [where(feld, ">", zuletzt)] : []),
        orderBy(feld, "desc"), limit(HOECHSTENS + 1)),
      snap => setAenderungen(a => ({ ...a, [c]: snap.docs.map(d => ({ id: d.id, ...d.data() })) })),
      e => setFehler(e.message));
    // Die Einstellungen der Künstler:in (Titel, Copyright) baut catalog.ts mit ein.
    // updatedAt ändert sich auch bei Rollen; dann zählt eine Änderung zu viel.
    const einstellungen = onSnapshot(doc(db, "artists", kuenstlerId), d => {
      const t = d.get("updatedAt");
      setAenderungen(a => ({ ...a, einstellungen:
        t && (!zuletzt || t.toMillis() > zuletzt.toMillis()) ? [{ id: "einstellungen", updatedAt: t }] : [] }));
    }, e => setFehler(e.message));
    const beenden = [seit("history", "at"), seit("seiten", "updatedAt"), seit("werkgruppen", "updatedAt"), einstellungen];
    return () => beenden.forEach(f => f());
  }, [kuenstlerId, zuletzt]);

  const geladen = ["history", "seiten", "werkgruppen", "einstellungen"].every(c => aenderungen?.[c] !== undefined);
  const offen = geladen ? Object.values(aenderungen).reduce((n, l) => n + l.length, 0) : undefined;
  // „wartet“ heißt: Ein Build läuft schon, diese Anfrage kommt danach.
  const beschaeftigt = liste?.some(v => ["angefordert", "wartet", "läuft"].includes(v.status));

  async function veroeffentlichen() {
    setFehler(undefined);
    try {
      await addDoc(sammlung, { von: ich, angefordert: serverTimestamp(), status: "angefordert" });
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    }
  }

  return { liste, zuletzt, aenderungen: geladen ? aenderungen : undefined, offen, fehler, beschaeftigt, veroeffentlichen };
}

/**
 * Der Stand für Werkzeugleiste und Verwaltungskopf: offene Änderungen, läuft,
 * fehlgeschlagen oder alles veröffentlicht, mit dem Knopf für Admins. Ein Klick
 * auf den Stand klappt die Einzelheiten auf (Tafel), nach oben in der Leiste
 * unten, nach unten im Kopf.
 */
export function Stand({ kuenstlerId, ich, erlaubt, nachOben = false, className = "" }) {
  const v = useVeroeffentlichung(kuenstlerId, ich);
  const { liste, offen: n, fehler, beschaeftigt, veroeffentlichen } = v;
  const letzte = liste?.[0];
  const [auf, setAuf] = useState(false);
  const ref = useRef();

  useEffect(() => {
    if (!auf) return;
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
          : beschaeftigt ? <span>Veröffentlichung läuft …</span>
          : letzte?.status === "fehler" ? <span className="text-red-700">Letzte Veröffentlichung fehlgeschlagen</span>
          : n === undefined ? <span>…</span>
          : n === 0 ? <span className="text-green-700">Alles veröffentlicht</span>
          : <span>● {anzahl(n)} offene Änderung{n === 1 ? "" : "en"}</span>}
        {" "}<span className="text-gray-600">{auf === nachOben ? "▾" : "▴"}</span>
      </button>
      {erlaubt && (
        <button className={knopfKlein} onClick={veroeffentlichen} disabled={!liste}>Veröffentlichen</button>
      )}
      {auf && (
        <div className={"absolute z-50 w-[min(32rem,calc(100vw-2rem))] max-h-[60vh] overflow-auto p-3 "
          + "bg-white text-black border border-gray-400 rounded shadow-lg text-sm "
          + (nachOben ? "bottom-full left-0 mb-2" : "top-full right-0 mt-2")}>
          <Tafel {...v} />
        </div>
      )}
    </span>
  );
}

/** Was seit der letzten Veröffentlichung geändert wurde, und die letzten Veröffentlichungen. */
function Tafel({ liste, zuletzt, aenderungen, fehler }) {
  const zeilen = aenderungen && [
    ...aenderungen.history.slice(0, HOECHSTENS).map(h => ({ id: "h" + h.id, t: h.at,
      text: <>Werk {h.work}: {Object.keys(h.changes ?? {}).join(", ") || "—"} · {h.by}</> })),
    ...aenderungen.seiten.slice(0, HOECHSTENS).map(s => ({ id: "s" + s.id, t: s.updatedAt,
      text: <>Seite „{s.titel || s.id}“</> })),
    ...aenderungen.werkgruppen.slice(0, HOECHSTENS).map(g => ({ id: "g" + g.id, t: g.updatedAt,
      text: <>Werkgruppe „{g.titel || g.id}“</> })),
    ...aenderungen.einstellungen.map(e => ({ id: "e", t: e.updatedAt, text: <>Einstellungen oder Personen</> })),
  ].sort((a, b) => (b.t?.toMillis() ?? 0) - (a.t?.toMillis() ?? 0));

  return (
    <div className="space-y-3">
      {fehler && <p className="text-red-700">{fehler}</p>}
      <div>
        <h3 className="font-bold">
          {zuletzt ? `Seit der letzten Veröffentlichung (${wann(zuletzt)})` : "Noch nie veröffentlicht"}
        </h3>
        {!zeilen ? <p>…</p> : !zeilen.length ? <p className="text-gray-600">Keine offenen Änderungen.</p> : (
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
                <span className={FARBE[v.status] ?? ""}>{STATUS[v.status] ?? v.status}</span>
                {v.meldung && <span className="text-red-700"> ({v.meldung})</span>}
                {v.logUrl && <> · <a className="underline" href={v.logUrl} target="_blank" rel="noreferrer">Log</a></>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
