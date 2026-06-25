# API Route Migration Guide: Unified Error & Auth System

## Overview

All API routes must be migrated from inline error/auth handling to the unified system using `createApiHandler()` or `createHttpHandler()`.

## Benefits

- ✅ Automatic error transformation with consistent status codes
- ✅ Centralized Bearer token extraction and validation
- ✅ Automatic user context extraction (user ID, email, role, tenant)
- ✅ Role-based access control built-in
- ✅ Unified error responses across all endpoints
- ✅ Consistent logging and monitoring

## Migration Pattern

### Before (Current Pattern)

```typescript
// src/app/api/services/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    // Manual auth extraction
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'missing_authorization' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = getSupabaseRouteHandlerClient();

    // Manual user validation
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    // Manual role checking
    const { data: userData, error: userError } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!userData) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Business logic
    const { data, error } = await supabase
      .from('services')
      .select('*');

    if (error) {
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[api/services] Error:', error);
    return NextResponse.json({ error: 'internal_server_error' }, { status: 500 });
  }
}
```

### After (Unified Pattern)

```typescript
// src/app/api/services/route.ts
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    // ctx.user.id, ctx.user.role, ctx.user.tenantId available
    // ctx.supabase already initialized
    // Errors automatically transformed

    const { data, error } = await ctx.supabase
      .from('services')
      .select('*')
      .eq('tenant_id', ctx.user?.tenantId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return data;
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();

    if (!body.name) {
      throw ApiErrorFactory.validationError({ message: 'name is required' });
    }

    const { data, error } = await ctx.supabase
      .from('services')
      .insert({ tenant_id: ctx.user?.tenantId, ...body })
      .select('*')
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
```

## Quick Conversion Steps

1. **Remove try/catch blocks** - Error handling is automatic
2. **Remove auth extraction** - Use `ctx.user` instead
3. **Remove role checking** - Use `roles` option parameter
4. **Remove duplicate error handling** - Use `ApiErrorFactory` methods
5. **Remove Supabase client creation** - Use `ctx.supabase`
6. **Change handlers to `createHttpHandler()`** - Or use `createApiHandler()` for custom methods

## API Reference

### createHttpHandler(handler, method, options)

Create a handler for a single HTTP method.

```typescript
export const GET = createHttpHandler(
  async (ctx) => { /* business logic */ },
  'GET',
  { 
    auth: true,           // Require authentication
    roles: ['owner'],     // Required roles
    permissions: ['read:services'] // Required permissions
  }
);
```

### createApiHandler(handler, options)

Create a handler that checks method in options.

```typescript
export default createApiHandler(
  async (ctx) => { /* business logic */ },
  { 
    methods: ['GET', 'POST'],
    auth: true,
    roles: ['owner', 'manager']
  }
);
```

### RouteContext

Available in all handlers:

```typescript
interface RouteContext {
  request: NextRequest;        // Original request
  user?: {                      // Authenticated user
    id: string;
    email: string;
    role: string;
    tenantId?: string;
    permissions?: string[];
  };
  supabase: any;               // Initialized Supabase client
  params?: Record<string, string>; // Route parameters
}
```

### Error Factory

Use these methods to throw errors (automatically transformed):

```typescript
// Authentication errors
ApiErrorFactory.missingAuthorization()
ApiErrorFactory.invalidToken()
ApiErrorFactory.tokenExpired()

// Permission errors
ApiErrorFactory.forbidden('reason')
ApiErrorFactory.insufficientPermissions(['role1', 'role2'])

// Validation errors
ApiErrorFactory.validationError({ field: 'error message' })

// Resource errors
ApiErrorFactory.notFound('Service')
ApiErrorFactory.conflict('Service already exists')

// Server errors
ApiErrorFactory.databaseError(error)
ApiErrorFactory.internalServerError(error)
```

## Error Response Format

All errors automatically transform to this format:

