# PromoHub — Scalable & Secured AWS Deployment (from scratch)

This provisions a new environment from zero: custom VPC with public/private subnets across 2 AZs, ECS Fargate for the app containers, an Application Load Balancer, CloudFront + ACM for TLS, Multi-AZ RDS PostgreSQL, Secrets Manager for credentials, and Route 53 (or Namecheap) for DNS.

```
Users -> Route 53 -> CloudFront (TLS via ACM) -> ALB (public subnets)
       -> ECS Fargate: frontend + backend (private subnets)
       -> RDS PostgreSQL Multi-AZ (private subnets)
```

Run all commands from Git Bash. Replace every `CHANGE_ME` value before running.

---

## 0. Set up variables

```bash
export AWS_REGION="us-east-1"
export AWS_PROFILE="promohub"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

export PROJECT="promohub"
export VPC_CIDR="10.20.0.0/16"
export PUB_SUBNET_A_CIDR="10.20.1.0/24"
export PUB_SUBNET_B_CIDR="10.20.2.0/24"
export PRIV_APP_SUBNET_A_CIDR="10.20.11.0/24"
export PRIV_APP_SUBNET_B_CIDR="10.20.12.0/24"
export PRIV_DB_SUBNET_A_CIDR="10.20.21.0/24"
export PRIV_DB_SUBNET_B_CIDR="10.20.22.0/24"
export AZ_A="${AWS_REGION}a"
export AZ_B="${AWS_REGION}b"

export DOMAIN="okorochristian.online"
export RDS_USER="promohub_admin"
export RDS_PASSWORD="CHANGE_ME_$(openssl rand -base64 18 | tr -d '=+/')"
export JWT_SECRET="$(openssl rand -base64 32)"
```

Keep this terminal session open throughout — every later step depends on these exports. If you close it, re-run this block first.

---

## 1. VPC and subnets

```bash
export VPC_ID="$(aws ec2 create-vpc --cidr-block "$VPC_CIDR" \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$PROJECT-vpc}]" \
  --query 'Vpc.VpcId' --output text)"

aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames

export IGW_ID="$(aws ec2 create-internet-gateway \
  --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$PROJECT-igw}]" \
  --query 'InternetGateway.InternetGatewayId' --output text)"
aws ec2 attach-internet-gateway --vpc-id "$VPC_ID" --internet-gateway-id "$IGW_ID"

# Public subnets (for ALB and NAT gateways)
export PUB_SUBNET_A="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$PUB_SUBNET_A_CIDR" \
  --availability-zone "$AZ_A" --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-public-a}]" \
  --query 'Subnet.SubnetId' --output text)"
export PUB_SUBNET_B="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$PUB_SUBNET_B_CIDR" \
  --availability-zone "$AZ_B" --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-public-b}]" \
  --query 'Subnet.SubnetId' --output text)"
aws ec2 modify-subnet-attribute --subnet-id "$PUB_SUBNET_A" --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id "$PUB_SUBNET_B" --map-public-ip-on-launch

# Private app subnets (ECS Fargate tasks)
export PRIV_APP_SUBNET_A="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$PRIV_APP_SUBNET_A_CIDR" \
  --availability-zone "$AZ_A" --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-app-a}]" \
  --query 'Subnet.SubnetId' --output text)"
export PRIV_APP_SUBNET_B="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$PRIV_APP_SUBNET_B_CIDR" \
  --availability-zone "$AZ_B" --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-app-b}]" \
  --query 'Subnet.SubnetId' --output text)"

# Private DB subnets (RDS)
export PRIV_DB_SUBNET_A="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$PRIV_DB_SUBNET_A_CIDR" \
  --availability-zone "$AZ_A" --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-db-a}]" \
  --query 'Subnet.SubnetId' --output text)"
export PRIV_DB_SUBNET_B="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$PRIV_DB_SUBNET_B_CIDR" \
  --availability-zone "$AZ_B" --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-db-b}]" \
  --query 'Subnet.SubnetId' --output text)"
```

