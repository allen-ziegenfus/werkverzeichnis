import { Component, lazy, Suspense, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { client } from "./abfragen.js";
import { BEREICHE } from "./bereiche.js";
import Skelett from "./Skelett.jsx";
import { verlassen } from "./ungespeichert.js";
import { adresseSetzen, stelle } from "./adresse.js";
import VerwaltungKopf from "./VerwaltungKopf.jsx";
import { knopf } from "./knoepfe.js";

/**
 * Die Verwaltung als eine Seite (#90): Jede Adresse unter /verwaltung/ lädt
 * diese App; ein Klick auf einen Link innerhalb der Verwaltung wechselt nur den
 * Bereich (history.pushState), ohne Firebase, Anmeldung und den Stand der
 * Veröffentlichung neu zu laden. Die Bereiche werden erst bei Bedarf geladen.
 */

// Ein kurzer Netzwerkfehler: nach einer Pause einmal erneut versuchen (#140).
// Nach einem Deploy gibt es die Dateien eines älteren Stands nicht mehr; ein
// Tab, der noch offen war, lädt dann einmal neu statt leer zu bleiben (#107).
// Scheitert es gleich danach wieder, liegt es nicht daran: Fehler zeigen.
// Jeder Fehlschlag steht mit Zeit und Bereich in der Konsole, um ihn einem
// Deploy zuordnen zu können.
const PAUSE_VOR_ZWEITEM_VERSUCH = 1000;
const nachladen = (bereich, laden) => lazy(async () => {
  const melden = (e, was) => console.warn(`Bereich ${bereich} nicht geladen (${new Date().toISOString()}), ${was}:`, e);
  try { return await laden(); } catch (e) { melden(e, "noch ein Versuch"); }
  await new Promise(r => setTimeout(r, PAUSE_VOR_ZWEITEM_VERSUCH));
  try { return await laden(); } catch (e) {
    let zuletzt = 0;
    try { zuletzt = Number(sessionStorage.getItem("verwaltung-neu-geladen")) || 0; } catch { melden(e, "aufgegeben"); throw e; }
    if (Date.now() - zuletzt < 30_000) { melden(e, "aufgegeben, schon neu geladen"); throw e; }
    try { sessionStorage.setItem("verwaltung-neu-geladen", String(Date.now())); } catch { melden(e, "aufgegeben"); throw e; }
    melden(e, "lade die Seite neu");
    location.reload();
    return new Promise(() => {});
  }
});

/** Statt einer leeren Seite: was schiefging, und Neuladen. */
class Fehlergrenze extends Component {
  state = {};
  static getDerivedStateFromError(fehler) { return { fehler }; }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="space-y-2">
        <p className="text-red-700">Dieser Bereich konnte nicht geladen werden: {this.state.fehler.message}</p>
        <button className={knopf} onClick={() => location.reload()}>Neu laden</button>
      </div>
    );
  }
}

const KOMPONENTEN = {
  "/verwaltung/": nachladen("/verwaltung/", () => import("./Verwaltung.jsx")),
  "/verwaltung/werke/": nachladen("/verwaltung/werke/", () => import("./WerkEditor.jsx")),
  "/verwaltung/import/": nachladen("/verwaltung/import/", () => import("./Import.jsx")),
  "/verwaltung/werkgruppen/": nachladen("/verwaltung/werkgruppen/", () => import("./Werkgruppen.jsx")),
  "/verwaltung/seiten/": nachladen("/verwaltung/seiten/", () => import("./Seiten.jsx")),
  "/verwaltung/einstellungen/": nachladen("/verwaltung/einstellungen/", () => import("./Einstellungen.jsx")),
  "/verwaltung/verlauf/": nachladen("/verwaltung/verlauf/", () => import("./Verlauf.jsx")),
  "/verwaltung/personen/": nachladen("/verwaltung/personen/", () => import("./Personen.jsx")),
};
const TITEL = { "/verwaltung/": "Übersicht", ...Object.fromEntries(BEREICHE.map(b => [b.pfad, b.titel])) };

const normal = p => (p.endsWith("/") ? p : p + "/");
// nr: jeder Wechsel (Link, Zurück/Vor) baut den Bereich neu auf, auch wenn die
// Adresse gleich aussieht wie zuletzt hier gemerkt: Bereiche setzen sie selbst (#281).
let wechsel = 0;
const hier = () => ({ pfad: normal(location.pathname), suche: location.search, nr: ++wechsel });

export default function VerwaltungApp({ kuenstlerName }) {
  const [ort, setOrt] = useState(hier);

  useEffect(() => {
    if (history.state?.i == null) adresseSetzen(location.href);
    const wechseln = () => setOrt(hier());
    // Zurück/Vor im Browser lässt sich nicht abbrechen; abgelehnt, springt der
    // Browser zum gezeigten Eintrag zurück, und das popstate dorthin gilt nicht.
    let zurueckholen = null;
    const zurueck = () => {
      const i = history.state?.i ?? 0;
      if (i === zurueckholen) { zurueckholen = null; return; }
      if (verlassen()) { stelle.i = i; wechseln(); }
      else if (i !== stelle.i) { zurueckholen = stelle.i; history.go(stelle.i - i); }
    };
    // Links innerhalb der Verwaltung abfangen; neue Tabs, Downloads und
    // alles außerhalb bleiben normale Links.
    const klick = e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !KOMPONENTEN[normal(url.pathname)]) return;
      e.preventDefault();
      if (url.pathname + url.search !== location.pathname + location.search) {
        if (!verlassen()) return;
        adresseSetzen(url, { schritt: true });
        wechseln();
      }
      window.scrollTo(0, 0);
    };
    addEventListener("popstate", zurueck);
    document.addEventListener("click", klick);
    return () => { removeEventListener("popstate", zurueck); document.removeEventListener("click", klick); };
  }, []);

  const Bereich = KOMPONENTEN[ort.pfad];
  const titel = TITEL[ort.pfad] ?? "Nicht gefunden";
  useEffect(() => { document.title = `${titel} · Verwaltung · ${kuenstlerName}`; }, [titel, kuenstlerName]);

  return (
    <QueryClientProvider client={client}>
      <VerwaltungKopf kuenstlerName={kuenstlerName} aktiv={ort.pfad === "/verwaltung/" ? undefined : ort.pfad} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl mb-4">{titel}</h1>
        {/* Neu aufbauen bei jedem Wechsel, auch ?werk=…: Die Bereiche lesen die Adresse beim Start. */}
        <Fehlergrenze key={ort.nr}>
          <Suspense fallback={<Skelett />}>
            {Bereich ? <Bereich /> : <p>Diesen Bereich gibt es nicht.</p>}
          </Suspense>
        </Fehlergrenze>
      </main>
    </QueryClientProvider>
  );
}
