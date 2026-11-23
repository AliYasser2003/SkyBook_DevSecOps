
variable "aws_region" {
  description = "AWS region where SkyBook EKS will be deployed"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "SkyBook EKS cluster name"
  type        = string
  default     = "skybook-eks"
}

variable "kubernetes_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.37"
}

variable "vpc_id" {
  description = "Existing AWS VPC ID"
  type        = string
  default     = "vpc-0a855b366213948b0"
}

variable "subnet_ids" {
  description = "Existing VPC subnet IDs for EKS"
  type        = list(string)

  default = [
    "subnet-0110c80b2f31b6106",
    "subnet-058e3e82965315180"
  ]
}

variable "node_instance_type" {
  description = "EC2 instance type for EKS worker nodes"
  type        = string
  default     = "t3.medium"
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDR ranges allowed to reach the EKS public API endpoint"
  type        = list(string)
  default     = ["156.204.172.18/32"]
}
