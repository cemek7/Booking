# 🔧 TECHNICAL DEBT REMEDIATION - DETAILED FIX GUIDE

**Date**: January 12, 2026  
**Based On**: Comprehensive Technical Debt Audit  
**Scope**: 200+ issues identified  
**Approach**: Step-by-step fix guide with code examples  

---

## 📋 QUICK FIX CHECKLISTS

### Phase 1: Critical Fixes (2-3 days)

#### Priority 1: TypeScript Type Safety ⏱️ 3-4 hours
- [ ] Enable strict TypeScript mode in tsconfig.json
- [ ] Fix all `any` type assignments (324 errors)
- [ ] Add proper type definitions for all function parameters
- [ ] Fix catch block error types
- [ ] Add return types to all functions
- [ ] Run: `npm run lint -- --fix`

#### Priority 2: Error Handling ⏱️ 2-3 hours
- [ ] Create AppError class
- [ ] Replace all try-catch blocks with proper error handling
- [ ] Create error boundary components
- [ ] Add error logging service
- [ ] Test error scenarios

#### Priority 3: Console Logging ⏱️ 1 hour
- [ ] Remove all console.log statements from production code
- [ ] Add structured logging service
- [ ] Replace with logger.info/warn/error
- [ ] Test logging output

#### Priority 4: TODOs ⏱️ 3-4 hours
- [ ] Implement booking creation from WhatsApp context
- [ ] Implement confirmation email/WhatsApp notifications
- [ ] Implement tenant owner notifications
- [ ] Write tests for each feature
- [ ] Deploy and verify

#### Priority 5: Security Hardening ⏱️ 2-3 hours
- [ ] Add rate limiting to public endpoints
- [ ] Add CAPTCHA to public booking form
- [ ] Sanitize all user input
- [ ] Add signature verification caching
- [ ] Test security measures

---

## 🔧 SPECIFIC CODE FIXES

### FIX 1: TypeScript Configuration

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    },
    
    // ✅ CRITICAL: Enable strict mode
    "strict": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    
    // ✅ Additional safety
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    
    // Performance & Output
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "incremental": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "build"]
}
```

**Commands**:
```bash
# Check for all type errors
npx tsc --noEmit

# Generate type declarations
npx tsc
```

---

### FIX 2: ESLint Configuration

**File**: `eslint.config.mjs`

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintPluginUnicorn from "eslint-plugin-unicorn";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  
  // ✅ ADD: Custom rules for code quality
  {
    rules: {
      // Type safety
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { 
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/explicit-function-return-types": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "warn",
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-expect-error": "allow-with-description",
        "ts-ignore": "allow-with-description"
      }],
      
      // React best practices
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
      "@next/next/no-html-link-for-pages": "off",
      
      // Code quality
      "no-console": ["warn", { 
        allow: ["warn", "error"],
        // Block in production builds
        ...(process.env.NODE_ENV === 'production' && { allow: [] })
      }],
      "no-debugger": "error",
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"],
      "no-implicit-coercion": "error",
      
      // Import organization
      "sort-imports": "off",
      "import/order": ["warn", {
        groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        alphabeticalOrder: true
      }],
      "import/no-anonymous-default-export": "warn",
      
      // Unicorn best practices
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/prevent-abbreviations": "off",
    }
  },
  
  // Global ignores
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "node_modules/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
]);

export default eslintConfig;
```

**Commands**:
```bash
# Check all files
npm run lint

# Auto-fix fixable issues
npm run lint -- --fix

# With detailed report
npm run lint -- --format=detailed
```

---

### FIX 3: Error Handling Service

**File**: `src/lib/errorHandler.ts`

```typescript
export enum ErrorCode {
  // Validation errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_FIELD = 'MISSING_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  
  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // Resource errors
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  
  // Server errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  
  // Business logic errors
  BOOKING_FAILED = 'BOOKING_FAILED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  NOTIFICATION_FAILED = 'NOTIFICATION_FAILED',
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public statusCode: number,
    message: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(process.env.NODE_ENV === 'development' && {
          context: this.context,
          stack: this.stack,
        }),
      },
    };
  }
}

// Predefined errors
export const errors = {
  validation: (field: string, reason: string) =>
    new AppError(
      ErrorCode.INVALID_INPUT,
      400,
      `Invalid ${field}: ${reason}`,
      { field, reason }
    ),

  notFound: (resource: string) =>
    new AppError(
      ErrorCode.NOT_FOUND,
      404,
      `${resource} not found`
    ),

  unauthorized: () =>
    new AppError(
      ErrorCode.UNAUTHORIZED,
      401,
      'Authentication required'
    ),

  forbidden: () =>
    new AppError(
      ErrorCode.FORBIDDEN,
      403,
      'Access denied'
    ),

  rateLimited: () =>
    new AppError(
      ErrorCode.RATE_LIMITED,
      429,
      'Too many requests. Please try again later.'
    ),

  internal: (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      500,
      'An unexpected error occurred',
      { originalError: message }
    );
  },
};
```

