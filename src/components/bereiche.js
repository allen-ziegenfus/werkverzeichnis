/**
 * Die Bereiche der Verwaltung, für das Menü der Werkzeugleiste und die Kacheln
 * auf /verwaltung/. Jeder erscheint nur mit seiner Berechtigung (permissions.js).
 */
export const BEREICHE = [
  { pfad: "/verwaltung/werke/", titel: "Werke", text: "Angaben zu einzelnen Werken ändern",
    berechtigung: "werke.bearbeiten" },
  { pfad: "/verwaltung/werkgruppen/", titel: "Werkgruppen", text: "Titel, Kurztitel und Reihenfolge",
    berechtigung: "werkgruppen.bearbeiten" },
  { pfad: "/verwaltung/seiten/", titel: "Seiten", text: "Einführung, Impressum und andere Textseiten",
    berechtigung: "seiten.bearbeiten" },
  { pfad: "/verwaltung/einstellungen/", titel: "Einstellungen", text: "Titel der Website und Copyright",
    berechtigung: "einstellungen.bearbeiten" },
  { pfad: "/verwaltung/personen/", titel: "Personen & Rollen", text: "Wer die Website bearbeiten darf",
    berechtigung: "rollen.verwalten" },
];
