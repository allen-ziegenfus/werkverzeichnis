variable "infra_projekt" {
  description = "Das Infra-Projekt; die Zentrale läuft dort."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west3"
}
