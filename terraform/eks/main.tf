
# Reference the existing EKS cluster IAM role
data "aws_iam_role" "eks_cluster" {
  name = "eks-cluster-role"
}

# Reference the existing EC2 worker node IAM role
data "aws_iam_role" "eks_nodes" {
  name = "eks-node-group-role"
}

# Create the EKS control plane
resource "aws_eks_cluster" "skybook" {
  name     = var.cluster_name
  role_arn = data.aws_iam_role.eks_cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = var.subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = true

    public_access_cidrs = var.cluster_endpoint_public_access_cidrs
  }

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  tags = {
    Project     = "SkyBook"
    Environment = "Learning"
    ManagedBy   = "Terraform"
  }
}

# Create the EC2 managed worker node group
resource "aws_eks_node_group" "skybook_workers" {
  cluster_name    = aws_eks_cluster.skybook.name
  node_group_name = "${var.cluster_name}-workers"
  node_role_arn   = data.aws_iam_role.eks_nodes.arn

  subnet_ids = var.subnet_ids

  instance_types = [var.node_instance_type]
  capacity_type  = "ON_DEMAND"

  scaling_config {
    desired_size = 1
    min_size     = 1
    max_size     = 2
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    project = "skybook"
    role    = "worker"
  }

  tags = {
    Project   = "SkyBook"
    ManagedBy = "Terraform"
  }
}

resource "aws_eks_addon" "vpc_cni" {
  cluster_name  = aws_eks_cluster.skybook.name
  addon_name    = "vpc-cni"
  addon_version = "v1.22.4-eksbuild.14"

  resolve_conflicts_on_create = "OVERWRITE"
}

resource "aws_eks_addon" "coredns" {
  cluster_name  = aws_eks_cluster.skybook.name
  addon_name    = "coredns"
  addon_version = "v1.14.7-eksbuild.35"

  resolve_conflicts_on_create = "OVERWRITE"
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name  = aws_eks_cluster.skybook.name
  addon_name    = "kube-proxy"
  addon_version = "v1.37.0-eksbuild.39"

  resolve_conflicts_on_create = "OVERWRITE"
}
