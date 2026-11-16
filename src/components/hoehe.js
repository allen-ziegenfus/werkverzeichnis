import { useLayoutEffect } from "react";

/**
 * Höhe eines Elements als CSS-Variable am Dokument, damit Leisten darunter
 * (top-[var(--kopf-sichtbar)]) und scroll-padding (VerwaltungLayout.astro)
 * wissen, was oben schon steht (#260). Beim Abbauen 0. `el` aus einer
 * Callback-Ref (useState), damit ein später erscheinendes Element zählt.
 */
export function useHoeheAls(name, el, messen = e => e.offsetHeight) {
  useLayoutEffect(() => {
    if (!el) return;
    const setzen = () => document.documentElement.style.setProperty(name, `${messen(el)}px`);
    setzen();
    const beobachter = new ResizeObserver(setzen);
    beobachter.observe(el);
    return () => { beobachter.disconnect(); document.documentElement.style.setProperty(name, "0px"); };
  }, [name, el]);
}
