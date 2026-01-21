# BOOKA IMPLEMENTATION - QUICK START GUIDE

## Phase 1: Setup (30 minutes)

### 1.1 Database Migrations

```bash
# Connect to Supabase
# Go to: https://supabase.com/dashboard

# In SQL Editor, run migrations from:
# src/lib/migrations/whatsappAndPublicBooking.ts

# Run them in order:
# 1. migration1_add_tenant_slug
# 2. migration2_whatsapp_connections  
# 3. migration3_whatsapp_message_queue
# 4. migration4_dialog_sessions
# 5. migration5_business_hours
# 6. migration6_whatsapp_message_log
```

### 1.2 Environment Configuration

```bash
# .env.local or .env.production

# WhatsApp Meta API
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token_123
WHATSAPP_APP_SECRET=your_app_secret_xyz
NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER=1234567890

# Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Public Booking
PUBLIC_BOOKING_ENABLED=true
PUBLIC_BOOKING_DOMAIN=book.booka.io
```

### 1.3 Create Sample Tenant with Slug

```sql
-- In Supabase SQL Editor
UPDATE tenants 
SET slug = LOWER(name) || '-' || SUBSTRING(id::text, 1, 4)
WHERE slug IS NULL
LIMIT 1;

-- Verify
SELECT id, name, slug FROM tenants LIMIT 1;
```

---

## Phase 2: Deploy Webhook (15 minutes)

### 2.1 Deploy to Vercel/Production

```bash
# Push to production
git add .
git commit -m "feat: WhatsApp bot + public storefront implementation"
git push origin main
```

### 2.2 Configure Meta Webhook

1. Go to Meta App Dashboard
2. Select your app
3. Go to WhatsApp > Configuration
4. Set webhook URL: `https://yourdomain.com/api/whatsapp/webhook`
5. Set verify token: `your_verify_token_123`
6. Subscribe to message events
7. Test webhook URL

### 2.3 Verify Webhook

```bash
# Test verification
curl -X GET "https://yourdomain.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=your_verify_token_123"

# Should return: test123
```

---

## Phase 3: Test End-to-End (15 minutes)

### 3.1 Manual Testing

```
1. Send WhatsApp message to your test number
   Message: "book"
   
2. Check webhook processing
   - Go to Supabase dashboard
   - Check whatsapp_message_queue table
   - Verify status is "completed"
   
3. Check booking creation
   - Check reservations table
   - Verify status is "pending"
   
4. Check notifications
   - Verify confirmation email sent to customer
   - Verify owner notification received
```

### 3.2 Verify Flow in Code

```bash
# Check logs in Vercel
# https://vercel.com/dashboard/[project]/analytics/logs

# Look for:
# ✅ "Webhook verified by Meta"
# ✅ "Received message from [phone]"
# ✅ "Intent detected: booking"
# ✅ "Sent response to [phone]"
```

---

## Phase 4: Setup Public Booking Page (30 minutes)

### 4.1 Create Booking UI Component

```bash
# Create the public booking page
mkdir -p src/app/book/[slug]/components
```

Create `src/app/book/[slug]/page.tsx`:

```typescript
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import publicBookingService from '@/lib/publicBookingService';
import BookingForm from './components/BookingForm';

export default async function PublicBookingPage({ params }: { params: { slug: string } }) {
  try {
    const tenantInfo = await publicBookingService.getTenantPublicInfo(params.slug);
    const services = await publicBookingService.getTenantServices(tenantInfo.id);

    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 py-6">
            {tenantInfo.logo && <img src={tenantInfo.logo} alt={tenantInfo.name} className="h-12" />}
            <h1 className="text-3xl font-bold text-gray-900">{tenantInfo.name}</h1>
            <p className="text-gray-600">{tenantInfo.description}</p>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-12">
          <BookingForm tenantId={tenantInfo.id} services={services} />
        </main>
      </div>
    );
  } catch (error) {
    return <div className="text-center py-12">Booking page not found</div>;
  }
}
```

### 4.2 Test Public URL

