import { useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { darf } from "../werkverzeichnis/permissions.js";
import { BEREICHE } from "./bereiche.js";
import { useHoeheAls } from "./hoehe.js";
import { auth, KUENSTLER } from "./firebaseClient.js";
import { verlassen } from "./ungespeichert.js";
import { Stand } from "./Veroeffentlichen.jsx";
import { useZugang } from "./Zugang.jsx";

/**
 * Kopf der Verwaltung: Reiter für die Bereiche, die man darf, der Stand der
 * Veröffentlichung, zurück zur Website und Abmelden. Dunkel, damit man sofort
 * sieht, dass man in der Verwaltung ist (#278); der aktive Reiter ist hell wie
 * der Inhalt darunter. Beim Scrollen bleiben Reiter und Stand oben stehen, die
 * Zeile mit Name und Abmelden geht weg (#260).
 */

const link = "underline hover:no-underline";

export default function VerwaltungKopf({ kuenstlerName, aktiv }) {
  const { nutzer, wer } = useZugang();
  const bereiche = nutzer && wer ? BEREICHE.filter(b => darf(wer, b.berechtigung)) : [];
  const [kopf, setKopf] = useState();
  const oben = useRef();
  // sticky mit negativem top: Die erste Zeile scrollt weg, der Rest bleibt stehen.
  // Sie bricht auf dem Handy um, darum gemessen statt fest.
  useHoeheAls("--kopf-sichtbar", kopf, el => {
    el.style.top = `-${oben.current.offsetHeight}px`;
    return el.offsetHeight - oben.current.offsetHeight;
  });

  return (
    <header ref={setKopf} className="sticky z-40 border-b border-stone-950 bg-stone-900 text-stone-100 text-sm">
      <div ref={oben} className="max-w-5xl mx-auto px-4 pt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <a href="/verwaltung/" className="text-base">
          <b>Verwaltung</b> · {kuenstlerName}
        </a>
        <span className="ml-auto text-stone-300">
          <a className={link} href="/">← Zur Website</a>
          {nutzer && (
            <>
              <span className="hidden sm:inline"> · {nutzer.email}</span>
              {" · "}
              <button className={link} onClick={() => verlassen() && signOut(auth)}>Abmelden</button>
            </>
          )}
        </span>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-2 pb-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        {/* Weiße Linie unter den Reitern fasst sie zusammen; der aktive sitzt darauf (#377). */}
        {/* Ohne Reiter (lädt noch, keine Rechte) keine leere Linie. */}
        <nav className={"flex gap-1 overflow-x-auto w-full" + (bereiche.length ? " border-b-2 border-white" : "")}>
          {bereiche.map(b => (
            <a key={b.pfad} href={b.pfad}
               aria-current={b.pfad === aktiv ? "page" : undefined}
               className={"px-3 py-1.5 border border-b-0 rounded-t whitespace-nowrap " + (b.pfad === aktiv
                 ? "bg-white text-black border-stone-950" : "border-transparent hover:bg-stone-700")}>
              {b.titel}
            </a>
          ))}
        </nav>
        {nutzer && wer && darf(wer, "lesen") && (
          <Stand kuenstlerId={KUENSTLER} ich={nutzer.email} erlaubt={darf(wer, "veroeffentlichen")}
                 darfWerke={darf(wer, "werke.bearbeiten")} darfSeiten={darf(wer, "seiten.bearbeiten")}
                 dunkel className="ml-auto" />
        )}
      </div>
    </header>
  );
}
