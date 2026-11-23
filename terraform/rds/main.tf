terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_eks_cluster" "skybook" {
  name = "skybook-eks"
}

resource "aws_db_subnet_group" "skybook" {
  name        = "${var.project_name}-db-subnet-group"
  description = "Subnet group for SkyBook RDS"

  subnet_ids = data.aws_eks_cluster.skybook.vpc_config[0].subnet_ids

  tags = {
    Name    = "${var.project_name}-db-subnet-group"
    Project = var.project_name
  }
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds-sg"
  description = "Allow MySQL access from SkyBook EKS workers"
  vpc_id      = data.aws_eks_cluster.skybook.vpc_config[0].vpc_id

  ingress {
    description = "MySQL from EKS cluster"
    from_port   = 3306
    to_port     = 3306
    protocol    = "tcp"
    security_groups = [
      data.aws_eks_cluster.skybook.vpc_config[0].cluster_security_group_id
    ]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project_name}-rds-sg"
    Project = var.project_name
  }
}

resource "aws_db_instance" "skybook" {
  identifier = "${var.project_name}-mysql"

  engine         = "mysql"
  engine_version = "8.4"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = 50
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  port     = 3306

  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.skybook.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  publicly_accessible = false
  multi_az            = false

  backup_retention_period = 7
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project_name}-mysql-final"

  tags = {
    Name    = "${var.project_name}-mysql"
    Project = var.project_name
  }
}