```json
{
  "error": "error_code",
  "code": "error_code",
  "message": "Human readable message",
  "details": { "optional": "error details" },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

Status codes are automatically set based on error code:
- 400: validation_error, invalid_request
- 401: missing_authorization, invalid_token, token_expired
- 403: forbidden, insufficient_permissions, tenant_mismatch
- 404: not_found, resource_not_found
- 409: conflict, duplicate_resource
- 422: invalid_state, operation_not_allowed
- 429: quota_exceeded
- 500: internal_server_error, database_error
- 502: external_service_error
- 504: timeout

## Migration Checklist

For each API route:

- [ ] Replace try/catch with automatic error handling
- [ ] Remove Bearer token extraction (use `ctx.user`)
- [ ] Remove role checking (use `roles` option)
- [ ] Remove manual error responses (use `ApiErrorFactory`)
- [ ] Replace `getSupabaseRouteHandlerClient()` with `ctx.supabase`
- [ ] Use `createHttpHandler()` or `createApiHandler()`
- [ ] Test with valid and invalid tokens
- [ ] Test with insufficient permissions
- [ ] Verify error responses match new format
- [ ] Update API documentation

## Common Patterns

### GET with filtering

```typescript
export const GET = createHttpHandler(
  async (ctx) => {
    const { page = 1, limit = 20 } = Object.fromEntries(new URL(ctx.request.url).searchParams);
    
    const from = (page - 1) * limit;
    const { data, error } = await ctx.supabase
      .from('services')
      .select('*')
      .eq('tenant_id', ctx.user?.tenantId)
      .range(from, from + limit - 1);

    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'GET',
  { auth: true }
);
```

### POST with validation

```typescript
export const POST = createHttpHandler(
  async (ctx) => {
    const body = await parseJsonBody(ctx.request);
    
    if (!body.name?.trim()) {
      throw ApiErrorFactory.validationError({ name: 'Name is required' });
    }

    const { data, error } = await ctx.supabase
      .from('services')
      .insert({
        tenant_id: ctx.user?.tenantId,
        name: body.name.trim(),
        price: body.price || 0,
      })
      .select()
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
```

### PATCH with ownership check

```typescript
export const PATCH = createHttpHandler(
  async (ctx) => {
    const { id } = ctx.params || {};
    if (!id) throw ApiErrorFactory.validationError({ id: 'ID is required' });

    const body = await parseJsonBody(ctx.request);

    // Verify ownership
    const { data: service, error: fetchError } = await ctx.supabase
      .from('services')
      .select('tenant_id')
      .eq('id', id)
      .single();

    if (!service) throw ApiErrorFactory.notFound('Service');
    if (service.tenant_id !== ctx.user?.tenantId) {
      throw ApiErrorFactory.tenantMismatch();
    }

    const { data, error } = await ctx.supabase
      .from('services')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);
```

### DELETE with role check

```typescript
export const DELETE = createHttpHandler(
  async (ctx) => {
    const { id } = ctx.params || {};
    if (!id) throw ApiErrorFactory.validationError({ id: 'ID is required' });

    // Only owners can delete
    if (ctx.user?.role !== 'owner') {
      throw ApiErrorFactory.insufficientPermissions(['owner']);
    }

    const { error } = await ctx.supabase
      .from('services')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.user?.tenantId);

    if (error) throw ApiErrorFactory.databaseError(error);
    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
```

## Testing

Test each route with:

```bash
# Valid request
curl -X GET http://localhost:3000/api/services \
  -H "Authorization: Bearer valid_token"

# Missing auth
curl -X GET http://localhost:3000/api/services

# Invalid token
curl -X GET http://localhost:3000/api/services \
  -H "Authorization: Bearer invalid_token"

# Insufficient role
curl -X POST http://localhost:3000/api/services \
  -H "Authorization: Bearer staff_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}'
```

All errors should return the unified format with correct status codes.