```bash
# If tenant slug is "salon-name-abc1"
# Visit: https://yourdomain.com/book/salon-name-abc1

# Should show:
# - Tenant name & logo
# - Service selection
# - Date/time picker
# - Customer form
```

---

## Phase 5: Complete Remaining Routes (6-8 hours)

### 5.1 Priority Order

1. **Admin routes** (analytics dashboard)
   - `/api/admin/analytics`
   - `/api/admin/revenue`
   - `/api/admin/bookings`

2. **Tenant management routes**
   - `/api/tenants/[id]/settings`
   - `/api/tenants/[id]/staff`
   - `/api/tenants/[id]/services`

3. **Chat/messaging routes**
   - `/api/chats`
   - `/api/chats/[id]/messages`

4. **Owner dashboard routes**
   - `/api/owner/usage`
   - `/api/owner/earnings`

### 5.2 Use Pattern

All new routes follow this pattern:

```typescript
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    // ctx.supabase, ctx.user, ctx.tenantId auto-injected
    const { data, error } = await ctx.supabase.from('table').select();
    if (error) throw ApiErrorFactory.internal('Failed to fetch');
    return { data };
  },
  'GET',
  { auth: true, roles: ['owner', 'admin'] }
);
```

---

## Phase 6: Production Checklist

- [ ] All environment variables configured
- [ ] WhatsApp webhook verified with Meta
- [ ] Database migrations completed
- [ ] Public booking page deployed
- [ ] Tested end-to-end: message → booking
- [ ] Tested: public storefront flow
- [ ] Tested: reschedule flow
- [ ] Tested: cancellation flow
- [ ] Admin dashboard working
- [ ] Error handling tested
- [ ] Rate limiting configured
- [ ] CORS configured
- [ ] SSL certificate valid
- [ ] Monitoring/logging setup

---

## Troubleshooting

### Webhook Not Receiving Messages

```
1. Verify token matches in .env
2. Check webhook URL is publicly accessible
3. Check Vercel function logs
4. Verify Meta app permissions
```

### Messages Not Processing

```
1. Check whatsapp_message_queue table
2. Verify tenant exists with phone number
3. Check Evolution API credentials
4. Look at server logs for errors
```

### Booking Not Created

```
1. Verify service exists
2. Check customer was created
3. Verify date/time parsing
4. Check reservations table constraints
```

### Public Page Not Loading

```
1. Verify tenant slug exists
2. Check services are active
3. Look at page logs
4. Verify tenant_id matches
```

---

## Deployment Timeline

- **Setup**: 30 min
- **Webhook Deploy**: 15 min
- **Testing**: 15 min
- **UI Build**: 30 min
- **Remaining Routes**: 6-8 hours
- **Bug Fixes**: 1-2 hours
- **Production Deploy**: 30 min

**Total**: ~10-12 hours

---

## Support Commands

```bash
# View webhook logs
vercel logs --tail

# Check Supabase queries
# https://supabase.com/dashboard/[project]/query-logs

# Test API endpoint locally
curl -X GET http://localhost:3000/api/public/salon-name-abc1

# Check message queue
SELECT * FROM whatsapp_message_queue ORDER BY created_at DESC LIMIT 10;

# Check dialog sessions
SELECT * FROM dialog_sessions ORDER BY updated_at DESC LIMIT 10;
```

---

## Next Phase: Optimization

After MVP is working:

1. **Performance**: Add caching for services/availability
2. **Analytics**: Track conversion funnel
3. **Notifications**: Email/SMS/push reminders
4. **Mobile**: PWA or native mobile app
5. **Advanced**: ML-powered recommendations

---

## Resources

- [Meta WhatsApp API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Supabase Docs](https://supabase.com/docs)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Intent Detection](./src/lib/intentDetector.ts)
- [Booking Engine](./src/lib/booking/engine.ts)

---

**Implementation Started**: January 12, 2026
**Status**: WhatsApp Bot + Public Storefront COMPLETE ✅
**Next**: UI Components + Final Routes
