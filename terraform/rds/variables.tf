variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project identifier"
  type        = string
  default     = "skybook"
}

variable "db_name" {
  description = "Initial database name"
  type        = string
  default     = "flight_booking"
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  default     = "skybook_app"
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  description = "Initial allocated storage in GB"
  type        = number
  default     = 20
}
