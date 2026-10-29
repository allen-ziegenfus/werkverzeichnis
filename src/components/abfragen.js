import { QueryClient, useQuery } from "@tanstack/react-query";
import { collection, getDoc, getDocs, query, where } from "firebase/firestore";
import { kuenstler } from "./firebaseClient.js";

/**
 * Die Daten der Verwaltung, über die Bereiche hinweg behalten (#122): Wer
 * zwischen Werken und Werkgruppen wechselt, sieht sofort, was schon geladen
 * war; neu geladen wird im Hintergrund, wenn es älter als `staleTime` ist.
 * Nach dem Speichern aktualisiert der Bereich den Cache selbst
 * (`setQueryData`) oder lässt neu laden (`invalidateQueries`).
 */
export const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      // Was die Regeln ablehnen, wird beim zweiten Versuch nicht besser.
      retry: (n, e) => e?.code !== "permission-denied" && n < 2,
    },
  },
});

export const SCHLUESSEL = {
  kuenstler: ["kuenstler"],
  werkgruppen: ["werkgruppen"],
  werke: gruppe => ["werke", gruppe],
  seiten: ["seiten"],
};

const liste = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
const nachInvNr = (a, b) => Number(a.data.InvNr.replace(/\D/g, "")) - Number(b.data.InvNr.replace(/\D/g, ""));

/** Das Dokument der Künstler:in (Einstellungen, Rollen) als Objekt. */
export const useKuenstler = () => useQuery({
  queryKey: SCHLUESSEL.kuenstler,
  queryFn: async () => (await getDoc(kuenstler)).data() ?? {},
});

/** Die Werkgruppen, nach Reihenfolge. */
export const useWerkgruppen = () => useQuery({
  queryKey: SCHLUESSEL.werkgruppen,
  queryFn: async () => liste(await getDocs(collection(kuenstler, "werkgruppen")))
    .sort((a, b) => a.reihenfolge - b.reihenfolge),
});

/** Die Werke einer Werkgruppe als { id, data }, nach Inv. Nr. */
export const useWerke = gruppe => useQuery({
  queryKey: SCHLUESSEL.werke(gruppe),
  queryFn: async () => (await getDocs(query(collection(kuenstler, "works"), where("werkgruppe", "==", gruppe))))
    .docs.map(d => ({ id: d.id, data: d.data() })).sort(nachInvNr),
  enabled: !!gruppe,
});
