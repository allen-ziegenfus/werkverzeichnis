import { lazy, Suspense, useEffect, useState } from "react";
import { BEREICHE } from "./bereiche.js";
import VerwaltungKopf from "./VerwaltungKopf.jsx";

/**
 * Die Verwaltung als eine Seite (#90): Jede Adresse unter /verwaltung/ lädt
 * diese App; ein Klick auf einen Link innerhalb der Verwaltung wechselt nur den
 * Bereich (history.pushState), ohne Firebase, Anmeldung und den Stand der
 * Veröffentlichung neu zu laden. Die Bereiche werden erst bei Bedarf geladen.
 */

const KOMPONENTEN = {
  "/verwaltung/": lazy(() => import("./Verwaltung.jsx")),
  "/verwaltung/werke/": lazy(() => import("./WerkEditor.jsx")),
  "/verwaltung/werkgruppen/": lazy(() => import("./Werkgruppen.jsx")),
  "/verwaltung/seiten/": lazy(() => import("./Seiten.jsx")),
  "/verwaltung/einstellungen/": lazy(() => import("./Einstellungen.jsx")),
  "/verwaltung/verlauf/": lazy(() => import("./Verlauf.jsx")),
  "/verwaltung/personen/": lazy(() => import("./Personen.jsx")),
};
const TITEL = { "/verwaltung/": "Übersicht", ...Object.fromEntries(BEREICHE.map(b => [b.pfad, b.titel])) };

const normal = p => (p.endsWith("/") ? p : p + "/");
const hier = () => ({ pfad: normal(location.pathname), suche: location.search });

export default function VerwaltungApp({ kuenstlerName }) {
  const [ort, setOrt] = useState(hier);

  useEffect(() => {
    const zurueck = () => setOrt(hier());
    // Links innerhalb der Verwaltung abfangen; neue Tabs, Downloads und
    // alles außerhalb bleiben normale Links.
    const klick = e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !KOMPONENTEN[normal(url.pathname)]) return;
      e.preventDefault();
      if (url.pathname + url.search !== location.pathname + location.search) history.pushState(null, "", url);
      setOrt(hier());
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
    <>
      <VerwaltungKopf kuenstlerName={kuenstlerName} aktiv={ort.pfad === "/verwaltung/" ? undefined : ort.pfad} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl mb-4">{titel}</h1>
        <Suspense fallback={<p>…</p>}>
          {/* Neu aufbauen bei jedem Wechsel, auch ?werk=…: Die Bereiche lesen die Adresse beim Start. */}
          {Bereich ? <Bereich key={ort.pfad + ort.suche} /> : <p>Diesen Bereich gibt es nicht.</p>}
        </Suspense>
      </main>
    </>
  );
}