### NAT gateways (let private app subnets reach the internet for ECR pulls, outbound API calls)

```bash
export EIP_A="$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)"
export EIP_B="$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)"

export NAT_A="$(aws ec2 create-nat-gateway --subnet-id "$PUB_SUBNET_A" --allocation-id "$EIP_A" \
  --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=$PROJECT-nat-a}]" \
  --query 'NatGateway.NatGatewayId' --output text)"
export NAT_B="$(aws ec2 create-nat-gateway --subnet-id "$PUB_SUBNET_B" --allocation-id "$EIP_B" \
  --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=$PROJECT-nat-b}]" \
  --query 'NatGateway.NatGatewayId' --output text)"

echo "Waiting for NAT gateways to become available (a few minutes)..."
aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_A" "$NAT_B"
```

### Route tables

```bash
# Public route table -> Internet Gateway
export PUB_RT="$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT-public-rt}]" \
  --query 'RouteTable.RouteTableId' --output text)"
aws ec2 create-route --route-table-id "$PUB_RT" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID"
aws ec2 associate-route-table --route-table-id "$PUB_RT" --subnet-id "$PUB_SUBNET_A"
aws ec2 associate-route-table --route-table-id "$PUB_RT" --subnet-id "$PUB_SUBNET_B"

# Private route tables -> NAT Gateway (one per AZ)
export PRIV_RT_A="$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT-private-rt-a}]" \
  --query 'RouteTable.RouteTableId' --output text)"
aws ec2 create-route --route-table-id "$PRIV_RT_A" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT_A"
aws ec2 associate-route-table --route-table-id "$PRIV_RT_A" --subnet-id "$PRIV_APP_SUBNET_A"

export PRIV_RT_B="$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT-private-rt-b}]" \
  --query 'RouteTable.RouteTableId' --output text)"
aws ec2 create-route --route-table-id "$PRIV_RT_B" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT_B"
aws ec2 associate-route-table --route-table-id "$PRIV_RT_B" --subnet-id "$PRIV_APP_SUBNET_B"

# DB subnets: no internet route needed at all (stays fully private)
```

---

## 2. Security groups

```bash
export ALB_SG="$(aws ec2 create-security-group --group-name "$PROJECT-alb-sg" \
  --description "PromoHub ALB" --vpc-id "$VPC_ID" --query 'GroupId' --output text)"
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" --protocol tcp --port 443 --cidr 0.0.0.0/0

export APP_SG="$(aws ec2 create-security-group --group-name "$PROJECT-app-sg" \
  --description "PromoHub ECS tasks" --vpc-id "$VPC_ID" --query 'GroupId' --output text)"
aws ec2 authorize-security-group-ingress --group-id "$APP_SG" --protocol tcp --port 80 --source-group "$ALB_SG"
aws ec2 authorize-security-group-ingress --group-id "$APP_SG" --protocol tcp --port 5000 --source-group "$ALB_SG"

export DB_SG="$(aws ec2 create-security-group --group-name "$PROJECT-db-sg" \
  --description "PromoHub RDS" --vpc-id "$VPC_ID" --query 'GroupId' --output text)"
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 5432 --source-group "$APP_SG"
```

No SSH rule anywhere — there's no server to SSH into. All management happens through ECS/CI-CD.

---

## 3. RDS PostgreSQL (Multi-AZ)

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name "$PROJECT-db-subnet-group" \
  --db-subnet-group-description "PromoHub DB subnets" \
  --subnet-ids "$PRIV_DB_SUBNET_A" "$PRIV_DB_SUBNET_B"

