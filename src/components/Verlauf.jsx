import { useEffect, useState } from "react";
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { darf } from "../werkverzeichnis/permissions.js";
import { db, KUENSTLER } from "./firebaseClient.js";
import { FARBE, HOECHSTENS, netto, SEITENFELDER, STATUS, werkZuruecksetzen } from "./Veroeffentlichen.jsx";
import Zugang from "./Zugang.jsx";

/**
 * Verlauf der Veröffentlichungen (#88): je Build, wer ihn wann angefordert hat,
 * mit welchem Ergebnis, und was er online gebracht hat. Das sind die Änderungen
 * zwischen dem, was der vorige erfolgreiche Build gelesen hat, und dem, was
 * dieser gelesen hat (`gelesen`, #67). Zurücknehmen setzt Werke und Seiten
 * daraus auf den Stand davor zurück, als neue Änderungen; online geht das mit
 * der nächsten Veröffentlichung.
 */

const ANZAHL = 30;
const knopf = "px-2 py-0.5 border border-gray-400 rounded bg-white disabled:opacity-40";
const wann = t => t?.toDate().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "…";
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;
const fassung = ({ titel, kategorie, reihenfolge, text }) => ({ titel, kategorie, reihenfolge, text });
const gleich = (a, b) => (!a && !b) || (!!a && !!b && Object.keys(SEITENFELDER).every(k => a[k] === b[k]));

export default function VerlaufSeite() {
  return <Zugang berechtigung="veroeffentlichen" kinder={({ nutzer, wer }) =>
    <Verlauf kuenstlerId={KUENSTLER} ich={nutzer.email}
             darfWerke={darf(wer, "werke.bearbeiten")} darfSeiten={darf(wer, "seiten.bearbeiten")} />} />;
}

/**
 * Anfragen, die derselbe Build erledigt hat, gehören zusammen: mehrere wartende,
 * und solche ohne neue Änderungen (`hinweis`), die der vorige Build mit abdeckt.
 */
function nachBuild(anfragen) {
  const builds = new Map();
  for (const a of anfragen) {
    const schluessel = a.buildId ?? a.id;
    const b = builds.get(schluessel) ?? { id: schluessel, anfragen: [] };
    b.anfragen.push(a);
    builds.set(schluessel, b);
  }
  return [...builds.values()].map(b => {
    const haupt = b.anfragen.find(a => !a.hinweis) ?? b.anfragen[0];
    return { ...b, status: haupt.status, gelesen: haupt.gelesen, logUrl: haupt.logUrl, angefordert: haupt.angefordert,
      meldung: haupt.meldung };
  }).sort((x, y) => (y.angefordert?.toMillis() ?? Infinity) - (x.angefordert?.toMillis() ?? Infinity));
}

