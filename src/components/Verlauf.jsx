import { useEffect, useState } from "react";
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { darf } from "../werkverzeichnis/permissions.js";
import { EINSTELLUNGEN, lesen as einstellungenLesen } from "./Einstellungen.jsx";
import { db, KUENSTLER } from "./firebaseClient.js";
import { Dreht, FARBE, HOECHSTENS, LAEUFT, netto, SEITENFELDER, seitenGleich, seitenUnterschiede, STATUS, werkZuruecksetzen } from "./Veroeffentlichen.jsx";
import { werkFeld } from "./werkFeld.js";
import Skelett from "./Skelett.jsx";
import { WERKGRUPPENFELDER, werkgruppenFassung } from "./Werkgruppen.jsx";
import Zugang from "./Zugang.jsx";
import { wann } from "./zeit.js";

/**
 * Verlauf der Veröffentlichungen (#88): je Build, wer ihn wann angefordert hat,
 * mit welchem Ergebnis, und was er online gebracht hat. Das sind die Änderungen
 * zwischen dem, was der vorige erfolgreiche Build gelesen hat, und dem, was
 * dieser gelesen hat (`gelesen`, #67; ältere Anfragen haben nur `gestartet`,
 * das etwas zu früh liegt, #101). Zurücknehmen setzt Werke, Seiten,
 * Werkgruppen und Einstellungen (#106) daraus auf den Stand davor zurück, als
 * neue Änderungen; online geht das mit der nächsten Veröffentlichung.
 */

const ANZAHL = 30;
const zelle = "py-1.5 px-2 align-top border border-gray-300";
const knopf = "px-2 py-0.5 border border-gray-400 rounded bg-white disabled:opacity-40";
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;
const fassung = ({ titel, kategorie, reihenfolge, text }) => ({ titel, kategorie, reihenfolge, text });

export default function VerlaufSeite() {
  return <Zugang berechtigung="veroeffentlichen" kinder={({ nutzer, wer }) =>
    <Verlauf kuenstlerId={KUENSTLER} ich={nutzer.email} darf={{
      werke: darf(wer, "werke.bearbeiten"), seiten: darf(wer, "seiten.bearbeiten"),
      werkgruppen: darf(wer, "werkgruppen.bearbeiten"), einstellungen: darf(wer, "einstellungen.bearbeiten") }} />} />;
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
    return { ...b, status: haupt.status, gelesen: haupt.gelesen ?? haupt.gestartet, ungefaehr: !haupt.gelesen, logUrl: haupt.logUrl, angefordert: haupt.angefordert,
      meldung: haupt.meldung };
  }).sort((x, y) => (y.angefordert?.toMillis() ?? Infinity) - (x.angefordert?.toMillis() ?? Infinity));
}

// Die zuletzt gesehenen Veröffentlichungen, bis der Listener die neuen bringt (#122).
let zuletzt;