aws rds create-db-instance \
  --db-instance-identifier "$PROJECT-postgres" \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16 \
  --allocated-storage 20 \
  --storage-type gp3 \
  --master-username "$RDS_USER" \
  --master-user-password "$RDS_PASSWORD" \
  --db-name "promohub_db" \
  --vpc-security-group-ids "$DB_SG" \
  --db-subnet-group-name "$PROJECT-db-subnet-group" \
  --backup-retention-period 7 \
  --multi-az \
  --no-publicly-accessible \
  --region "$AWS_REGION"

echo "Waiting for RDS (several minutes)..."
aws rds wait db-instance-available --db-instance-identifier "$PROJECT-postgres"

export RDS_ENDPOINT="$(aws rds describe-db-instances \
  --db-instance-identifier "$PROJECT-postgres" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
export DATABASE_URL="postgresql://${RDS_USER}:${RDS_PASSWORD}@${RDS_ENDPOINT}:5432/promohub_db"
echo "$RDS_ENDPOINT"
```

---

## 4. Secrets Manager

```bash
aws secretsmanager create-secret --name "$PROJECT/database-url" \
  --secret-string "$DATABASE_URL"
aws secretsmanager create-secret --name "$PROJECT/jwt-secret" \
  --secret-string "$JWT_SECRET"

export DB_SECRET_ARN="$(aws secretsmanager describe-secret --secret-id "$PROJECT/database-url" --query 'ARN' --output text)"
export JWT_SECRET_ARN="$(aws secretsmanager describe-secret --secret-id "$PROJECT/jwt-secret" --query 'ARN' --output text)"
```

---

## 5. ECR repositories and images

```bash
export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
aws ecr create-repository --repository-name "$PROJECT-backend" --image-scanning-configuration scanOnPush=true
aws ecr create-repository --repository-name "$PROJECT-frontend" --image-scanning-configuration scanOnPush=true

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker build -t "$PROJECT-backend" -f backend/Dockerfile ./backend
docker build -t "$PROJECT-frontend" -f frontend/Dockerfile ./frontend

docker tag "$PROJECT-backend:latest" "$ECR_REGISTRY/$PROJECT-backend:latest"
docker tag "$PROJECT-frontend:latest" "$ECR_REGISTRY/$PROJECT-frontend:latest"

docker push "$ECR_REGISTRY/$PROJECT-backend:latest"
docker push "$ECR_REGISTRY/$PROJECT-frontend:latest"
```

`frontend/nginx.conf` should proxy `/api/` and `/health` to `http://localhost:5000` (the two containers will run as separate ECS *services* behind the same ALB, reached via different target groups/paths — not via Docker network container-name resolution as in the single-EC2 setup).

---

## 6. IAM roles for ECS

```bash
cat > ecs-trust-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
JSON

# Execution role: lets ECS pull images from ECR and write logs
aws iam create-role --role-name "$PROJECT-ecs-execution-role" \
  --assume-role-policy-document file://ecs-trust-policy.json
aws iam attach-role-policy --role-name "$PROJECT-ecs-execution-role" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

cat > secrets-access-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": ["$DB_SECRET_ARN", "$JWT_SECRET_ARN"]
  }]
}
JSON
aws iam put-role-policy --role-name "$PROJECT-ecs-execution-role" \
  --policy-name "$PROJECT-secrets-access" --policy-document file://secrets-access-policy.json

# Task role: permissions the app itself needs at runtime (expand later if it calls other AWS services)
aws iam create-role --role-name "$PROJECT-ecs-task-role" \
  --assume-role-policy-document file://ecs-trust-policy.json

export EXEC_ROLE_ARN="$(aws iam get-role --role-name $PROJECT-ecs-execution-role --query 'Role.Arn' --output text)"
export TASK_ROLE_ARN="$(aws iam get-role --role-name $PROJECT-ecs-task-role --query 'Role.Arn' --output text)"
```

---

## 7. CloudWatch log groups

```bash
aws logs create-log-group --log-group-name "/ecs/$PROJECT-backend"
aws logs create-log-group --log-group-name "/ecs/$PROJECT-frontend"
```

---

## 8. ECS cluster and task definitions