---

### FIX 4: Structured Logging

**File**: `src/lib/logger.ts`

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

class Logger {
  private isDev = process.env.NODE_ENV === 'development';

  private format(entry: LogEntry): string {
    const { level, timestamp, message, context, error } = entry;
    const parts = [
      `[${timestamp}]`,
      `[${level.toUpperCase()}]`,
      message,
    ];

    if (context && Object.keys(context).length > 0) {
      parts.push(JSON.stringify(context));
    }

    if (error) {
      parts.push(`Error: ${error.message}`);
      if (this.isDev && error.stack) {
        parts.push(error.stack);
      }
    }

    return parts.join(' ');
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (!this.isDev && level === 'debug') return; // Skip debug in production

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      context,
    };

    const formatted = this.format(entry);

    // Send to console in development
    if (this.isDev) {
      const colors: Record<LogLevel, string> = {
        debug: '\x1b[36m', // cyan
        info: '\x1b[32m',   // green
        warn: '\x1b[33m',   // yellow
        error: '\x1b[31m',  // red
        fatal: '\x1b[41m',  // red background
      };
      console.log(`${colors[level]}${formatted}\x1b[0m`);
    }

    // Send to external service in production
    if (!this.isDev && level !== 'debug') {
      this.sendToExternalService(entry);
    }
  }

  private sendToExternalService(entry: LogEntry) {
    // TODO: Send to Datadog, Sentry, etc.
    // Example with fetch:
    // fetch(process.env.LOG_ENDPOINT, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(entry),
    // }).catch(err => console.error('Failed to send log', err));
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>) {
    const errorData = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
    } : typeof error === 'string' ? { message: error } : {};

    const entry: LogEntry = {
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      context,
      error: errorData,
    };

    const formatted = this.format(entry);
    if (this.isDev) {
      console.error(`\x1b[31m${formatted}\x1b[0m`);
    }
  }

  fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>) {
    this.error(message, error, context);
    // In production, might want to trigger alerting
    process.exit(1);
  }
}

export const logger = new Logger();
```

---

### FIX 5: Remove Console Logging

**Before**:
```typescript
// src/lib/whatsapp/messageHandler.ts (12+ console.log calls)
console.log('\n🤖 Handling WhatsApp message for tenant');
console.log('📋 Processing booking intent');
console.log('🔄 Processing reschedule intent');
```

**After**:
```typescript
import { logger } from '@/lib/logger';

// In development only:
if (process.env.NODE_ENV === 'development') {
  logger.debug('Handling WhatsApp message for tenant', { tenantId });
  logger.debug('Processing booking intent', { intent });
  logger.debug('Processing reschedule intent', { bookingId });
}

