variable "infra_projekt" {
  description = "Projekt mit dem Cloudflare-Token für Terraform."
  type        = string
}

variable "konto_id" {
  type = string
}

variable "pages_projekt" {
  type = string
}

variable "produktions_branch" {
  type = string
}

variable "bilder_bucket" {
  description = "R2-Bucket für die Webversionen, an die Seite gebunden als BILDER (functions/bilder)."
  type        = string
}

variable "seiten_projekt" {
  description = <<-EOT
    Gesetzt: Terraform legt die Cloudflare-Tokens des Builds (Pages) und der
    Bildfunktion (R2) an und schreibt sie als Secret-Versionen in dieses
    Projekt (#112). Dafür braucht das Cloudflare-Token für Terraform zusätzlich
    Account API Tokens: Edit. Die Tokens stehen dann im Terraform-State.
  EOT
  type        = string
  default     = null
}
