import { defineConfig } from 'astro/config';
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import * as dotenv from 'dotenv';
dotenv.config()

// Ohne sie meldet sich in der Verwaltung niemand an (firebaseClient.js, #109).
const FIREBASE = ["PUBLIC_FIREBASE_PROJECT", "PUBLIC_FIREBASE_API_KEY", "PUBLIC_KUENSTLER"];
if (process.env.STRICT && FIREBASE.some(n => !process.env[n]))
  throw new Error(`Fehlt: ${FIREBASE.filter(n => !process.env[n]).join(", ")}`);
import sitemap from "@astrojs/sitemap";

// Dev-Server: /bilder/ liefert erst die veröffentlichte Seite (functions/bilder aus R2).
// Mit BILDER_VON (z. B. https://main.werkverzeichnis-c25.pages.dev) holt er sie dort,
// sonst fehlen lokal alle Vorschaubilder (#376). Nur `astro dev`, nicht im Build.
const BILDER_VON = process.env.BILDER_VON;

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), react(), sitemap({ filter: (page) => !page.includes("/verwaltung/") })],
  site: process.env.SITE,
  vite: BILDER_VON ? { server: { proxy: { "/bilder/": { target: BILDER_VON, changeOrigin: true } } } } : {},
});