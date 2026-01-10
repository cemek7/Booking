# 🔗 API Documentation Matrix
## Comprehensive Role-Based API Access Documentation

### 📋 **Overview**
This documentation provides a complete matrix of all API endpoints with their role requirements, inheritance patterns, and access controls. The system implements automatic role inheritance where higher-level roles inherit access from lower levels.

### 🏗️ **Role Hierarchy & Inheritance**
```
┌─────────────┐
│ SUPERADMIN  │ ← Level 0 (Platform Admin)
│   (Global)  │   Inherits: owner, manager, staff
└─────────────┘
       │
       ▼
┌─────────────┐
│   OWNER     │ ← Level 1 (Tenant Admin)
│ (Tenant)    │   Inherits: manager, staff
└─────────────┘
       │
       ▼
┌─────────────┐
│  MANAGER    │ ← Level 2 (Operations Lead)
│   (Team)    │   Inherits: staff
└─────────────┘
       │
       ▼
┌─────────────┐
│    STAFF    │ ← Level 3 (Base Role)
│  (Worker)   │   Base permissions only
└─────────────┘
```

### 🛡️ **Access Control Legend**
| Symbol | Meaning | Description |
|--------|---------|-------------|
| ✅ | Direct Access | Role has explicit access |
| 🔄 | Inherited Access | Role inherits access from hierarchy |
| ❌ | Denied | Role cannot access |
| 🔐 | Conditional | Access depends on context/ownership |
| 🌐 | Public | No authentication required |

---

## 📊 **Complete API Endpoint Matrix**

### 🔑 **Authentication & Security APIs**

| Endpoint | Method | SuperAdmin | Owner | Manager | Staff | Public | Auth Function |
|----------|--------|------------|--------|---------|--------|--------|--------------|
| `/api/auth/enhanced/login` | POST | ✅ | ✅ | ✅ | ✅ | 🌐 | None (Public) |
| `/api/auth/enhanced/logout` | POST | ✅ | ✅ | ✅ | ✅ | 🌐 | None (Public) |
| `/api/auth/enhanced/mfa` | GET/POST | ✅ | ✅ | ✅ | ✅ | ❌ | `requireStaffAccess()` |
| `/api/auth/enhanced/api-keys` | GET/POST/DELETE | ✅ | 🔄 | ❌ | ❌ | ❌ | `requireOwnerAccess()` |
| `/api/auth/enhanced/security` | GET/PUT | ✅ | 🔄 | 🔄 | ❌ | ❌ | `requireManagerAccess()` |
| `/api/auth/me` | GET | ✅ | ✅ | ✅ | ✅ | ❌ | `requireStaffAccess()` |
| `/api/auth/finish` | POST | ✅ | ✅ | ✅ | ✅ | ❌ | `requireStaffAccess()` |

### 🏢 **Superadmin APIs**

| Endpoint | Method | SuperAdmin | Owner | Manager | Staff | Public | Auth Function |
|----------|--------|------------|--------|---------|--------|--------|--------------|
| `/api/superadmin/dashboard` | GET | ✅ | ❌ | ❌ | ❌ | ❌ | `requireSuperAdminAccess()` |

### 👑 **Owner APIs**

| Endpoint | Method | SuperAdmin | Owner | Manager | Staff | Public | Auth Function |
|----------|--------|------------|--------|---------|--------|--------|--------------|
| `/api/owner/staff` | GET/POST/PUT/DELETE | ✅ | ✅ | ❌ | ❌ | ❌ | `requireAuth(['owner', 'superadmin'])` |
| `/api/owner/settings` | GET/PUT | ✅ | ✅ | ❌ | ❌ | ❌ | `requireOwnerAccess()` |
| `/api/owner/usage` | GET | ✅ | ✅ | ❌ | ❌ | ❌ | `requireOwnerAccess()` |

### 👨‍💼 **Manager APIs**

| Endpoint | Method | SuperAdmin | Owner | Manager | Staff | Public | Auth Function |
|----------|--------|------------|--------|---------|--------|--------|--------------|
| `/api/manager/team` | GET/POST/PUT/DELETE | ✅ | 🔄 | ✅ | ❌ | ❌ | `requireManagerAccess()` |
| `/api/manager/schedule` | GET/POST/PUT | ✅ | 🔄 | ✅ | ❌ | ❌ | `requireManagerAccess()` |
| `/api/manager/analytics` | GET/POST | ✅ | 🔄 | ✅ | ❌ | ❌ | `requireManagerAccess()` |

### 👥 **Staff APIs**