```bash
aws ecs create-cluster --cluster-name "$PROJECT-cluster" --capacity-providers FARGATE

cat > backend-task-def.json <<JSON
{
  "family": "$PROJECT-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "$EXEC_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "containerDefinitions": [{
    "name": "backend",
    "image": "$ECR_REGISTRY/$PROJECT-backend:latest",
    "portMappings": [{ "containerPort": 5000, "protocol": "tcp" }],
    "environment": [{ "name": "NODE_ENV", "value": "production" }],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "$DB_SECRET_ARN" },
      { "name": "JWT_SECRET", "valueFrom": "$JWT_SECRET_ARN" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/$PROJECT-backend",
        "awslogs-region": "$AWS_REGION",
        "awslogs-stream-prefix": "backend"
      }
    }
  }]
}
JSON
aws ecs register-task-definition --cli-input-json file://backend-task-def.json

cat > frontend-task-def.json <<JSON
{
  "family": "$PROJECT-frontend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "$EXEC_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "containerDefinitions": [{
    "name": "frontend",
    "image": "$ECR_REGISTRY/$PROJECT-frontend:latest",
    "portMappings": [{ "containerPort": 80, "protocol": "tcp" }],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/$PROJECT-frontend",
        "awslogs-region": "$AWS_REGION",
        "awslogs-stream-prefix": "frontend"
      }
    }
  }]
}
JSON
aws ecs register-task-definition --cli-input-json file://frontend-task-def.json
```

---

## 9. Application Load Balancer, target groups, listeners

```bash
export ALB_ARN="$(aws elbv2 create-load-balancer --name "$PROJECT-alb" \
  --subnets "$PUB_SUBNET_A" "$PUB_SUBNET_B" --security-groups "$ALB_SG" \
  --scheme internet-facing --type application \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
export ALB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)"

export BACKEND_TG_ARN="$(aws elbv2 create-target-group --name "$PROJECT-backend-tg" \
  --protocol HTTP --port 5000 --vpc-id "$VPC_ID" --target-type ip \
  --health-check-path "/health" \
  --query 'TargetGroups[0].TargetGroupArn' --output text)"

export FRONTEND_TG_ARN="$(aws elbv2 create-target-group --name "$PROJECT-frontend-tg" \
  --protocol HTTP --port 80 --vpc-id "$VPC_ID" --target-type ip \
  --health-check-path "/" \
  --query 'TargetGroups[0].TargetGroupArn' --output text)"

# HTTP listener: default to frontend, /api/* to backend
export HTTP_LISTENER_ARN="$(aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" \
  --protocol HTTP --port 80 \
  --default-actions "Type=forward,TargetGroupArn=$FRONTEND_TG_ARN" \
  --query 'Listeners[0].ListenerArn' --output text)"

aws elbv2 create-rule --listener-arn "$HTTP_LISTENER_ARN" --priority 10 \
  --conditions "Field=path-pattern,Values='/api/*'" \
  --actions "Type=forward,TargetGroupArn=$BACKEND_TG_ARN"
```

The HTTPS (443) listener is added in Step 11, once the ACM certificate exists.

---

## 10. ECS services (this launches the containers)

```bash
aws ecs create-service \
  --cluster "$PROJECT-cluster" \
  --service-name "$PROJECT-backend-svc" \
  --task-definition "$PROJECT-backend" \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIV_APP_SUBNET_A,$PRIV_APP_SUBNET_B],securityGroups=[$APP_SG],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=$BACKEND_TG_ARN,containerName=backend,containerPort=5000"

aws ecs create-service \
  --cluster "$PROJECT-cluster" \
  --service-name "$PROJECT-frontend-svc" \
  --task-definition "$PROJECT-frontend" \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIV_APP_SUBNET_A,$PRIV_APP_SUBNET_B],securityGroups=[$APP_SG],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=$FRONTEND_TG_ARN,containerName=frontend,containerPort=80"
```

