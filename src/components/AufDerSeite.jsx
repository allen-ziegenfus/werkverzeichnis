import { collection, deleteField, doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { felderVon } from "../werkverzeichnis/felder.js";
import { db, kuenstler } from "./firebaseClient.js";
import { useUngespeichert, verlassen } from "./ungespeichert.js";

/**
 * Einfache Änderungen direkt auf der Werkseite (#337): Titel und die
 * angezeigten Eigenschaften (`data-feld` in [workSlug].astro) werden
 * bearbeitbar. Die Seite zeigt den veröffentlichten Stand; vor dem Bearbeiten
 * kommt der gespeicherte aus Firestore in die Texte. Gespeichert wird wie im
 * Werk-Editor: in einer Transaktion mit Verlaufseintrag, und nicht, wenn
 * jemand anderes inzwischen gespeichert hat (updatedAt). Leere Felder,
 * interne, Bilder und Werkgruppe bleiben in der Verwaltung.
 */

const elemente = () => [...document.querySelectorAll("[data-feld]")];
// Werte wie im Bau (catalog.ts): Text und Zahlen; anderes wird hier nicht bearbeitet.
const alsText = v => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const lesen = el => el.innerText.replace(/ /g, " ").trim();
const RAHMEN = ["outline-dashed", "outline-1", "outline-offset-2", "outline-gray-400", "rounded-sm", "focus:outline-blue-600"];

function bearbeitbar(el, an) {
  if (!an) {
    el.removeAttribute("contenteditable");
    el.classList.remove(...RAHMEN);
    return;
  }
  try { el.contentEditable = "plaintext-only"; } catch { el.contentEditable = "true"; }
  el.classList.add(...RAHMEN);
}

/** `klasse`: für die Gruppe beim Bearbeiten (Breite in der Leiste). */
export default function AufDerSeite({ werk, nutzer, klasse }) {
  const [stand, setStand] = useState();         // { daten, lang } beim Bearbeiten
  const [entwurf, setEntwurf] = useState({});
  const [laedt, setLaedt] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();
  const veroeffentlicht = useRef();             // Texte der Seite, für „Fertig“ ohne Speichern

  const geaendert = stand ? Object.keys(entwurf).filter(f => entwurf[f] !== alsText(stand.daten[f])) : [];
  useUngespeichert(geaendert.length > 0);
  const titelLeer = stand && entwurf.Titel === "";

  // Texte setzen: alle Elemente eines Felds (der Titel steht zweimal da).
  const setzen = werte => { for (const el of elemente()) if (el.dataset.feld in werte) el.textContent = werte[el.dataset.feld]; };

  async function laden() {
    const [w, k] = await Promise.all([getDoc(doc(kuenstler, "works", werk)), getDoc(kuenstler)]);
    if (!w.exists()) throw new Error("Werk nicht gefunden.");
    const lang = new Set(felderVon(k.data()).filter(f => f.lang).map(f => f.schluessel));
    return { daten: w.data(), lang };
  }

  async function starten() {
    setLaedt(true); setFehler(undefined); setHinweis(undefined);
    try {
      const s = await laden();
      const els = elemente();
      veroeffentlicht.current ??= Object.fromEntries(els.map(el => [el.dataset.feld, el.textContent]));
      const werte = Object.fromEntries(els.map(el => [el.dataset.feld, alsText(s.daten[el.dataset.feld])]));
      const anders = Object.keys(werte).filter(f => werte[f] !== veroeffentlicht.current[f].trim());
      setzen(werte);
      setStand(s); setEntwurf(werte);
      if (anders.length) setHinweis(`Seit der Veröffentlichung geändert: ${anders.length} ${anders.length === 1 ? "Feld" : "Felder"}; hier steht jetzt der gespeicherte Stand.`);
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Kein Zugriff." : e.message);
    } finally {
      setLaedt(false);
    }
  }

  // Bearbeitbar, solange `stand` da ist; Eingaben gehen in den Entwurf.
  useEffect(() => {
    if (!stand) return;
    const els = elemente();
    const eingabe = e => {
      const el = e.currentTarget, f = el.dataset.feld, text = lesen(el);
      for (const x of els) if (x !== el && x.dataset.feld === f) x.textContent = text;
      setEntwurf(d => ({ ...d, [f]: text }));
    };
    const taste = e => {
      if (e.key === "Enter" && !stand.lang.has(e.currentTarget.dataset.feld)) { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === "Escape") e.currentTarget.blur();
    };
    // Nur Text, auch wo plaintext-only fehlt.
    const einfuegen = e => {
      e.preventDefault();
      let text = e.clipboardData.getData("text/plain");
      if (!stand.lang.has(e.currentTarget.dataset.feld)) text = text.replace(/\s*\n\s*/g, " ");
      document.execCommand("insertText", false, text);
    };
    const ablegen = e => e.preventDefault();
    for (const el of els) {
      bearbeitbar(el, true);
      if (stand.lang.has(el.dataset.feld)) el.style.whiteSpace = "pre-wrap";
      el.addEventListener("input", eingabe); el.addEventListener("keydown", taste);
      el.addEventListener("paste", einfuegen); el.addEventListener("drop", ablegen);
    }
    return () => {
      for (const el of els) {
        bearbeitbar(el, false);
        el.removeEventListener("input", eingabe); el.removeEventListener("keydown", taste);
        el.removeEventListener("paste", einfuegen); el.removeEventListener("drop", ablegen);
      }
    };
  }, [stand]);

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const ref = doc(kuenstler, "works", werk);
    const eintrag = doc(collection(kuenstler, "history"));
    const davor = stand.daten;
    const neu = Object.fromEntries(geaendert.map(f => [f, entwurf[f] === "" ? null : entwurf[f]]));
    try {
      await runTransaction(db, async tx => {
        const jetzt = await tx.get(ref);
        if (jetzt.data()?.updatedAt?.toMillis() !== davor.updatedAt?.toMillis()) {
          throw Object.assign(new Error("Inzwischen woanders gespeichert."), { code: "konflikt" });
        }
        const changes = Object.fromEntries(Object.entries(neu).map(([f, w]) => [f, { from: davor[f] ?? null, to: w }]));
        tx.set(eintrag, { work: werk, by: nutzer.email, at: serverTimestamp(), changes });
        tx.update(ref, {
          ...Object.fromEntries(Object.entries(neu).map(([f, w]) => [f, w ?? deleteField()])),
          updatedAt: serverTimestamp(),
          lastChange: eintrag.id,
        });
      });
      const s = await laden();
      setStand(s);
      setHinweis("Gespeichert. Die Website zeigt es erst nach „Veröffentlichen“.");
    } catch (e) {
      setFehler(e.code === "konflikt"
        ? "Inzwischen hat jemand anderes dieses Werk gespeichert. „Neu laden“ holt den Stand; die Änderungen hier gehen dabei verloren."
        : e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setSpeichert(false);
    }
  }

  function verwerfen() {
    if (!window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    const werte = Object.fromEntries(Object.keys(entwurf).map(f => [f, alsText(stand.daten[f])]));
    setzen(werte); setEntwurf(werte); setFehler(undefined);
  }

  function beenden() {
    if (geaendert.length && !verlassen()) return;
    // Ohne Speichern zurück zum gespeicherten Stand; gespeicherte Änderungen bleiben sichtbar.
    setzen(Object.fromEntries(Object.keys(entwurf).map(f => [f, alsText(stand.daten[f])])));
    setStand(undefined); setEntwurf({}); setFehler(undefined); setHinweis(undefined);
  }

  async function neuLaden() {
    if (geaendert.length && !verlassen()) return;
    setStand(undefined);
    await starten();
  }

  const link = "underline hover:no-underline disabled:no-underline disabled:text-gray-500";
  if (!stand) {
    return (
      <span>
        <button className={link} onClick={starten} disabled={laedt}>
          ✎ {laedt ? "Lädt…" : "Hier bearbeiten"}
        </button>
        {fehler && <span className="text-red-700"> {fehler}</span>}
        {hinweis && <span className="text-green-800"> {hinweis}</span>}
      </span>
    );
  }
  const konflikt = fehler?.startsWith("Inzwischen");
  return (
    <span className={"flex flex-wrap items-center gap-x-3 gap-y-1 " + (klasse ?? "")} role="group" aria-label="Auf der Seite bearbeiten">
      {geaendert.length > 0 && <span className="text-amber-800 font-semibold">● Ungespeichert</span>}
      {titelLeer && <span className="text-red-700">Ohne Titel lässt sich nicht speichern.</span>}
      {fehler && <span className="text-red-700" role="alert">{fehler}</span>}
      {hinweis && !geaendert.length && <span className="text-green-800" role="status">{hinweis}</span>}
      {konflikt && <button className={link} onClick={neuLaden}>Neu laden</button>}
      <button className={link} onClick={verwerfen} disabled={!geaendert.length || speichert}>Verwerfen</button>
      <button className="px-3 py-0.5 rounded bg-blue-700 text-white disabled:bg-gray-400"
              onClick={speichern} disabled={!geaendert.length || titelLeer || speichert || konflikt}>
        {speichert ? "Speichert…" : "Speichern"}
      </button>
      <button className={link} onClick={beenden} disabled={speichert}>Fertig</button>
    </span>
  );
}
