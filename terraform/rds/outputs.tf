output "rds_address" {
  description = "RDS database hostname"
  value       = aws_db_instance.skybook.address
}

output "rds_endpoint" {
  description = "RDS database endpoint"
  value       = aws_db_instance.skybook.endpoint
}

output "rds_port" {
  description = "RDS database port"
  value       = aws_db_instance.skybook.port
}

output "rds_security_group_id" {
  description = "RDS security group ID"
  value       = aws_security_group.rds.id
}

output "rds_master_user_secret_arn" {
  description = "Secrets Manager ARN containing the RDS master credentials"
  value       = aws_db_instance.skybook.master_user_secret[0].secret_arn
}