`desired-count 2` gives you 2 running tasks per service across the 2 AZs from the start — this is the baseline that makes the deployment actually highly available. Wait a few minutes, then check:

```bash
aws ecs describe-services --cluster "$PROJECT-cluster" --services "$PROJECT-backend-svc" "$PROJECT-frontend-svc" \
  --query 'services[].{name:serviceName,running:runningCount,desired:desiredCount}'

curl "http://$ALB_DNS/health"
```

### Auto scaling (scale out under load)

```bash
aws application-autoscaling register-scalable-target \
  --service-namespace ecs --resource-id "service/$PROJECT-cluster/$PROJECT-backend-svc" \
  --scalable-dimension ecs:service:DesiredCount --min-capacity 2 --max-capacity 10

aws application-autoscaling put-scaling-policy \
  --service-namespace ecs --resource-id "service/$PROJECT-cluster/$PROJECT-backend-svc" \
  --scalable-dimension ecs:service:DesiredCount --policy-name "$PROJECT-backend-cpu-scaling" \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 60.0,
    "PredefinedMetricSpecification": { "PredefinedMetricType": "ECSServiceAverageCPUUtilization" },
    "ScaleInCooldown": 120,
    "ScaleOutCooldown": 60
  }'
```

Repeat the same two commands with `$PROJECT-frontend-svc` for the frontend service.

---

## 11. ACM certificate and HTTPS

```bash
export CERT_ARN="$(aws acm request-certificate \
  --domain-name "$DOMAIN" --subject-alternative-names "www.$DOMAIN" \
  --validation-method DNS --query 'CertificateArn' --output text)"

aws acm describe-certificate --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

Add the returned CNAME record(s) at your DNS provider (Namecheap → Advanced DNS → add the given Host/Value as a CNAME record) to prove domain ownership. Then wait for issuance:

```bash
aws acm wait certificate-validated --certificate-arn "$CERT_ARN"
```

Add the HTTPS listener and redirect HTTP → HTTPS:

```bash
aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS --port 443 --certificates "CertificateArn=$CERT_ARN" \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --default-actions "Type=forward,TargetGroupArn=$FRONTEND_TG_ARN"