function Verlauf({ kuenstlerId, ich, darfWerke, darfSeiten }) {
  const [anfragen, setAnfragen] = useState();
  const [fehler, setFehler] = useState();

  useEffect(() => onSnapshot(
    query(collection(db, "artists", kuenstlerId, "veroeffentlichungen"), orderBy("angefordert", "desc"), limit(ANZAHL)),
    snap => setAnfragen(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => setFehler(meldung(e))), [kuenstlerId]);

  if (fehler) return <p className="text-red-700 text-sm">{fehler}</p>;
  if (!anfragen) return <p className="text-sm text-gray-600">Lädt…</p>;
  const builds = nachBuild(anfragen);
  if (!builds.length) return <p className="text-sm">Noch nie veröffentlicht.</p>;

  // Der Zeitraum eines erfolgreichen Builds beginnt, wo der vorige erfolgreiche aufhörte.
  const erfolgreich = builds.filter(b => b.status === "fertig" && b.gelesen);
  const vorher = b => erfolgreich[erfolgreich.indexOf(b) + 1]?.gelesen;

  return (
    <div className="space-y-2 text-sm">
      <p className="text-gray-600">
        Die letzten {ANZAHL} Veröffentlichungen. Zurücknehmen setzt Werke und Seiten auf den Stand davor zurück;
        online geht das erst mit der nächsten Veröffentlichung.
      </p>
      <ul className="divide-y">
        {builds.map(b => (
          <Build key={b.id} b={b} seit={erfolgreich.includes(b) ? vorher(b) : undefined} kuenstlerId={kuenstlerId}
                 ich={ich} darfWerke={darfWerke} darfSeiten={darfSeiten} />
        ))}
      </ul>
    </div>
  );
}

function Build({ b, seit, kuenstlerId, ich, darfWerke, darfSeiten }) {
  const [auf, setAuf] = useState(false);
  const erfolgreich = b.status === "fertig" && b.gelesen;
  return (
    <li className="py-2">
      <div className="flex flex-wrap gap-x-2 items-baseline">
        <span className="text-gray-600">{wann(b.angefordert)}</span>
        <span className={FARBE[b.status] ?? ""}>{STATUS[b.status] ?? b.status}</span>
        {b.logUrl && <a className="underline" href={b.logUrl} target="_blank" rel="noreferrer">Log</a>}
        {erfolgreich && seit && (
          <button className="underline ml-auto" aria-expanded={auf} onClick={() => setAuf(!auf)}>
            {auf ? "Zuklappen" : "Was ging online?"}
          </button>
        )}
      </div>
      <ul className="pl-4">
        {b.anfragen.map(a => (
          <li key={a.id}>
            {a.von}
            {a.notiz && <span className="italic break-words"> · „{a.notiz}“</span>}
            {a.hinweis && <span className="text-gray-600"> · {a.hinweis}</span>}
          </li>
        ))}
      </ul>
      {b.meldung && <p className="pl-4 text-red-700">{b.meldung}</p>}
      {b.status === "fehler" && <p className="pl-4 text-gray-600">Nichts online gegangen; die Änderungen kommen mit der nächsten Veröffentlichung.</p>}
      {erfolgreich && !seit && <p className="pl-4 text-gray-600">Was davor lag, ist hier nicht mehr abgegrenzt.</p>}
      {auf && <Inhalt kuenstlerId={kuenstlerId} ich={ich} von={seit} bis={b.gelesen}
                      darfWerke={darfWerke} darfSeiten={darfSeiten} />}
    </li>
  );
}

/** Was zwischen `von` (ausschließlich) und `bis` (einschließlich) geändert wurde. */
async function aenderungen(kuenstlerId, von, bis) {
  const zwischen = (c, feld) => getDocs(query(collection(db, "artists", kuenstlerId, c),
    where(feld, ">", von), where(feld, "<=", bis), orderBy(feld), limit(HOECHSTENS + 1)))
    .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
  const [history, seitenverlauf, werkgruppen, medien, kuenstler] = await Promise.all([
    zwischen("history", "at"), zwischen("seitenverlauf", "at"), zwischen("werkgruppen", "updatedAt"),
    zwischen("medien", "erstellt").catch(() => []), getDoc(doc(db, "artists", kuenstlerId))]);
  const t = kuenstler.get("updatedAt")?.toMillis();
  return { history, seitenverlauf, werkgruppen, medien,
    einstellungen: t > von.toMillis() && t <= bis.toMillis(),
    zuViele: [history, seitenverlauf, werkgruppen, medien].some(l => l.length > HOECHSTENS) };
}

/**
 * Setzt eine Seite auf ihre Fassung vor dem Zeitraum zurück (angelegt → gelöscht,
 * gelöscht → wieder da), mit Eintrag in `seitenverlauf` wie Seiten.jsx. Nur,
 * wenn sie noch so ist, wie der Zeitraum sie hinterlassen hat.
 */
async function seiteZuruecksetzen(kuenstlerId, ich, s) {
  const ref = doc(db, "artists", kuenstlerId, "seiten", s.seite);
  const verlauf = collection(db, "artists", kuenstlerId, "seitenverlauf");
  return runTransaction(db, async tx => {
    const jetzt = await tx.get(ref);
    const ist = jetzt.exists() ? fassung(jetzt.data()) : null;
    if (!gleich(ist, s.nachher)) return false;
    if (!s.vorher) {
      // Feste Kennung, damit die Regeln den Eintrag zum Löschen finden.
      const eintrag = doc(verlauf, "geloescht-" + (jetzt.get("lastChange") ?? s.seite));
      tx.set(eintrag, { seite: s.seite, by: ich, at: serverTimestamp(), vorher: ist, nachher: null });
      tx.delete(ref);
    } else {
      const eintrag = doc(verlauf);
      const alt = fassung(s.vorher);
      tx.set(eintrag, { seite: s.seite, by: ich, at: serverTimestamp(), vorher: ist, nachher: alt });
      tx.set(ref, { ...alt, updatedAt: serverTimestamp(), lastChange: eintrag.id });
    }
    return true;
  });
}

function Inhalt({ kuenstlerId, ich, von, bis, darfWerke, darfSeiten }) {
  const [a, setA] = useState();
  const [fehler, setFehler] = useState();
  const [ergebnis, setErgebnis] = useState();
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => { aenderungen(kuenstlerId, von, bis).then(setA, e => setFehler(meldung(e))); }, [kuenstlerId, von, bis]);

  if (fehler) return <p className="pl-4 text-red-700">{fehler}</p>;
  if (!a) return <p className="pl-4 text-gray-600">Lädt…</p>;
  if (a.zuViele) return <p className="pl-4 text-gray-600">Über {HOECHSTENS} Änderungen, zu viele für eine Übersicht hier.</p>;
  const n = netto(a.history, a.seitenverlauf);
  const leer = !n.werke.length && !n.seiten.length && !a.werkgruppen.length && !a.medien.length && !a.einstellungen;
  const zuruecknehmbar = (darfWerke && n.werke.length) || (darfSeiten && n.seiten.length);

  async function zuruecknehmen() {
    const teile = [darfWerke && n.werke.length && `${n.werke.length} Werk(e)`,
      darfSeiten && n.seiten.length && `${n.seiten.length} Seite(n)`].filter(Boolean);
    if (!window.confirm(`${teile.join(" und ")} auf den Stand vor dieser Veröffentlichung zurücksetzen?\n\n`
      + "Was seitdem noch einmal geändert wurde, bleibt. Online geht es mit der nächsten Veröffentlichung.")) return;
    setLaeuft(true); setFehler(undefined); setErgebnis(undefined);
    let zurueck = 0, geblieben = 0;
    try {
      for (const w of darfWerke ? n.werke : []) {
        if ((await werkZuruecksetzen(kuenstlerId, ich, w)).length) zurueck++; else geblieben++;
      }
      for (const s of darfSeiten ? n.seiten : []) {
        if (await seiteZuruecksetzen(kuenstlerId, ich, s)) zurueck++; else geblieben++;
      }
    } catch (e) {
      setFehler(meldung(e));
    }
    setLaeuft(false);
    setErgebnis(`${zurueck} zurückgesetzt${geblieben ? `, ${geblieben} inzwischen erneut geändert und geblieben` : ""}.`
      + " Online geht es mit der nächsten Veröffentlichung.");
  }

  const seitenName = s => s.nachher?.titel ?? s.vorher?.titel ?? s.seite;
  return (
    <div className="pl-4 pt-1 space-y-1">
      {leer && <p className="text-gray-600">Keine Änderungen gefunden.</p>}
      <ul className="space-y-0.5">
        {n.werke.map(w => <li key={"w" + w.werk}>Werk {w.werk}: {Object.keys(w.felder).join(", ")} · {[...w.von].join(", ")}</li>)}
        {n.seiten.map(s => (
          <li key={"s" + s.seite}>
            Seite „{seitenName(s)}“{" "}
            {!s.vorher ? "angelegt" : !s.nachher ? "gelöscht"
              : Object.keys(SEITENFELDER).filter(k => s.vorher[k] !== s.nachher[k]).map(k => SEITENFELDER[k]).join(", ")}
            {" "}· {[...s.von].join(", ")}
          </li>
        ))}
        {a.werkgruppen.map(g => <li key={"g" + g.id}>Werkgruppe „{g.titel || g.id}“ <span className="text-gray-600">(ohne Verlauf)</span></li>)}
        {a.medien.map(m => <li key={"m" + m.id}>Bild verarbeitet: {m.original?.split("/").pop() ?? m.id}</li>)}
        {a.einstellungen && <li>Einstellungen oder Personen <span className="text-gray-600">(ohne Verlauf)</span></li>}
      </ul>
      {zuruecknehmbar ? (
        <p className="flex flex-wrap gap-2 items-center">
          <button className={knopf} disabled={laeuft} onClick={zuruecknehmen}>{laeuft ? "Setzt zurück…" : "Zurücknehmen"}</button>
          {(a.werkgruppen.length > 0 || a.einstellungen) && (
            <span className="text-gray-600">Werkgruppen und Einstellungen haben keinen Verlauf; die bleiben.</span>
          )}
        </p>
      ) : null}
      {ergebnis && <p className="text-green-700">{ergebnis}</p>}
    </div>
  );
}
