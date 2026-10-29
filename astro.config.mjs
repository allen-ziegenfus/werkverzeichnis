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

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), react(), sitemap({ filter: (page) => !page.includes("/verwaltung/") })],
  site: process.env.SITE
});