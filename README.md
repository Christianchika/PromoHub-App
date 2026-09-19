# PromoHub — Scalable Web Platform

## Project Overview

PromoHub is an e-commerce web platform with generic dicount code, the website os designed to simulate a real world application that experiences significant traffic spikes during promotional campaigns.

The project focuses on designing, implementing, testing and automating a highly available and scalable cloud infrastructure capable of maintaining application availability and performance during sudden increases in traffic.

## The Problem

During promotional periods, a sudden increase in users can overwhelm a traditional single-server application architecture.

This can result in:

- Failed or timed-out login requests
- Slow response times
- Increased application errors
- Server resource exhaustion
- Poor availability
- A single point of failure

The initial version of this project will deliberately use a simple architecture so that we can reproduce and measure these problems before introducing improvements.

## Project Objective

The objective is to progressively transform the initial application into a scalable and highly available cloud platform.

The project will demonstrate how Cloud and DevOps engineering practices can be used to:

- Handle sudden traffic spikes
- Distribute traffic across multiple application instances
- Automatically scale compute resources
- Improve application availability
- Monitor infrastructure and application health
- Secure cloud resources
- Automate infrastructure deployment
- Automate application delivery
- Test system resilience and failure recovery

## Planned Architecture

The project will evolve progressively from a simple architecture:

Internet → EC2 → Database

into a more resilient architecture involving:

Internet → CloudFront/WAF → Application Load Balancer → Auto Scaling Group → Application Instances → RDS

Monitoring and automation will be added throughout the project.

## Technology Areas

- AWS
- EC2
- Application Load Balancer
- Auto Scaling
- VPC
- RDS
- CloudFront
- AWS WAF
- IAM
- CloudWatch
- Terraform
- Docker
- GitHub Actions
- Git/GitHub
- Load Testing

## Project Roadmap

1. Project setup
2. Build the baseline application
3. Deploy the initial single-server architecture
4. Perform load testing
5. Identify scalability and availability problems
6. Design the improved AWS architecture
7. Implement load balancing and Auto Scaling
8. Implement RDS
9. Improve security
10. Add monitoring and alerting
11. Rebuild infrastructure with Terraform
12. Implement CI/CD
13. Perform failure and load testing
14. Compare the baseline and improved architectures
15. Document results and lessons learned

## Collaboration

This is a collaborative Cloud/DevOps engineering project.

Contributions will be managed through GitHub using:

**Issues → Branches → Pull Requests → Code Review → Merge**

Contributors will work on defined areas of the project while maintaining a structured engineering workflow.

## Project Status

| Phase | Description | Status | Target Date |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Planning & Requirements Setup | ✅ Completed | Aug 2026 |
| **Phase 2** | Build Baseline (App & DB Deployment) | 🟡 In Progress | Aug 2026 |
| **Phase 3** | Reproduce the Problem (Load Testing) |  Pending | — |
| **Phase 4** | Scalable AWS Architecture Design |  Pending | — |
| **Phase 5** | Monitoring & Reliability (CloudWatch) |  Pending | — |
| **Phase 6** | Infrastructure as Code (Terraform) |  Pending | — |
| **Phase 7** | CI/CD Pipeline (GitHub Actions) |  Pending | — |
| **Phase 8** | Final Load Testing & Verification |  Pending | — |

## Manual AWS Deployment: EC2, ECR and RDS

This runbook deploys the current application manually with the AWS CLI from **Git Bash**. It uses one EC2 instance for the application and one private RDS PostgreSQL database:

```text
Internet -> EC2 (Nginx + frontend container + backend container) -> RDS PostgreSQL
```

This is a baseline deployment, not a highly available production architecture. Do not expose RDS to the internet. For production, add an Application Load Balancer, private subnets, HTTPS, Secrets Manager, backups, monitoring, and multiple EC2 instances.

### 1. Prerequisites

Install and verify:

- AWS CLI v2
- Docker Desktop with Linux containers enabled
- Git Bash
- An AWS account and an IAM identity allowed to create EC2, ECR, RDS, VPC security groups, IAM roles, and CloudFormation stacks

Run these commands in Git Bash from the repository root:

