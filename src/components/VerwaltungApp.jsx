import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { client } from "./abfragen.js";
import { BEREICHE } from "./bereiche.js";
import Skelett from "./Skelett.jsx";
import { verlassen } from "./ungespeichert.js";
import VerwaltungKopf from "./VerwaltungKopf.jsx";

/**
 * Die Verwaltung als eine Seite (#90): Jede Adresse unter /verwaltung/ lädt
 * diese App; ein Klick auf einen Link innerhalb der Verwaltung wechselt nur den
 * Bereich (history.pushState), ohne Firebase, Anmeldung und den Stand der
 * Veröffentlichung neu zu laden. Die Bereiche werden erst bei Bedarf geladen.
 */

// Nach einem Deploy gibt es die Dateien eines älteren Stands nicht mehr; ein
// Tab, der noch offen war, lädt dann einmal neu statt leer zu bleiben (#107).
// Scheitert es gleich danach wieder, liegt es nicht daran: Fehler zeigen.
const nachladen = laden => lazy(() => laden().catch(e => {
  let zuletzt = 0;
  try { zuletzt = Number(sessionStorage.getItem("verwaltung-neu-geladen")) || 0; } catch { throw e; }
  if (Date.now() - zuletzt < 30_000) throw e;
  try { sessionStorage.setItem("verwaltung-neu-geladen", String(Date.now())); } catch { throw e; }
  location.reload();
  return new Promise(() => {});
}));

/** Statt einer leeren Seite: was schiefging, und Neuladen. */
class Fehlergrenze extends Component {
  state = {};
  static getDerivedStateFromError(fehler) { return { fehler }; }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="space-y-2">
        <p className="text-red-700">Dieser Bereich konnte nicht geladen werden: {this.state.fehler.message}</p>
        <button className="px-3 py-1 border rounded" onClick={() => location.reload()}>Neu laden</button>
      </div>
    );
  }
}

const KOMPONENTEN = {
  "/verwaltung/": nachladen(() => import("./Verwaltung.jsx")),
  "/verwaltung/werke/": nachladen(() => import("./WerkEditor.jsx")),
  "/verwaltung/werkgruppen/": nachladen(() => import("./Werkgruppen.jsx")),
  "/verwaltung/seiten/": nachladen(() => import("./Seiten.jsx")),
  "/verwaltung/einstellungen/": nachladen(() => import("./Einstellungen.jsx")),
  "/verwaltung/verlauf/": nachladen(() => import("./Verlauf.jsx")),
  "/verwaltung/personen/": nachladen(() => import("./Personen.jsx")),
};
const TITEL = { "/verwaltung/": "Übersicht", ...Object.fromEntries(BEREICHE.map(b => [b.pfad, b.titel])) };

const normal = p => (p.endsWith("/") ? p : p + "/");
const hier = () => ({ pfad: normal(location.pathname), suche: location.search });

export default function VerwaltungApp({ kuenstlerName }) {
  const [ort, setOrt] = useState(hier);
  const adresse = useRef(location.pathname + location.search);   // die gezeigte, für „Zurück“ ohne Verlassen

  useEffect(() => {
    const wechseln = () => { adresse.current = location.pathname + location.search; setOrt(hier()); };
    // Zurück/Vor im Browser lässt sich nicht abbrechen; abgelehnt, kommt die alte Adresse wieder.
    const zurueck = () => verlassen() ? wechseln() : history.pushState(null, "", adresse.current);
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
        history.pushState(null, "", url);
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
        <Fehlergrenze key={ort.pfad + ort.suche}>
          <Suspense fallback={<Skelett />}>
            {Bereich ? <Bereich /> : <p>Diesen Bereich gibt es nicht.</p>}
          </Suspense>
        </Fehlergrenze>
      </main>
    </QueryClientProvider>
  );
}