| Endpoint | Method | SuperAdmin | Owner | Manager | Staff | Public | Auth Function |
|----------|--------|------------|--------|---------|--------|--------|--------------|
| `/api/staff` | GET/PUT | ✅ | 🔄 | 🔄 | ✅ | ❌ | `requireStaffAccess()` |
| `/api/staff/metrics` | GET | ✅ | 🔄 | 🔄 | ✅ | ❌ | `requireStaffAccess()` |
| `/api/staff/[id]/status` | GET/PUT | ✅ | 🔄 | 🔄 | 🔐 | ❌ | `requireStaffAccess()` + ownership |
| `/api/staff/[id]/attributes` | GET/PUT | ✅ | 🔄 | 🔄 | 🔐 | ❌ | `requireStaffAccess()` + ownership |

### 📅 **Booking Management APIs**

| Endpoint | Method | SuperAdmin | Owner | Manager | Staff | Public | Auth Function |
|----------|--------|------------|--------|---------|--------|--------|--------------|
| `/api/bookings` | GET/POST | ✅ | 🔄 | 🔄 | ✅ | ❌ | `requireStaffAccess()` |
| `/api/bookings/[id]` | GET/PUT/DELETE | ✅ | 🔄 | 🔄 | 🔐 | ❌ | `requireStaffAccess()` + ownership |

### 💳 **Payment Management APIs**

| Endpoint | Method | SuperAdmin | Owner | Manager | Staff | Public | Auth Function |
|----------|--------|------------|--------|---------|--------|--------|--------------|
| `/api/payments/refund` | POST | ✅ | 🔄 | ✅ | ❌ | ❌ | `requireManagerAccess()` |
| `/api/payments/retry` | POST | ✅ | 🔄 | ✅ | ❌ | ❌ | `requireManagerAccess()` |
| `/api/payments/reconcile` | POST | ✅ | ✅ | ❌ | ❌ | ❌ | `requireOwnerAccess()` |
| `/api/payments/deposits` | GET/POST | ✅ | 🔄 | ✅ | ❌ | ❌ | `requireManagerAccess()` |
| `/api/payments/webhook` | POST | ✅ | ✅ | ✅ | ✅ | 🌐 | None (Webhook) |

### 🔧 **Enhanced Authentication Functions**

#### **Primary Functions** (Use these in new APIs)
```typescript
// Recommended for new implementations
await requireStaffAccess()      // All roles can access
await requireManagerAccess()    // Manager+ roles can access  
await requireOwnerAccess()      // Owner+ roles can access
await requireSuperAdminAccess() // Only superadmin can access
```

#### **Legacy Functions** (Being phased out)
```typescript
// Legacy - avoid in new code
await requireAuth(['staff'])                    // Use requireStaffAccess()
await requireAuth(['manager', 'owner'])         // Use requireManagerAccess()  
await requireAuth(['owner'])                    // Use requireOwnerAccess()
await requireAuth(['owner', 'superadmin'])      // Use requireOwnerAccess()
```

---

## 📊 **Access Summary by Role**

### **SuperAdmin** - Full Platform Access (100%)
- ✅ **System Administration**: Exclusive access to platform metrics
- ✅ **Cross-Tenant Operations**: No tenant restrictions
- ✅ **Emergency Override**: Can bypass all restrictions
- ✅ **Inherits All Access**: All lower-level permissions

### **Owner** - Tenant Management Access (79%)
- ✅ **Tenant Administration**: Full control over own tenant
- ✅ **User Management**: Manage all users in tenant
- ✅ **Billing Operations**: Access to payment reconciliation
- 🔄 **Inherits Manager Access**: All manager endpoints
- 🔄 **Inherits Staff Access**: All staff endpoints

### **Manager** - Operations Management Access (67%)
- ✅ **Team Operations**: Manage staff and schedules
- ✅ **Operational Analytics**: Team insights and reporting
- ✅ **Customer Management**: Handle bookings and customers
- 🔄 **Inherits Staff Access**: All staff endpoints
- ❌ **Denied**: Tenant settings, billing, platform admin

### **Staff** - Base Operations Access (44%)
- ✅ **Personal Operations**: Own profile and assignments
- ✅ **Customer Service**: Handle assigned bookings
- ✅ **Basic Analytics**: Personal performance metrics
- 🔐 **Ownership Required**: Can only modify own resources

---

## 🔒 **Security Implementation**

### **Tenant Isolation**
- All roles except superadmin are restricted to their tenant
- Cross-tenant access requires explicit superadmin privileges
- Tenant ID validation enforced at authentication layer

### **Resource Ownership**
- Staff can only access resources they own or are assigned to
- Managers can access team resources within scope
- Owners can access all tenant resources
- Superadmins can access any resource

### **Role Inheritance Security**
- Inheritance respects tenant boundaries
- Context rules prevent privilege escalation
- Exclusion rules block inappropriate access

---

## 📝 **Developer Quick Reference**

