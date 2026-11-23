/**
 * Adresse je Werk (#281): Öffnen setzt ?werk=, die Liste ?gruppe=; Neuladen
 * bleibt, Zurück/Vor wechselt, Ungespeichertes fragt.
 */
import { test, expect } from "./vorlage.mjs";

const titel = page => page.getByText(/^OB\d+ · /);

test("Werkgruppe und Werk in der Adresse, Neuladen bleibt im Werk", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/");
  await page.locator("select").first().selectOption({ label: "Objekte" });
  await expect(page).toHaveURL(/\/verwaltung\/werke\/\?gruppe=objekte$/);
  await page.getByText("Kiste mit Deckel").first().click();
  await expect(page).toHaveURL(/\?werk=ob1$/);
  await page.reload();
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await expect(page).toHaveURL(/\?werk=ob1$/);
});

test("Zurück und Vor wechseln zwischen Liste und Werk, auch über Werkgruppen", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/?gruppe=objekte");
  await page.getByText("Kiste mit Deckel").first().click();
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await page.getByRole("button", { name: /Zurück zur Liste/ }).click();
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await page.getByText("OB3", { exact: true }).click();
  await expect(titel(page)).toHaveText("OB3 · Ohne Bild");

  await page.goBack();
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await expect(page.getByText("Kiste mit Deckel")).toBeVisible();
  await page.goBack();
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await page.goForward();
  await page.goForward();
  await expect(titel(page)).toHaveText("OB3 · Ohne Bild");

  // Ein Link in der Verwaltung auf ein Werk einer anderen Werkgruppe (wie aus „Veröffentlichen“), dann zurück.
  await page.evaluate(() => {
    const a = Object.assign(document.createElement("a"), { href: "/verwaltung/werke/?werk=fivi1", textContent: "Zum Film" });
    document.querySelector("main").prepend(a);
  });
  await page.getByRole("link", { name: "Zum Film" }).click();
  await expect(page.getByText("FiVi1 · Ein Film")).toBeVisible();
  await expect(page.locator("select").first()).toHaveValue("filme-und-video");
  await expect(page).toHaveURL(/\?werk=fivi1$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?werk=ob3$/);
  await expect(titel(page)).toHaveText("OB3 · Ohne Bild");
});

test("Werk aus der Adresse gibt es nicht: Meldung, Adresse bleibt", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/?werk=gibtsnicht");
  await expect(page.getByText("Werk „gibtsnicht“ nicht gefunden.")).toBeVisible();
  await expect(page).toHaveURL(/\?werk=gibtsnicht$/);
});

test("Werk nicht in der Liste seiner Werkgruppe: Liste, Adresse wird die der Gruppe", async ({ verwaltung }) => {
  // Das Dokument nennt eine Werkgruppe, deren Liste es nicht enthält (Abfrage nach werkgruppe).
  const page = await verwaltung("/verwaltung/werke/?werk=ob3", {
    schalter: { __altStand: { "artists/k/works/ob3": { InvNr: "OB3", Titel: "Ohne Bild", werkgruppe: "filme-und-video" } } },
  });
  await expect(page.locator("select").first()).toHaveValue("filme-und-video");
  await expect(page).toHaveURL(/\?gruppe=filme-und-video$/);
});

test("Zurück mit ungespeicherten Änderungen fragt; Abbrechen bleibt im Werk", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/?gruppe=objekte");
  await page.getByText("Kiste mit Deckel").first().click();
  await page.getByLabel("Jahr", { exact: true }).fill("1999");
  let gefragt = 0;
  page.once("dialog", d => { gefragt++; d.dismiss(); });
  await page.goBack();
  await expect.poll(() => gefragt).toBe(1);
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await expect(page.getByLabel("Jahr", { exact: true })).toHaveValue("1999");
  await expect(page).toHaveURL(/\?werk=ob1$/);

  page.once("dialog", d => { gefragt++; d.accept(); });
  await page.goBack();
  await expect.poll(() => gefragt).toBe(2);
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await expect(page.getByText("Kiste mit Deckel")).toBeVisible();
});

test("Seiten: Seite in der Adresse, Neuladen bleibt, Zurück/Vor (#366)", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/seiten/");
  await page.getByRole("button", { name: /^Einführung/ }).click();
  await expect(page).toHaveURL(/\/verwaltung\/seiten\/\?seite=einfuhrung$/);
  const titelFeld = page.getByLabel("Titel", { exact: true });
  await expect(titelFeld).toHaveValue("Einführung");
  await page.reload();
  await expect(titelFeld).toHaveValue("Einführung");
  await page.goBack();
  await expect(page).toHaveURL(/\/verwaltung\/seiten\/$/);
  await expect(page.getByRole("button", { name: /^Impressum/ })).toBeVisible();
  await page.goForward();
  await expect(titelFeld).toHaveValue("Einführung");
  await page.getByRole("button", { name: /Zurück zu den Seiten/ }).click();
  await expect(page).toHaveURL(/\/verwaltung\/seiten\/$/);
});
