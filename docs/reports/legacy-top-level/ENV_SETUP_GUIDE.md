# 🔧 ENVIRONMENT SETUP GUIDE - PHASE 1

**Complete guide for configuring Boka's environment variables**

---

## 🚀 Quick Start (5 minutes)

### Step 1: Copy Environment Template
```bash
cp env.example .env.local
```

### Step 2: Add Required Variables
Edit `.env.local` and fill in these **REQUIRED** variables:

```bash
# Supabase (get from supabase.com/dashboard)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key

# Security (generate with: openssl rand -base64 32)
JWT_SECRET=your-jwt-secret
WEBHOOK_SIGNATURE_SECRET=your-webhook-secret
ENCRYPTION_KEY=your-encryption-key
```

### Step 3: Verify Configuration
```bash
npm run validate:env
# OR manually import and test:
# node -e "const {config} = require('./src/lib/config/env'); console.log('✅ Config loaded')"
```

That's it! Your environment is configured.

---

## 📖 DETAILED SETUP

### For Development (Local)

1. **Copy template**
   ```bash
   cp env.example .env.local
   ```

2. **Supabase Setup** (5 min)
   - Go to https://supabase.com/dashboard
   - Create new project (or use existing)
   - Navigate to: Settings → API
   - Copy:
     - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
     - `Anon Public Key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `Service Role Key` → `SUPABASE_SERVICE_ROLE_KEY`

3. **Generate Security Keys** (2 min)
   ```bash
   # On macOS/Linux:
   openssl rand -base64 32  # Do this 3 times for the 3 secrets
   
   # On Windows (PowerShell):
   [Convert]::ToBase64String((Get-Random -InputObject (0..255) -Count 32))
   ```
   
   Fill in `.env.local`:
   ```
   JWT_SECRET=<generated-key-1>
   WEBHOOK_SIGNATURE_SECRET=<generated-key-2>
   ENCRYPTION_KEY=<generated-key-3>
   ```

4. **Optional Features** (as needed)
   - Leave empty for now, enable later
   - See next sections for setup instructions

5. **Test Configuration**
   ```bash
   npm run dev
   # Should start without environment errors
   ```

### For Staging/Production

Use your deployment platform's secret manager:

#### GitHub Actions
```yaml
# .github/workflows/deploy.yml
env:
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
  # ... etc
```

#### Vercel
1. Go to: Project Settings → Environment Variables
2. Add each variable with proper environment scope (Production/Preview/Development)
3. Deploy will automatically use them

#### Other Platforms
Consult your platform's documentation for secret management (GitLab CI, AWS, Azure, etc.)

---

## 🔌 OPTIONAL SERVICES SETUP

### WhatsApp Integration (Evolution API)

**Effort**: 30-45 min  
**Cost**: Free trial available  
**Required for**: WhatsApp messaging features

1. Sign up: https://evolution-api.com
2. Create API key
3. Create webhook
4. Fill in `.env.local`:
   ```
   ENABLE_WHATSAPP_INTEGRATION=true
   EVOLUTION_API_KEY=your-api-key
   EVOLUTION_WEBHOOK_SECRET=your-webhook-secret
   EVOLUTION_API_BASE=https://api.evolution.example
   EVOLUTION_INSTANCE_NAME=booka_instance
   ```

### Redis (Messaging & Caching)

**Effort**: 15-30 min  
**Cost**: Free (self-hosted) or $5-20/month (managed)  
**Required for**: Dialog management, message queuing, caching

**Option A: Local (Development)**
```bash
# macOS (with Homebrew)
brew install redis
brew services start redis

# Linux
sudo apt-get install redis-server
sudo systemctl start redis-server

# Windows: Use WSL or Docker
docker run -d -p 6379:6379 redis:latest
```

**Option B: Managed Redis**
- Redis Cloud (https://redis.com/cloud) - Free tier available
- AWS ElastiCache
- Heroku Redis

Fill in `.env.local`:
```
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=  # Empty if local, fill if managed service
```

### LLM Services (AI Features)

**Effort**: 10-15 min  
**Cost**: Free tier available  
**Required for**: AI-powered features

**Option A: OpenRouter (Recommended)**
```
1. Go to: https://openrouter.ai
2. Create account, generate API key
3. Fill in .env.local:
   OPENROUTER_API_KEY=your-key