### **Common Patterns**
```typescript
// ✅ RECOMMENDED: Use inheritance functions
const user = await requireManagerAccess();

// ❌ AVOID: Manual role lists  
const user = await requireAuth(['manager', 'owner']);

// ✅ GOOD: Clear resource ownership check
if (resource.ownerId !== user.id && !canAccessResource(user, resource)) {
  throw new Error('Access denied');
}
```

### **Testing Access Patterns**
```typescript
// Test role inheritance
test('owner can access manager endpoints', async () => {
  const ownerUser = createMockUser({ role: 'owner' });
  const response = await callManagerEndpoint(ownerUser);
  expect(response.status).toBe(200);
});
```

---

**Last Updated**: November 30, 2025  
**Documentation Version**: 1.0  
**Role Inheritance**: Fully Implemented ✅
2. **Bearer Token Authentication** - JWT tokens for API access
3. **API Key Authentication** - For external integrations

#### Authentication Headers

```http
# Session-based
Cookie: session_token=your_session_token

# Bearer token
Authorization: Bearer your_jwt_token

# API key
X-API-Key: your_api_key
Authorization: Bearer your_api_key
```

### Login

#### POST `/api/auth/enhanced/login`

Authenticate a user with email and password, optionally with MFA.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure_password",
  "mfa_code": "123456",
  "remember_me": false,
  "device_fingerprint": "unique_device_id"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "tenant_id": "tenant_id"
  },
  "session": {
    "id": "session_id",
    "expires_at": "2024-01-01T00:00:00.000Z"
  },
  "mfa_required": false,
  "mfa_verified": true
}
```

### MFA (Multi-Factor Authentication)

#### Setup TOTP

**POST** `/api/auth/enhanced/mfa`

```json
{
  "method": "totp"
}
```

**Response:**
```json
{
  "success": true,
  "setup": {
    "secret": "SECRET_KEY",
    "qr_code_url": "data:image/png;base64,...",
    "backup_codes": ["code1", "code2", ...]
  }
}
```

#### Verify MFA

**PUT** `/api/auth/enhanced/mfa`

```json
{
  "code": "123456",
  "method": "totp"
}
```

### API Keys

#### Create API Key

**POST** `/api/auth/enhanced/api-keys`

```json
{
  "name": "Integration Key",
  "description": "For external system integration",
  "scopes": ["api:read", "api:write"],
  "rate_limit_per_hour": 1000,
  "expires_in_days": 365
}
```

**Response:**
```json
{
  "success": true,
  "api_key": {
    "key_id": "key_12345",
    "api_key": "key_12345.secret_token_here",
    "name": "Integration Key",
    "scopes": ["api:read", "api:write"]
  },
  "warning": "This is the only time you will see the full API key."
}
```

## Core API Endpoints

### Health Check

#### GET `/api/health`

Check application health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "worker": "healthy"
  }
}
```

### Bookings

#### GET `/api/v1/bookings`

List bookings with filtering and pagination.

**Query Parameters:**
- `page` (integer): Page number (default: 1)
- `limit` (integer): Items per page (default: 20, max: 100)
- `status` (string): Filter by status (`pending`, `confirmed`, `cancelled`)
- `date_from` (string): Filter from date (ISO format)
- `date_to` (string): Filter to date (ISO format)
- `customer_id` (string): Filter by customer
- `service_id` (string): Filter by service

**Response:**
```json
{
  "data": [
    {
      "id": "booking_id",
      "customer_id": "customer_id",
      "service_id": "service_id",
      "status": "confirmed",
      "start_time": "2024-01-01T10:00:00.000Z",
      "end_time": "2024-01-01T11:00:00.000Z",
      "price": 100.00,
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

#### POST `/api/v1/bookings`

Create a new booking.

**Request Body:**
```json
{
  "customer_id": "customer_id",
  "service_id": "service_id",
  "start_time": "2024-01-01T10:00:00.000Z",
  "end_time": "2024-01-01T11:00:00.000Z",
  "notes": "Special requirements"
}
```

#### GET `/api/v1/bookings/{booking_id}`

Get booking details.

#### PUT `/api/v1/bookings/{booking_id}`

Update booking.

#### DELETE `/api/v1/bookings/{booking_id}`

Cancel booking.

### Customers

#### GET `/api/v1/customers`

List customers.

#### POST `/api/v1/customers`

Create customer.

#### GET `/api/v1/customers/{customer_id}`

Get customer details.

#### PUT `/api/v1/customers/{customer_id}`

Update customer.

### Services

#### GET `/api/v1/services`

List services.

#### POST `/api/v1/services`

Create service.

#### GET `/api/v1/services/{service_id}`

Get service details.

#### PUT `/api/v1/services/{service_id}`

Update service.

### Payments

#### POST `/api/v1/payments/process`

Process payment for booking.

**Request Body:**
```json
{
  "booking_id": "booking_id",
  "amount": 100.00,
  "payment_method": "stripe",
  "payment_details": {
    "token": "payment_token"
  }
}
```

### Staff Management

#### GET `/api/v1/staff`

List staff members.

#### POST `/api/v1/staff`

Create staff member.

### Analytics

#### GET `/api/v1/analytics/bookings`

Get booking analytics.

**Query Parameters:**
- `period` (string): `day`, `week`, `month`, `year`
- `start_date` (string): Start date (ISO format)
- `end_date` (string): End date (ISO format)

### Webhooks

#### POST `/api/webhooks/stripe`

Stripe webhook endpoint for payment events.

#### POST `/api/webhooks/calendar`

Calendar integration webhook.

## Error Handling

### Error Response Format

All API errors follow a consistent format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "validation error details"
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "request_id": "req_12345"
}
```

