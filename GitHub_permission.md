# The full setup — an OIDC identity provider so AWS trusts GitHub directly (no long-lived keys), plus the role itself scoped to just ECR push and ECS deploy permissions.

## 1. Create the GitHub OIDC provider in AWS (one-time per account)

```bash
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1"
```

If this fails saying the provider already exists, that's fine — it means a previous workflow in this account already set it up; skip to step 2.

## 2. Create the trust policy (scoped to your specific repo)

Replace `YOUR_GITHUB_USERNAME/YOUR_REPO_NAME` with your actual repo path (e.g. `okorochristian/promohub-scalable-web-platform`):

```bash
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export GITHUB_REPO="YOUR_GITHUB_USERNAME/YOUR_REPO_NAME"

cat > github-trust-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:ref:refs/heads/main"
      }
    }
  }]
}
JSON
```

The `sub` condition restricts this so **only workflows running on your `main` branch, in your exact repo** can assume this role — nothing else, from any other repo, can use it.

## 3. Create the role

```bash
aws iam create-role \
  --role-name github-actions-deploy-role \
  --assume-role-policy-document file://github-trust-policy.json
```

## 4. Attach a permissions policy — scoped to only what the workflow needs

```bash
cat > github-deploy-permissions.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": [
        "arn:aws:ecr:us-east-1:${AWS_ACCOUNT_ID}:repository/promohub-backend",
        "arn:aws:ecr:us-east-1:${AWS_ACCOUNT_ID}:repository/promohub-frontend"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ],
      "Resource": [
        "arn:aws:ecs:us-east-1:${AWS_ACCOUNT_ID}:service/promohub-cluster/promohub-backend-svc",
        "arn:aws:ecs:us-east-1:${AWS_ACCOUNT_ID}:service/promohub-cluster/promohub-frontend-svc"
      ]
    }
  ]
}
JSON

aws iam put-role-policy \
  --role-name github-actions-deploy-role \
  --policy-name promohub-deploy-permissions \
  --policy-document file://github-deploy-permissions.json
```

## 5. Confirm the role ARN and update your workflow file

```bash
aws iam get-role --role-name github-actions-deploy-role --query 'Role.Arn' --output text
```

Copy that ARN into `.github/workflows/deploy.yml`, replacing the placeholder in:
```yaml
role-to-assume: arn:aws:iam::ACCOUNT_ID:role/github-actions-deploy-role
```

## 6. Test it

Push a commit to `main` and check the **Actions** tab in your GitHub repo. If the `configure-aws-credentials` step succeeds without an "Access Denied" or "Not authorized to perform sts:AssumeRoleWithWebIdentity" error, the trust relationship is working correctly.

One thing to double check: the ECS resource ARNs above use `/service/CLUSTER/SERVICE` naming, which assumes you've already created `promohub-cluster` and both services from the earlier guide — if you haven't provisioned those yet, this policy will still attach fine, it just won't have anything to act on until they exist.