```

**Option B: OpenAI**
```
1. Go to: https://platform.openai.com
2. Create account, generate API key
3. Fill in .env.local:
   OPENAI_API_KEY=your-key
   OPENAI_MODEL=gpt-4o-mini
```

### Payment Processing

**Effort**: 30-45 min per provider  
**Cost**: Per transaction fees (2-5% typically)  
**Required for**: Payment handling

**Option A: Paystack (for African markets)**
```
1. Sign up: https://dashboard.paystack.com
2. Get API keys
3. Fill in .env.local:
   PAYSTACK_SECRET_KEY=your-secret-key
   PAYSTACK_PUBLIC_KEY=your-public-key
```

**Option B: Stripe (international)**
```
1. Sign up: https://dashboard.stripe.com
2. Get API keys
3. Fill in .env.local:
   STRIPE_SECRET_KEY=your-secret-key
   STRIPE_PUBLIC_KEY=your-public-key
   STRIPE_WEBHOOK_SECRET=your-webhook-secret
```

### Error Tracking (Sentry)

**Effort**: 5-10 min  
**Cost**: Free tier (5,000 errors/month)  
**Required for**: Production monitoring

```
1. Sign up: https://sentry.io
2. Create new project (Node.js)
3. Fill in .env.local:
   SENTRY_DSN=your-dsn-url
   SENTRY_ORG=your-org
   SENTRY_PROJECT=your-project
```

---

## 🎛️ FEATURE FLAGS CONFIGURATION

Control feature availability via environment variables:

```bash
# .env.local

# Enable WhatsApp messaging
ENABLE_WHATSAPP_INTEGRATION=true

# Enable advanced features from Phase 5
ENABLE_PHASE5_FEATURES=true

# Enable analytics dashboard
ENABLE_ANALYTICS_DASHBOARD=true

# Enable messaging adapter
ENABLE_MESSAGING_ADAPTER=false

# Enable advanced scheduler
ENABLE_ADVANCED_SCHEDULER=true
```

### Usage in Code

```typescript
import { config, isFeatureEnabled } from '@/lib/config/env';

// Check if feature is enabled
if (isFeatureEnabled('enableWhatsappIntegration')) {
  // Show WhatsApp features
}

// Or use the config object directly
if (config.features.enableAnalyticsDashboard) {
  // Show analytics
}
```

---

## 🧪 TESTING YOUR CONFIGURATION

### Option 1: In Node REPL
```bash
node
> const { config } = require('./src/lib/config/env');
> console.log(config.supabase.url);
https://your-project.supabase.co
> console.log('✅ All good!')
```

### Option 2: In Application
```typescript
// Create a test page or API route
import { config } from '@/lib/config/env';

export default function TestConfig() {
  return (
    <div>
      <h1>Configuration Test</h1>
      <p>Supabase URL: {config.supabase.url}</p>
      <p>Environment: {config.app.nodeEnv}</p>
      <p>Features enabled: {Object.keys(config.features).filter(k => config.features[k as keyof typeof config.features]).join(', ')}</p>
    </div>
  );
}
```

### Option 3: Run Tests
```bash
npm test -- env.test
# (if tests exist for env config)
```

---

## 🚨 TROUBLESHOOTING

### "NEXT_PUBLIC_SUPABASE_URL is required"
**Solution**: Missing `.env.local` file or Supabase URL not filled in
```bash
cp env.example .env.local
# Edit .env.local with your Supabase URL
```

### "Cannot connect to Supabase"
**Possible Causes**:
1. Wrong Supabase URL or key
2. Network connectivity issue
3. Supabase project not active

**Solution**:
```bash
# Test Supabase connection:
curl https://your-supabase-url/rest/v1/  # Should return something
# If fails, check keys in dashboard
```

### "Redis connection timeout"
**Possible Causes**:
1. Redis not running
2. Wrong connection string
3. Redis requires password (not provided)

**Solution**:
```bash
# Check if Redis is running:
redis-cli ping  # Should respond with PONG

