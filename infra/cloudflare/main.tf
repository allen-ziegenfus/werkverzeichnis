# Die Cloudflare-Seite einer Seite: das Pages-Projekt, auf das die Builds
# deployen (Direct Upload, ohne Git-Verbindung), und der R2-Bucket, den seine
# Funktion /bilder ausliefert.

resource "cloudflare_r2_bucket" "bilder" {
  account_id = var.konto_id
  name       = var.bilder_bucket
  lifecycle { prevent_destroy = true }
}

locals {
  bindungen = { r2_buckets = { BILDER = { name = cloudflare_r2_bucket.bilder.name } } }
}

resource "cloudflare_pages_project" "seite" {
  account_id        = var.konto_id
  name              = var.pages_projekt
  production_branch = var.produktions_branch
  deployment_configs = {
    production = local.bindungen
    preview    = local.bindungen
  }
  lifecycle { prevent_destroy = true }
}

output "pages_subdomain" {
  value = cloudflare_pages_project.seite.subdomain
}

# --- Tokens für das Projekt der Seite (#112) -----------------------------------

locals {
  tokens = var.seiten_projekt == null ? toset([]) : toset(["pages", "r2"])
}

# Alle Rechtegruppen, ausgewählt nach Namen hier statt mit dem Filter der API
# (dessen Kodierung ist uneindeutig).
data "cloudflare_account_api_token_permission_groups_list" "rechte" {
  count      = var.seiten_projekt == null ? 0 : 1
  account_id = var.konto_id
  max_items  = 1000
}

locals {
  recht = var.seiten_projekt == null ? {} : {
    for k, name in { pages = "Pages Write", r2 = "Workers R2 Storage Bucket Item Write" } :
    k => one([for g in data.cloudflare_account_api_token_permission_groups_list.rechte[0].result : g.id if g.name == name])
  }
}

# Der Build deployt nach Pages; die Bildfunktion schreibt nur in den Bucket der Seite.
resource "cloudflare_account_token" "token" {
  for_each   = local.tokens
  account_id = var.konto_id
  name       = "${var.pages_projekt} ${each.key} (Terraform)"
  policies = [{
    effect            = "allow"
    permission_groups = [{ id = local.recht[each.key] }]
    resources = jsonencode(each.key == "pages"
      ? { "com.cloudflare.api.account.${var.konto_id}" = "*" }
    : { "com.cloudflare.edge.r2.bucket.${var.konto_id}_default_${cloudflare_r2_bucket.bilder.name}" = "*" })
  }]
}

# R2 spricht S3: Schlüssel-ID ist die ID des Tokens, das Secret der SHA-256 seines Werts.
locals {
  secrets = var.seiten_projekt == null ? {} : {
    "cloudflare-pages-token" = cloudflare_account_token.token["pages"].value
    "r2-access-key-id"       = cloudflare_account_token.token["r2"].id
    "r2-secret-access-key"   = sha256(cloudflare_account_token.token["r2"].value)
  }
}

# Die Secrets selbst legt infra/gcp an; hier nur ihre Werte.
resource "google_secret_manager_secret_version" "wert" {
  for_each    = var.seiten_projekt == null ? toset([]) : toset(["cloudflare-pages-token", "r2-access-key-id", "r2-secret-access-key"])
  secret      = "projects/${var.seiten_projekt}/secrets/${each.key}"
  secret_data = local.secrets[each.key]
}