// Production logging (important events):
logger.info('Booking created successfully', { bookingId, customerId });
logger.warn('Booking failed to create', { reason: 'No availability' });
logger.error('WhatsApp message processing failed', error, { messageId });
```

**Files to fix** (80+ console calls):
- `src/app/api/whatsapp/webhook/route-booking.ts` (20+ calls)
- `src/lib/whatsapp/*.ts` (30+ calls)
- `src/app/api/public/route.ts` (10+ calls)
- Others (20+ calls)

**Quick fix command**:
```bash
# Remove all console.log calls and replace with logger.debug
# (This requires careful refactoring - can't be fully automated)
grep -r "console\." src/ --include="*.ts" --include="*.tsx" | head -20
```

---

### FIX 6: Add Input Validation

**File**: `src/lib/validation/booking.ts`

```typescript
import { z } from 'zod';

// ✅ Define all validation schemas
export const PhoneSchema = z
  .string()
  .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone format')
  .min(10, 'Phone too short')
  .max(20, 'Phone too long');

export const EmailSchema = z.string().email('Invalid email');

export const CreatePublicBookingSchema = z.object({
  service_id: z.string().uuid('Invalid service ID'),
  date: z.string().refine(
    (date) => /^\d{4}-\d{2}-\d{2}$/.test(date),
    'Invalid date format (use YYYY-MM-DD)'
  ),
  time: z.string().refine(
    (time) => /^\d{2}:\d{2}$/.test(time),
    'Invalid time format (use HH:MM)'
  ),
  customer_name: z.string().min(2).max(100),
  customer_email: EmailSchema,
  customer_phone: PhoneSchema,
  notes: z.string().optional(),
});

export type CreatePublicBookingInput = z.infer<typeof CreatePublicBookingSchema>;
```

**Usage**:
```typescript
// ✅ AFTER: src/app/api/public/[slug]/route.ts
export async function POST(req: NextRequest, { params }: any) {
  try {
    const body = await req.json();
    
    // Validate input
    const booking = CreatePublicBookingSchema.parse(body);
    
    // Use validated data
    const result = await createPublicBooking(booking);
    
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    // ... handle other errors
  }
}
```

---

### FIX 7: Fix React Hook Dependencies

**Before**:
```typescript
// ❌ Missing dependency
useEffect(() => {
  loadDashboardData(); // Function not in deps array!
}, []);

// ❌ Using index in dependency
useEffect(() => {
  setSelectedDate(dates[0]); // 'dates' not in deps!
}, []);
```

**After**:
```typescript
// ✅ OPTION 1: Use useCallback
const loadDashboardData = useCallback(() => {
  // Load logic
}, [dependencies]);

useEffect(() => {
  loadDashboardData();
}, [loadDashboardData]);

// ✅ OPTION 2: Include dependency
useEffect(() => {
  loadDashboardData();
}, [loadDashboardData]);

// ✅ OPTION 3: Move outside component if static
const loadDashboardData = async () => {
  // ...
};

export function Dashboard() {
  useEffect(() => {
    loadDashboardData();
  }, []); // OK - function is defined outside
}
```

---

### FIX 8: Add Rate Limiting

**File**: `src/lib/rateLimit.ts`

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Different rate limiters for different use cases
export const rateLimiters = {
  // Public booking: 10 per hour per IP
  publicBooking: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 h'),
  }),
  
  // Public API: 100 per hour per IP
  publicApi: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 h'),
  }),
  
  // WhatsApp webhook: 1000 per hour
  webhook: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(1000, '1 h'),
  }),

  // Login attempts: 5 per 15 minutes per email
  login: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),
  }),
};

export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const { success, remaining, reset } = await limiter.limit(identifier);
  return {
    allowed: success,
    remaining: Math.max(0, remaining),
    resetTime: reset,
  };
}

export async function withRateLimit(
  limiter: Ratelimit,
  identifier: string,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const { allowed, remaining, resetTime } = await checkRateLimit(limiter, identifier);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((resetTime - Date.now()) / 1000)),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  const response = await handler();
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  return response;
}
```

**Usage**:
```typescript
// In API route
export async function POST(req: NextRequest) {
  return await withRateLimit(
    rateLimiters.publicBooking,
    req.ip || 'anonymous',
    async () => {
      // Your handler logic
      return NextResponse.json({ success: true });
    }
  );
}
```

---

## 🎯 EXECUTION CHECKLIST

### Day 1: TypeScript & ESLint (4-5 hours)
- [ ] Update tsconfig.json with strict mode
- [ ] Update eslint.config.mjs with new rules
- [ ] Run `npm run lint` - note errors
- [ ] Fix top 50 errors manually
- [ ] Run `npm run build` - verify no build errors

### Day 2: Error Handling & Logging (3-4 hours)
- [ ] Create errorHandler.ts
- [ ] Create logger.ts
- [ ] Replace 20 most critical error handlers
- [ ] Test error scenarios
- [ ] Verify logging output

### Day 3: Remove Console & Add Validation (3-4 hours)
- [ ] Remove all console.log calls
- [ ] Add Zod validation schemas
- [ ] Update 5 most critical endpoints
- [ ] Test validation with invalid input
- [ ] Verify error messages

### Day 4: Complete Remaining Fixes (2-3 hours)
- [ ] Fix React hook dependencies
- [ ] Complete all unfinished TODOs
- [ ] Add rate limiting to public endpoints
- [ ] Test all changes
- [ ] Deploy to staging

---

## ✅ VERIFICATION TESTS

```bash
# Type checking
npx tsc --noEmit

# ESLint
npm run lint

# Tests
npm test

# Build
npm run build

# Start dev server
npm run dev
```

---

**Estimated Total Time**: 15-18 hours  
**Recommended Timeline**: 3-4 days of focused work  
**Next Review**: After Phase 1 completion