```bash
aws --version
docker --version
aws sts get-caller-identity
```

Configure a named AWS CLI profile if one is not already configured:

```bash
aws configure --profile promohub
export AWS_PROFILE=promohub
```

Set deployment variables. Change every value marked `CHANGE_ME` before continuing:

```bash
export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export KEY_NAME="promohub-ec2-key"
export EC2_NAME="promohub-ec2"
export ECR_BACKEND="promohub-backend"
export ECR_FRONTEND="promohub-frontend"
export RDS_INSTANCE="promohub-postgres"
export RDS_DB="promohub_db"
export RDS_USER="promohub_admin"
export RDS_PASSWORD="CHANGE_ME_USE_A_LONG_RANDOM_VALUE"
export JWT_SECRET="CHANGE_ME_USE_A_LONG_RANDOM_VALUE"
export AWS_DEFAULT_REGION="$AWS_REGION"
```

Confirm the selected account and region:

```bash
aws sts get-caller-identity
aws configure get region
```

### 2. Create an EC2 key pair

Create the key pair and restrict the private key permissions. Keep this file private; it cannot be downloaded again from AWS:

```bash
aws ec2 create-key-pair \
	--key-name "$KEY_NAME" \
	--query 'KeyMaterial' \
	--output text > "${KEY_NAME}.pem"

chmod 400 "${KEY_NAME}.pem"
```

### 3. Create security groups

The EC2 security group allows SSH only from your current public IP and HTTP from the internet. The RDS security group allows PostgreSQL only from the EC2 security group:

```bash
export MY_IP="$(curl -s https://checkip.amazonaws.com)/32"

export VPC_ID="$(aws ec2 describe-vpcs \
	--filters Name=is-default,Values=true \
	--query 'Vpcs[0].VpcId' --output text)"

export EC2_SG_ID="$(aws ec2 create-security-group \
	--group-name promohub-ec2-sg \
	--description 'PromoHub EC2 public web access' \
	--vpc-id "$VPC_ID" \
	--query GroupId --output text)"

export RDS_SG_ID="$(aws ec2 create-security-group \
	--group-name promohub-rds-sg \
	--description 'PromoHub RDS access from EC2 only' \
	--vpc-id "$VPC_ID" \
	--query GroupId --output text)"

aws ec2 authorize-security-group-ingress \
	--group-id "$EC2_SG_ID" --protocol tcp --port 22 --cidr "$MY_IP"

aws ec2 authorize-security-group-ingress \
	--group-id "$EC2_SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
	--group-id "$RDS_SG_ID" --protocol tcp --port 5432 \
	--source-group "$EC2_SG_ID"
```

Do not add `0.0.0.0/0` to SSH or the RDS security group. If you later add HTTPS, authorize port `443` and put TLS in front of the application.

### 4. Create ECR repositories

```bash
aws ecr create-repository --repository-name "$ECR_BACKEND" --region "$AWS_REGION"
aws ecr create-repository --repository-name "$ECR_FRONTEND" --region "$AWS_REGION"

export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
aws ecr get-login-password --region "$AWS_REGION" | \
	docker login --username AWS --password-stdin "$ECR_REGISTRY"
```

### 5. Add the production container files