# Or verify Redis URL format:
# redis://localhost:6379
# redis://user:password@host:port
```

### "OpenRouter/OpenAI API call fails"
**Possible Causes**:
1. API key invalid
2. Account has no credits
3. Invalid model name

**Solution**:
```bash
# Verify API key works:
curl -H "Authorization: Bearer YOUR_KEY" https://api.openrouter.ai/api/v1/models

# Check account status in dashboard
```

### "Feature flag not working"
**Possible Causes**:
1. Feature flag set to 'false' string instead of boolean
2. Code checking wrong feature name
3. Environment not reloaded

**Solution**:
```bash
# In .env.local, ensure:
ENABLE_WHATSAPP_INTEGRATION=true  # ✅ Correct
ENABLE_WHATSAPP_INTEGRATION='true'  # ❌ Wrong
ENABLE_WHATSAPP_INTEGRATION=1  # ❌ Wrong

# Restart dev server: npm run dev
```

---

## 🔐 SECURITY BEST PRACTICES

### DO's ✅
- ✅ Keep `.env.local` in `.gitignore` (already configured)
- ✅ Use strong, unique secrets (generate with openssl)
- ✅ Rotate secrets regularly (especially webhook signatures)
- ✅ Use HTTPS in production
- ✅ Store secrets in platform secret managers (not `.env` files)
- ✅ Never log secrets to console
- ✅ Use service accounts with minimal permissions

### DON'Ts ❌
- ❌ Never commit `.env.local` to git
- ❌ Never share secrets via Slack, Email, or Chat
- ❌ Never use same secret in dev and production
- ❌ Never paste secrets into error messages/logs
- ❌ Never use weak secrets (123456, password, etc.)
- ❌ Never expose secrets in `NEXT_PUBLIC_*` variables
- ❌ Never hardcode secrets in code

### Environment Variable Categories

**Safe to Expose** (`NEXT_PUBLIC_*`)
- Supabase URL (not the key!)
- Supabase ANON key (public, read-only)
- Public URLs
- Feature flags
- API endpoints

**Never Expose**
- Service role keys
- JWT secrets
- API keys for external services
- Webhook signatures
- Database credentials
- Encryption keys

---

## 📊 CONFIGURATION CHECKLIST

### Required Variables
- [ ] `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- [ ] `JWT_SECRET` - Session secret
- [ ] `WEBHOOK_SIGNATURE_SECRET` - Webhook verification
- [ ] `ENCRYPTION_KEY` - Data encryption

### Recommended Variables
- [ ] `REDIS_URL` - Message queue and caching
- [ ] `OPENROUTER_API_KEY` or `OPENAI_API_KEY` - LLM features
- [ ] `SENTRY_DSN` - Error tracking

### Optional Variables
- [ ] `EVOLUTION_API_KEY` - WhatsApp integration
- [ ] `PAYSTACK_SECRET_KEY` - Paystack payments
- [ ] `STRIPE_SECRET_KEY` - Stripe payments
- [ ] Feature flags (`ENABLE_*`) - Feature control

### Verification
- [ ] `.env.local` file exists
- [ ] All required variables filled
- [ ] `npm run dev` starts without errors
- [ ] No secrets logged to console
- [ ] `.env.local` in `.gitignore`

---

## 📚 ADDITIONAL RESOURCES

- [Supabase Documentation](https://supabase.com/docs)
- [Redis Setup Guide](https://redis.io/docs/getting-started/)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [Stripe Integration Guide](https://stripe.com/docs)
- [Environment Best Practices](https://12factor.net/config)

---

**Last Updated**: December 15, 2025  
**Version**: 1.0  
**Maintained By**: Boka Development Team