aws elbv2 create-rule --listener-arn "$(aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN --query "Listeners[?Port==\`443\`].ListenerArn" --output text)" \
  --priority 10 --conditions "Field=path-pattern,Values='/api/*'" \
  --actions "Type=forward,TargetGroupArn=$BACKEND_TG_ARN"

aws elbv2 modify-listener --listener-arn "$HTTP_LISTENER_ARN" \
  --default-actions "Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}"
```

---

## 12. CloudFront (CDN in front of the ALB)

```bash
cat > cf-config.json <<JSON
{
  "CallerReference": "$PROJECT-$(date +%s)",
  "Comment": "$PROJECT CDN",
  "Enabled": true,
  "Aliases": { "Quantity": 2, "Items": ["$DOMAIN", "www.$DOMAIN"] },
  "ViewerCertificate": {
    "ACMCertificateArn": "$CERT_ARN",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "alb-origin",
      "DomainName": "$ALB_DNS",
      "CustomOriginConfig": {
        "HTTPPort": 80, "HTTPSPort": 443, "OriginProtocolPolicy": "https-only"
      }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "alb-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 7, "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3"
  }
}
JSON
```

**Note:** the ACM certificate used by CloudFront must be issued in `us-east-1` regardless of which region your other resources live in — if `$AWS_REGION` above wasn't already `us-east-1`, request a separate certificate in `us-east-1` for this step.

```bash
export CF_DISTRIBUTION_ID="$(aws cloudfront create-distribution --distribution-config file://cf-config.json \
  --query 'Distribution.Id' --output text)"
export CF_DOMAIN="$(aws cloudfront get-distribution --id "$CF_DISTRIBUTION_ID" \
  --query 'Distribution.DomainName' --output text)"
echo "$CF_DOMAIN"
```

---

## 13. DNS — point the domain at CloudFront (Namecheap)

CloudFront distributions don't have a static IP, so use CNAME records instead of A records:

1. Namecheap → Domain List → `okorochristian.online` → Manage → Advanced DNS
2. Add CNAME record: Host `@` *(Namecheap may require using their "ALIAS" or "URL Redirect" record type for root-domain CNAMEs — check what's available; alternatively migrate DNS to Route 53, which supports root-domain ALIAS records natively)*, Value: the `$CF_DOMAIN` value from above
3. Add CNAME record: Host `www`, Value: the same `$CF_DOMAIN` value

Verify:
```bash
nslookup okorochristian.online
curl "https://okorochristian.online/health"
```

---

## 14. WAF (optional but recommended)

```bash
aws wafv2 create-web-acl --name "$PROJECT-waf" --scope CLOUDFRONT --region us-east-1 \
  --default-action Allow={} \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName="$PROJECT-waf" \
  --rules '[{
    "Name": "AWS-AWSManagedRulesCommonRuleSet",
    "Priority": 0,
    "OverrideAction": { "None": {} },
    "Statement": { "ManagedRuleGroupStatement": { "VendorName": "AWS", "Name": "AWSManagedRulesCommonRuleSet" } },
    "VisibilityConfig": { "SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "commonRules" }
  }]'
```

Then associate the resulting Web ACL ARN with the CloudFront distribution (via `aws cloudfront update-distribution` or the console → CloudFront → your distribution → Security → WAF).

---

## 15. CI/CD (GitHub Actions example)

Add `.github/workflows/deploy.yml`:

```yaml
name: Deploy to ECS
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::338970088142:role/github-actions-deploy-role
          aws-region: us-east-1
      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr
      - name: Build and push backend
        run: |
          docker build -t ${{ steps.ecr.outputs.registry }}/promohub-backend:${{ github.sha }} -f backend/Dockerfile ./backend
          docker push ${{ steps.ecr.outputs.registry }}/promohub-backend:${{ github.sha }}
      - name: Build and push frontend
        run: |
          docker build -t ${{ steps.ecr.outputs.registry }}/promohub-frontend:${{ github.sha }} -f frontend/Dockerfile ./frontend
          docker push ${{ steps.ecr.outputs.registry }}/promohub-frontend:${{ github.sha }}
      - name: Update ECS services
        run: |
          aws ecs update-service --cluster promohub-cluster --service promohub-backend-svc --force-new-deployment
          aws ecs update-service --cluster promohub-cluster --service promohub-frontend-svc --force-new-deployment
```

Set up an IAM role for GitHub's OIDC provider (`github-actions-deploy-role` above) scoped to ECR push and ECS update-service permissions only — avoids storing long-lived AWS keys in GitHub secrets entirely.

---

## 16. Verification checklist

```bash
curl "https://okorochristian.online/health"
curl "https://okorochristian.online/api/deals"

aws ecs describe-services --cluster "$PROJECT-cluster" \
  --services "$PROJECT-backend-svc" "$PROJECT-frontend-svc"

aws rds describe-db-instances --db-instance-identifier "$PROJECT-postgres" \
  --query 'DBInstances[0].{Status:DBInstanceStatus,MultiAZ:MultiAZ}'
```

Open `https://okorochristian.online` in a browser and confirm the padlock shows a valid certificate.

---

## Teardown (only when intentionally decommissioning)

Delete in this order — reverse of creation, so dependencies clear cleanly: CloudFront distribution (disable first, then delete) → ALB listeners/rules → ALB → target groups → ECS services (scale to 0, then delete) → ECS cluster → RDS instance (`--skip-final-snapshot` or take a snapshot first) → NAT gateways → Elastic IPs (release) → route tables → subnets → internet gateway (detach, then delete) → VPC → security groups → ECR repositories → Secrets Manager secrets → IAM roles.