Create `backend/Dockerfile` with this content:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
EXPOSE 5000
CMD ["npm", "start"]
```

Create `frontend/Dockerfile` with this content:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Create `frontend/nginx.conf` with this content:

```nginx
server {
	listen 80;
	server_name _;
	root /usr/share/nginx/html;
	index index.html;

	location /api/ {
		proxy_pass http://backend:5000;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	}

	location /health {
		proxy_pass http://backend:5000;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
	}

	location / {
		try_files $uri $uri/ /index.html;
	}
}
```

The backend currently seeds the demo admin account `admin@promohub.com` with password `admin123`. Change that application behavior before using this deployment with real users.

### 6. Build and push the images to ECR

Run these commands from the repository root:

```bash
docker build -t "$ECR_BACKEND:latest" ./backend
docker build -t "$ECR_FRONTEND:latest" ./frontend

docker tag "$ECR_BACKEND:latest" "$ECR_REGISTRY/$ECR_BACKEND:latest"
docker tag "$ECR_FRONTEND:latest" "$ECR_REGISTRY/$ECR_FRONTEND:latest"

docker push "$ECR_REGISTRY/$ECR_BACKEND:latest"
docker push "$ECR_REGISTRY/$ECR_FRONTEND:latest"
```

Verify that both images exist:

```bash
aws ecr describe-images --repository-name "$ECR_BACKEND" --query 'imageDetails[].imageTags' --output table
aws ecr describe-images --repository-name "$ECR_FRONTEND" --query 'imageDetails[].imageTags' --output table
```

### 7. Create the RDS PostgreSQL instance

This creates a single-AZ, publicly inaccessible PostgreSQL instance in the default VPC. It may take several minutes:

```bash
aws rds create-db-instance \
	--db-instance-identifier "$RDS_INSTANCE" \
	--db-instance-class db.t4g.micro \
	--engine postgres \
	--engine-version 16 \
	--allocated-storage 20 \
	--storage-type gp3 \
	--master-username "$RDS_USER" \
	--master-user-password "$RDS_PASSWORD" \
	--db-name "$RDS_DB" \
	--vpc-security-group-ids "$RDS_SG_ID" \
	--backup-retention-period 7 \
	--no-publicly-accessible \
	--no-multi-az \
	--region "$AWS_REGION"

aws rds wait db-instance-available \
	--db-instance-identifier "$RDS_INSTANCE" \
	--region "$AWS_REGION"

export RDS_ENDPOINT="$(aws rds describe-db-instances \
	--db-instance-identifier "$RDS_INSTANCE" \
	--query 'DBInstances[0].Endpoint.Address' --output text)"

echo "$RDS_ENDPOINT"
```

Create the backend connection string. URL-encode the password if it contains characters such as `@`, `:`, `/`, or `#`:

```bash
export DATABASE_URL="postgresql://${RDS_USER}:${RDS_PASSWORD}@${RDS_ENDPOINT}:5432/${RDS_DB}"
```

The backend automatically creates its tables and demo data when it starts with `DATABASE_URL` set. Do not publish `DATABASE_URL`, `RDS_PASSWORD`, or `JWT_SECRET` in Git.

### 8. Create an EC2 IAM role for ECR pulls

Create a role that lets EC2 obtain temporary ECR credentials. The instance profile is attached when the instance is launched:

```bash
cat > ec2-trust-policy.json <<'JSON'
{
	"Version": "2012-10-17",
	"Statement": [{
		"Effect": "Allow",
		"Principal": { "Service": "ec2.amazonaws.com" },
		"Action": "sts:AssumeRole"
	}]
}
JSON

aws iam create-role \
	--role-name promohub-ec2-ecr-role \
	--assume-role-policy-document file://ec2-trust-policy.json

aws iam attach-role-policy \
	--role-name promohub-ec2-ecr-role \
	--policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

aws iam create-instance-profile \
	--instance-profile-name promohub-ec2-profile

aws iam add-role-to-instance-profile \
	--instance-profile-name promohub-ec2-profile \
	--role-name promohub-ec2-ecr-role
```

### 9. Launch EC2 manually

Find the latest Amazon Linux 2023 x86_64 AMI and launch a small instance. The user-data script installs Docker, logs in to ECR, writes the runtime environment file, and starts both containers:

```bash
export AMI_ID="$(aws ssm get-parameter \
	--name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
	--query 'Parameter.Value' --output text --region "$AWS_REGION")"

cat > ec2-user-data.sh <<EOF
#!/bin/bash
set -euxo pipefail
dnf update -y
dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user
mkdir -p /opt/promohub
cat > /opt/promohub/.env <<'ENV'
DATABASE_URL=$DATABASE_URL
NODE_ENV=production
CLIENT_ORIGIN=http://REPLACE_WITH_EC2_PUBLIC_IP
JWT_SECRET=$JWT_SECRET
ENV
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
docker network create promohub-network || true
docker pull $ECR_REGISTRY/$ECR_BACKEND:latest
docker pull $ECR_REGISTRY/$ECR_FRONTEND:latest
docker rm -f promohub-backend promohub-frontend 2>/dev/null || true
docker run -d --name promohub-backend --restart unless-stopped --network promohub-network --env-file /opt/promohub/.env $ECR_REGISTRY/$ECR_BACKEND:latest
docker run -d --name promohub-frontend --restart unless-stopped --network promohub-network -p 80:80 $ECR_REGISTRY/$ECR_FRONTEND:latest
EOF

export INSTANCE_ID="$(aws ec2 run-instances \
	--image-id "$AMI_ID" \
	--instance-type t3.micro \
	--key-name "$KEY_NAME" \
	--security-group-ids "$EC2_SG_ID" \
	--iam-instance-profile Name=promohub-ec2-profile \
	--user-data file://ec2-user-data.sh \
	--tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$EC2_NAME}]" \
	--query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
export EC2_PUBLIC_IP="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
echo "PromoHub URL: http://$EC2_PUBLIC_IP"
```

The `CLIENT_ORIGIN` value in the generated file is a placeholder. The backend CORS setting should contain the actual public URL. Update it over SSH after the instance starts:

```bash
ssh -i "${KEY_NAME}.pem" ec2-user@$EC2_PUBLIC_IP \
	"sudo sed -i 's#http://REPLACE_WITH_EC2_PUBLIC_IP#http://$EC2_PUBLIC_IP#' /opt/promohub/.env && sudo docker restart promohub-backend"
```

### 10. Verify the deployment

Wait for the user-data script to finish, then check the EC2 containers and public endpoints:

```bash
ssh -i "${KEY_NAME}.pem" ec2-user@$EC2_PUBLIC_IP \
	"sudo docker ps && sudo docker logs --tail 50 promohub-backend"

curl "http://$EC2_PUBLIC_IP/health"
curl "http://$EC2_PUBLIC_IP/api/deals"
```

Open `http://$EC2_PUBLIC_IP` in a browser. A healthy response from `/health` should show PostgreSQL rather than the local SQLite fallback.

### 11. Updating the application

After code changes, rebuild and push both images. Then pull and restart the containers on EC2:

```bash
docker build -t "$ECR_BACKEND:latest" ./backend
docker build -t "$ECR_FRONTEND:latest" ./frontend
docker tag "$ECR_BACKEND:latest" "$ECR_REGISTRY/$ECR_BACKEND:latest"
docker tag "$ECR_FRONTEND:latest" "$ECR_REGISTRY/$ECR_FRONTEND:latest"
docker push "$ECR_REGISTRY/$ECR_BACKEND:latest"
docker push "$ECR_REGISTRY/$ECR_FRONTEND:latest"

ssh -i "${KEY_NAME}.pem" ec2-user@$EC2_PUBLIC_IP <<EOF
sudo aws ecr get-login-password --region $AWS_REGION | sudo docker login --username AWS --password-stdin $ECR_REGISTRY
sudo docker pull $ECR_REGISTRY/$ECR_BACKEND:latest
sudo docker pull $ECR_REGISTRY/$ECR_FRONTEND:latest
sudo docker rm -f promohub-backend promohub-frontend
sudo docker run -d --name promohub-backend --restart unless-stopped --network promohub-network --env-file /opt/promohub/.env $ECR_REGISTRY/$ECR_BACKEND:latest
sudo docker run -d --name promohub-frontend --restart unless-stopped --network promohub-network -p 80:80 $ECR_REGISTRY/$ECR_FRONTEND:latest
EOF
```

### 12. Clean up AWS resources

Run this only when you intentionally want to delete the deployment. RDS deletion is destructive; create a final snapshot if the data matters:

```bash
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"

aws rds delete-db-instance \
	--db-instance-identifier "$RDS_INSTANCE" \
	--skip-final-snapshot

aws ecr delete-repository --repository-name "$ECR_BACKEND" --force
aws ecr delete-repository --repository-name "$ECR_FRONTEND" --force
aws ec2 delete-security-group --group-id "$EC2_SG_ID"
aws ec2 delete-security-group --group-id "$RDS_SG_ID"
aws ec2 delete-key-pair --key-name "$KEY_NAME"
rm -f "${KEY_NAME}.pem" ec2-trust-policy.json ec2-user-data.sh
```
