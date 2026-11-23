output "cluster_name" {
  description = "EKS cluster name"
  value       = aws_eks_cluster.skybook.name
}

output "cluster_endpoint" {
  description = "EKS API endpoint"
  value       = aws_eks_cluster.skybook.endpoint
}

output "cluster_arn" {
  description = "EKS cluster ARN"
  value       = aws_eks_cluster.skybook.arn
}

output "node_group_name" {
  description = "Managed node group name"
  value       = aws_eks_node_group.skybook_workers.node_group_name
}