### HTTP Status Codes

- `200` - OK
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `422` - Validation Error
- `429` - Rate Limited
- `500` - Internal Server Error

### Common Error Codes

- `VALIDATION_ERROR` - Request validation failed
- `AUTHENTICATION_REQUIRED` - Authentication required
- `AUTHORIZATION_FAILED` - Insufficient permissions
- `RESOURCE_NOT_FOUND` - Requested resource not found
- `RATE_LIMIT_EXCEEDED` - API rate limit exceeded
- `MFA_REQUIRED` - Multi-factor authentication required
- `SESSION_EXPIRED` - User session expired
- `ACCOUNT_LOCKED` - User account locked

## Rate Limiting

### Rate Limit Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
X-RateLimit-Window: 3600
```

### Rate Limits by Endpoint Type

- **Authentication**: 5 requests per minute per IP
- **General API**: 1000 requests per hour per API key
- **Admin APIs**: 100 requests per hour
- **Webhooks**: No rate limiting

## SDK Examples

### JavaScript/Node.js

```javascript
const BokaAPI = require('@boka/api-client');

const client = new BokaAPI({
  baseURL: 'https://api.your-domain.com',
  apiKey: 'your_api_key'
});

// Create booking
const booking = await client.bookings.create({
  customer_id: 'customer_123',
  service_id: 'service_456',
  start_time: '2024-01-01T10:00:00.000Z',
  end_time: '2024-01-01T11:00:00.000Z'
});

// List bookings
const bookings = await client.bookings.list({
  page: 1,
  limit: 20,
  status: 'confirmed'
});
```

### Python

```python
from boka_api import BokaClient

client = BokaClient(
    base_url='https://api.your-domain.com',
    api_key='your_api_key'
)

# Create booking
booking = client.bookings.create({
    'customer_id': 'customer_123',
    'service_id': 'service_456',
    'start_time': '2024-01-01T10:00:00.000Z',
    'end_time': '2024-01-01T11:00:00.000Z'
})

# List bookings
bookings = client.bookings.list(
    page=1,
    limit=20,
    status='confirmed'
)
```

### cURL

```bash
# Authenticate
curl -X POST https://api.your-domain.com/api/auth/enhanced/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password"
  }'

# Create booking
curl -X POST https://api.your-domain.com/api/v1/bookings \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "customer_123",
    "service_id": "service_456",
    "start_time": "2024-01-01T10:00:00.000Z",
    "end_time": "2024-01-01T11:00:00.000Z"
  }'
```

## Webhook Integration

### Setting Up Webhooks

1. Configure webhook endpoints in your application settings
2. Verify webhook signatures for security
3. Handle webhook events asynchronously
4. Implement idempotency for webhook processing

### Webhook Event Types

- `booking.created`
- `booking.updated`
- `booking.cancelled`
- `payment.succeeded`
- `payment.failed`
- `customer.created`
- `customer.updated`

### Webhook Payload Example

```json
{
  "id": "evt_12345",
  "type": "booking.created",
  "data": {
    "object": {
      "id": "booking_123",
      "customer_id": "customer_456",
      "status": "confirmed",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  },
  "created": 1609459200,
  "livemode": true
}
```

## Testing

### Test Environment

```
Base URL: https://api-test.your-domain.com
```

### Test API Keys

Test API keys are prefixed with `test_` and only work in the test environment.

### Sample Test Data

Test bookings, customers, and services are available in the test environment for integration testing.

## Support

For API support, please contact:

- **Email**: api-support@your-domain.com
- **Documentation**: https://docs.your-domain.com
- **Status Page**: https://status.your-domain.com

## Changelog

### v1.0.0 (2024-01-01)
- Initial API release
- Enhanced authentication system
- Comprehensive booking management
- Payment processing integration
- Real-time webhooks