function Verlauf({ kuenstlerId, ich, darf }) {
  const [anfragen, setAnfragen] = useState(zuletzt);
  const [fehler, setFehler] = useState();

  useEffect(() => onSnapshot(
    query(collection(db, "artists", kuenstlerId, "veroeffentlichungen"), orderBy("angefordert", "desc"), limit(ANZAHL)),
    snap => setAnfragen(zuletzt = snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => setFehler(meldung(e))), [kuenstlerId]);

  if (fehler) return <p className="text-red-700 text-sm">{fehler}</p>;
  if (!anfragen) return <Skelett />;
  const builds = nachBuild(anfragen);
  if (!builds.length) return <p className="text-sm">Noch nie veröffentlicht.</p>;

  // Der Zeitraum eines erfolgreichen Builds beginnt, wo der vorige erfolgreiche aufhörte.
  const erfolgreich = builds.filter(b => b.status === "fertig" && b.gelesen);
  const davor = b => erfolgreich[erfolgreich.indexOf(b) + 1];

  return (
    <div className="space-y-2 text-sm">
      <p className="text-gray-600">
        Die letzten {ANZAHL} Veröffentlichungen. Zurücknehmen setzt Werke, Seiten, Werkgruppen und Einstellungen auf den Stand davor zurück;
        online geht das erst mit der nächsten Veröffentlichung.
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-gray-600 border-b border-gray-400">
            <th className={zelle + " font-normal"}>Wann, Ergebnis</th>
            <th className={zelle + " font-normal"}>Angefordert von</th>
            <th className={zelle + " font-normal"}><span className="sr-only">Inhalt</span></th>
          </tr>
        </thead>
        <tbody>
          {builds.map(b => (
            <Build key={b.id} b={b} seit={erfolgreich.includes(b) ? davor(b)?.gelesen : undefined}
                   ungefaehr={b.ungefaehr || davor(b)?.ungefaehr} kuenstlerId={kuenstlerId}
                   ich={ich} darf={darf} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Build({ b, seit, ungefaehr, kuenstlerId, ich, darf }) {
  const [auf, setAuf] = useState(false);
  const erfolgreich = b.status === "fertig" && b.gelesen;
  const hinweise = <>
    {b.meldung && <div className="text-red-700">{b.meldung}</div>}
    {b.status === "fehler" && <div className="text-gray-600">Nichts online gegangen; die Änderungen kommen mit der nächsten Veröffentlichung.</div>}
    {erfolgreich && seit && ungefaehr && <div className="text-gray-600">Zeitraum ungefähr: Was kurz nach dem Start gespeichert wurde, kann schon mit diesem Build online gegangen sein.</div>}
    {erfolgreich && !seit && <div className="text-gray-600">Was davor lag, ist hier nicht mehr abgegrenzt.</div>}
  </>;
  return (
    <>
      <tr className={auf ? "" : "border-b"}>
        <td className={zelle}>
          <div className="text-gray-600 whitespace-nowrap">{wann(b.angefordert)}</div>
          <span className={FARBE[b.status] ?? ""}>{LAEUFT.includes(b.status) && <Dreht />}{STATUS[b.status] ?? b.status}</span>
          {b.logUrl && <> · <a className="underline" href={b.logUrl} target="_blank" rel="noreferrer">Log</a></>}
        </td>
        <td className={zelle + " break-words [overflow-wrap:anywhere]"}>
          {b.anfragen.map(a => (
            <div key={a.id}>
              {a.von}
              {a.notiz && <span className="italic"> · „{a.notiz}“</span>}
              {a.hinweis && <span className="text-gray-600"> · {a.hinweis}</span>}
            </div>
          ))}
          {hinweise}
        </td>
        <td className={zelle + " text-right whitespace-nowrap"}>
          {erfolgreich && seit && (
            <button className="underline" aria-expanded={auf} onClick={() => setAuf(!auf)}>
              {auf ? "Zuklappen" : "Was ging online?"}
            </button>
          )}
        </td>
      </tr>
      {auf && (
        <tr className="border-b">
          <td colSpan={3} className="p-2 border border-gray-300">
            <Inhalt kuenstlerId={kuenstlerId} ich={ich} von={seit} bis={b.gelesen} darf={darf} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Was zwischen `von` (ausschließlich) und `bis` (einschließlich) geändert wurde. */
async function aenderungen(kuenstlerId, von, bis) {
  const zwischen = (c, feld) => getDocs(query(collection(db, "artists", kuenstlerId, c),
    where(feld, ">", von), where(feld, "<=", bis), orderBy(feld), limit(HOECHSTENS + 1)))
    .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
  const [history, seitenverlauf, werkgruppen, medien, kuenstler, werkgruppenverlauf, einstellungsverlauf] = await Promise.all([
    zwischen("history", "at"), zwischen("seitenverlauf", "at"), zwischen("werkgruppen", "updatedAt"),
    zwischen("medien", "erstellt").catch(() => []), getDoc(doc(db, "artists", kuenstlerId)),
    zwischen("werkgruppenverlauf", "at"), zwischen("einstellungsverlauf", "at")]);
  const t = kuenstler.get("updatedAt")?.toMillis();
  // Geändert ohne Verlauf (vor #106, Personen, Code ohne Verlauf): wenn
  // updatedAt neuer ist als der letzte Eintrag im Zeitraum.
  const zuletzt = (eintraege, passt) => Math.max(-Infinity,
    ...eintraege.filter(passt).map(e => e.at?.toMillis() ?? -Infinity));
  return { history, seitenverlauf, medien,
    werkgruppen: nettoFassungen(werkgruppenverlauf, e => e.werkgruppe),
    werkgruppenOhne: werkgruppen.filter(g =>
      g.updatedAt?.toMillis() > zuletzt(werkgruppenverlauf, e => e.werkgruppe === g.id)),
    einstellungen: nettoFassungen(einstellungsverlauf, () => "einstellungen")[0],
    kuenstlerGeaendert: t > von.toMillis() && t <= bis.toMillis() && t > zuletzt(einstellungsverlauf, () => true),
    zuViele: [history, seitenverlauf, werkgruppen, medien, werkgruppenverlauf, einstellungsverlauf].some(l => l.length > HOECHSTENS) };
}

const unterschiede = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
  .filter(k => (a?.[k] ?? null) !== (b?.[k] ?? null));

/** Je Schlüssel der Stand vor dem ersten Eintrag gegen den nach dem letzten; ohne Unterschied fällt er heraus. */
function nettoFassungen(eintraege, schluessel) {
  const m = new Map();
  for (const e of [...eintraege].sort((a, b) => (a.at?.toMillis() ?? Infinity) - (b.at?.toMillis() ?? Infinity))) {
    const x = m.get(schluessel(e)) ?? { id: schluessel(e), vorher: e.vorher, von: new Set() };
    x.nachher = e.nachher;
    x.von.add(e.by);
    m.set(x.id, x);
  }
  return [...m.values()].map(x => ({ ...x, felder: unterschiede(x.vorher, x.nachher) })).filter(x => x.felder.length);
}

/**
 * Setzt die netto geänderten Felder einer Werkgruppe bzw. der Einstellungen
 * auf den Wert davor zurück, mit Verlaufseintrag; Felder, die sich inzwischen
 * noch einmal geändert haben, bleiben. Eine angelegte Werkgruppe bleibt (Löschen
 * geht noch nicht). Gibt zurück, ob etwas zurückgesetzt ist.
 */
async function werkgruppeZuruecksetzen(kuenstlerId, ich, g) {
  const ref = doc(db, "artists", kuenstlerId, "werkgruppen", g.id);
  return runTransaction(db, async tx => {
    const ist = werkgruppenFassung((await tx.get(ref)).data());
    if (!ist || !g.vorher) return false;
    const zurueck = g.felder.filter(k => (ist[k] ?? null) === (g.nachher[k] ?? null));
    if (!zurueck.length) return false;
    const werte = Object.fromEntries(zurueck.map(k => [k, g.vorher[k] ?? null]));
    const eintrag = doc(collection(db, "artists", kuenstlerId, "werkgruppenverlauf"));
    tx.set(eintrag, { werkgruppe: g.id, by: ich, at: serverTimestamp(), vorher: ist, nachher: { ...ist, ...werte } });
    tx.update(ref, { ...werte, updatedAt: serverTimestamp(), lastChange: eintrag.id });
    return true;
  });
}

async function einstellungenZuruecksetzen(kuenstlerId, ich, x) {
  const ref = doc(db, "artists", kuenstlerId);
  return runTransaction(db, async tx => {
    const ist = einstellungenLesen((await tx.get(ref)).data() ?? {});
    const zurueck = x.felder.filter(k => ist[k] === x.nachher[k]);
    if (!zurueck.length) return false;
    const werte = Object.fromEntries(zurueck.map(k => [k, x.vorher[k]]));
    const eintrag = doc(collection(ref, "einstellungsverlauf"));
    tx.set(eintrag, { by: ich, at: serverTimestamp(), vorher: ist, nachher: { ...ist, ...werte } });
    // Alle Felder: Älteren Dokumenten fehlt vielleicht eins, die Regeln verlangen alle.
    tx.update(ref, { ...ist, ...werte, updatedAt: serverTimestamp(), lastChange: eintrag.id });
    return true;
  });
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
    if (!seitenGleich(ist, s.nachher)) return false;
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

function Inhalt({ kuenstlerId, ich, von, bis, darf }) {
  const [a, setA] = useState();
  const [ladefehler, setLadefehler] = useState();
  const [fehler, setFehler] = useState();
  const [ergebnis, setErgebnis] = useState();
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => { aenderungen(kuenstlerId, von, bis).then(setA, e => setLadefehler(meldung(e))); }, [kuenstlerId, von, bis]);

  if (ladefehler) return <p className="pl-4 text-red-700">{ladefehler}</p>;
  if (!a) return <p className="pl-4 text-gray-600">Lädt…</p>;
  if (a.zuViele) return <p className="pl-4 text-gray-600">Über {HOECHSTENS} Änderungen, zu viele für eine Übersicht hier.</p>;
  const n = netto(a.history, a.seitenverlauf);
  const leer = !n.werke.length && !n.seiten.length && !a.werkgruppen.length && !a.werkgruppenOhne.length
    && !a.medien.length && !a.einstellungen && !a.kuenstlerGeaendert;
  const werke = darf.werke ? n.werke : [], seiten = darf.seiten ? n.seiten : [];
  const werkgruppen = darf.werkgruppen ? a.werkgruppen.filter(g => g.vorher) : [];
  const einstellungen = darf.einstellungen && a.einstellungen;
  const zuruecknehmbar = werke.length || seiten.length || werkgruppen.length || einstellungen;
  // Was Zurücknehmen nicht erfasst: ohne Verlauf, angelegte Werkgruppen oder ohne Berechtigung.
  const bleibt = a.werkgruppenOhne.length || a.kuenstlerGeaendert || werkgruppen.length < a.werkgruppen.length
    || (a.einstellungen && !einstellungen) || werke.length < n.werke.length || seiten.length < n.seiten.length;

  async function zuruecknehmen() {
    const teile = [werke.length && `${werke.length} Werk(e)`, seiten.length && `${seiten.length} Seite(n)`,
      werkgruppen.length && `${werkgruppen.length} Werkgruppe(n)`, einstellungen && "die Einstellungen"].filter(Boolean);
    if (!window.confirm(`${teile.join(" und ")} auf den Stand vor dieser Veröffentlichung zurücksetzen?\n\n`
      + "Was seitdem noch einmal geändert wurde, bleibt. Online geht es mit der nächsten Veröffentlichung.")) return;
    setLaeuft(true); setFehler(undefined); setErgebnis(undefined);
    let zurueck = 0, geblieben = 0;
    try {
      for (const w of werke) {
        if ((await werkZuruecksetzen(kuenstlerId, ich, w)).length) zurueck++; else geblieben++;
      }
      for (const s of seiten) {
        if (await seiteZuruecksetzen(kuenstlerId, ich, s)) zurueck++; else geblieben++;
      }
      for (const g of werkgruppen) {
        if (await werkgruppeZuruecksetzen(kuenstlerId, ich, g)) zurueck++; else geblieben++;
      }
      if (einstellungen) {
        if (await einstellungenZuruecksetzen(kuenstlerId, ich, a.einstellungen)) zurueck++; else geblieben++;
      }
    } catch (e) {
      // Was schon zurückgesetzt ist, bleibt es; das muss die Meldung sagen.
      setFehler(`${meldung(e)} Abgebrochen nach ${zurueck} zurückgesetzt; der Rest ist unverändert.`);
      setLaeuft(false);
      return;
    }
    setLaeuft(false);
    setErgebnis(`${zurueck} zurückgesetzt${geblieben ? `, ${geblieben} inzwischen erneut geändert und geblieben` : ""}.`
      + " Online geht es mit der nächsten Veröffentlichung.");
  }

  const seitenName = s => s.nachher?.titel ?? s.vorher?.titel ?? s.seite;
  const ohneVerlauf = <span className="text-gray-600">ohne Verlauf</span>;
  // Je Zeile: Schlüssel, was, welche Änderung, von wem.
  const zeilen = [
    ...n.werke.map(w => ["w" + w.werk, `Werk ${w.werk}`, Object.keys(w.felder).map(werkFeld).join(", "), [...w.von].join(", ")]),
    ...n.seiten.map(s => ["s" + s.seite, `Seite „${seitenName(s)}“`,
      !s.vorher ? "angelegt" : !s.nachher ? "gelöscht"
        : seitenUnterschiede(s.vorher, s.nachher).map(k => SEITENFELDER[k]).join(", "),
      [...s.von].join(", ")]),
    ...a.werkgruppen.map(g => ["g" + g.id, `Werkgruppe „${g.nachher?.titel ?? g.vorher?.titel ?? g.id}“`,
      !g.vorher ? "angelegt" : g.felder.map(k => WERKGRUPPENFELDER[k] ?? k).join(", "), [...g.von].join(", ")]),
    ...a.werkgruppenOhne.map(g => ["go" + g.id, `Werkgruppe „${g.titel || g.id}“`, ohneVerlauf, ""]),
    ...a.medien.map(m => ["m" + m.id, "Bild verarbeitet", m.original?.split("/").pop() ?? m.id, ""]),
    ...(a.einstellungen ? [["e", "Einstellungen",
      a.einstellungen.felder.map(k => EINSTELLUNGEN.find(([x]) => x === k)?.[1] ?? k).join(", "),
      [...a.einstellungen.von].join(", ")]] : []),
    ...(a.kuenstlerGeaendert ? [["eo", "Einstellungen oder Personen", ohneVerlauf, ""]] : []),
  ];
  return (
    <div className="pt-1 space-y-2">
      {leer && <p className="text-gray-600">Keine Änderungen an Werken, Seiten oder Bildern gefunden.</p>}
      {!leer && (
        <table className="w-full border-collapse bg-gray-50">
          <tbody>
            {zeilen.map(([k, was, aenderung, von]) => (
              <tr key={k} className="border-t border-gray-200">
                <td className={zelle + " [overflow-wrap:anywhere]"}>{was}</td>
                <td className={zelle + " break-words"}>{aenderung}</td>
                <td className={zelle + " text-gray-600 [overflow-wrap:anywhere]"}>{von}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {zuruecknehmbar ? (
        <p className="flex flex-wrap gap-2 items-center">
          <button className={knopf} disabled={laeuft} onClick={zuruecknehmen}>{laeuft ? "Setzt zurück…" : "Zurücknehmen"}</button>
          {bleibt && (
            <span className="text-gray-600">Was ohne Verlauf ist, angelegte Werkgruppen und was du nicht bearbeiten darfst, bleibt.</span>
          )}
        </p>
      ) : null}
      {(a.werkgruppenOhne.length > 0 || a.kuenstlerGeaendert) && (
        <p className="text-gray-600 text-xs">
          „Ohne Verlauf“: geändert, bevor es einen Verlauf gab, oder Personen; steht hier nur, wenn es seitdem nicht noch
          einmal geändert wurde.
        </p>
      )}
      {fehler && <p className="text-red-700">{fehler}</p>}
      {ergebnis && <p className="text-green-700">{ergebnis}</p>}
    </div>
  );
}
