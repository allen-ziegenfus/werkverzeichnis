import { useEffect, useState } from "react";
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
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
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

export default function Veroeffentlichen({ kuenstlerId, ich, erlaubt }) {
  const { liste, zuletzt, aenderungen, fehler, beschaeftigt, veroeffentlichen } =
    useVeroeffentlichung(kuenstlerId, ich);

  return (
    <div className="pt-4 space-y-2">
      <h3 className="text-lg">Veröffentlichen</h3>
      {aenderungen && (
        <details className="text-sm">
          <summary className="cursor-pointer">
            {zuletzt ? `Seit der letzten Veröffentlichung (${wann(zuletzt)}): ` : "Noch nie veröffentlicht. "}
            {anzahl(aenderungen.history.length)} Änderung{aenderungen.history.length === 1 ? "" : "en"} an Werken,{" "}
            {anzahl(aenderungen.seiten.length)} geänderte Seite{aenderungen.seiten.length === 1 ? "" : "n"},{" "}
            {anzahl(aenderungen.werkgruppen.length)} geänderte Werkgruppe{aenderungen.werkgruppen.length === 1 ? "" : "n"}
            {aenderungen.einstellungen.length > 0 && ", Einstellungen geändert"}.
          </summary>
          <ul className="pl-4 pt-1">
            {aenderungen.history.slice(0, HOECHSTENS).map(h => (
              <li key={h.id}>
                {wann(h.at)} · Werk {h.work}: {Object.keys(h.changes ?? {}).join(", ") || "—"} · {h.by}
              </li>
            ))}
            {aenderungen.seiten.slice(0, HOECHSTENS).map(s => (
              <li key={s.id}>{wann(s.updatedAt)} · Seite „{s.titel || s.id}“</li>
            ))}
            {aenderungen.werkgruppen.slice(0, HOECHSTENS).map(g => (
              <li key={g.id}>{wann(g.updatedAt)} · Werkgruppe „{g.titel || g.id}“</li>
            ))}
            {aenderungen.einstellungen.map(e => (
              <li key={e.id}>{wann(e.updatedAt)} · Einstellungen oder Personen</li>
            ))}
          </ul>
        </details>
      )}
      {erlaubt && (
        <button className={knopf} onClick={veroeffentlichen} disabled={!liste}>
          {beschaeftigt ? "Erneut veröffentlichen" : "Veröffentlichen"}
        </button>
      )}
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      <ul className="text-sm">
        {(liste ?? []).map(v => (
          <li key={v.id}>
            {wann(v.angefordert)} · {v.von} ·{" "}
            <span className={FARBE[v.status] ?? ""}>{STATUS[v.status] ?? v.status}</span>
            {v.meldung && <span className="text-red-700"> ({v.meldung})</span>}
            {v.logUrl && <> · <a className="underline" href={v.logUrl} target="_blank" rel="noreferrer">Log</a></>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Kurzer Stand für Werkzeugleiste und Verwaltungskopf: offene Änderungen, läuft,
 * fehlgeschlagen oder alles veröffentlicht, mit dem Knopf für Admins.
 */
export function Stand({ kuenstlerId, ich, erlaubt, className = "" }) {
  const { liste, offen: n, fehler, beschaeftigt, veroeffentlichen } = useVeroeffentlichung(kuenstlerId, ich);
  const letzte = liste?.[0];

  return (
    <span className={`flex items-center gap-2 ${className}`}>
      {fehler ? <span className="text-red-700">{fehler}</span>
        : beschaeftigt ? <span>Veröffentlichung läuft …</span>
        : letzte?.status === "fehler" ? <span className="text-red-700">Letzte Veröffentlichung fehlgeschlagen</span>
        : n === undefined ? <span>…</span>
        : n === 0 ? <span className="text-green-700">Alles veröffentlicht</span>
        : <span>● {n > HOECHSTENS ? `über ${HOECHSTENS}` : n} offene Änderung{n === 1 ? "" : "en"}</span>}
      {erlaubt && (
        <button className={knopfKlein} onClick={veroeffentlichen} disabled={!liste}>Veröffentlichen</button>
      )}
    </span>
  );
}
