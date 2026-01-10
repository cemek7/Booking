C:\Users\DELL\Documents\Techclave\projects\booking\boka>npm run lint 2>&1

> boka@0.1.0 lint
> eslint


C:\Users\DELL\Documents\Techclave\projects\booking\boka\dist\reservation_helper.mjs
  1:1  warning  Unused eslint-disable directive (no problems were reported)

C:\Users\DELL\Documents\Techclave\projects\booking\boka\dist\worker.js
  6:1  warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\dist\worker.mjs
   42:129  warning  'e' is defined but never used                                   @typescript-eslint/no-unused-vars
  137:1    warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\dist\worker_helper.mjs
   10:12   warning  'e' is defined but never used    @typescript-eslint/no-unused-vars
   21:12   warning  'err' is defined but never used  @typescript-eslint/no-unused-vars
   91:47   warning  'e' is defined but never used    @typescript-eslint/no-unused-vars
  123:146  warning  'e' is defined but never used    @typescript-eslint/no-unused-vars
  132:14   warning  'e' is defined but never used    @typescript-eslint/no-unused-vars
  197:20   warning  'e' is defined but never used    @typescript-eslint/no-unused-vars
  310:165  warning  'uer' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\chaos-testing.mjs
    7:10  warning  'spawn' is defined but never used                     @typescript-eslint/no-unused-vars
   23:7   warning  'ChaosTest' is assigned a value but never used        @typescript-eslint/no-unused-vars
   33:7   warning  'ChaosTestResult' is assigned a value but never used  @typescript-eslint/no-unused-vars
   50:21  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
   52:32  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  149:18  warning  'error' is defined but never used                     @typescript-eslint/no-unused-vars
  197:14  warning  'error' is defined but never used                     @typescript-eslint/no-unused-vars
  211:22  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  227:20  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  268:43  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  295:18  warning  'error' is defined but never used                     @typescript-eslint/no-unused-vars
  330:18  warning  'error' is defined but never used                     @typescript-eslint/no-unused-vars
  368:27  warning  'endpoints' is defined but never used                 @typescript-eslint/no-unused-vars
  542:47  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\enhanced-job-worker.mjs
  175:63  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  190:73  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  205:72  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  220:71  warning  'context' is defined but never used   @typescript-eslint/no-unused-vars
  235:62  warning  'context' is defined but never used   @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\load-testing.mjs
   38:10  error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any
   74:21  error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any
  154:7   warning  Expected an assignment or function call and instead saw an expression  @typescript-eslint/no-unused-expressions

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\production-validation.mjs
  20:2  error  Parsing error: 'async' modifier cannot appear on a type member

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\retry-transactions.mjs
  137:5  warning  'isShuttingDown' is assigned a value but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\test-scheduler-performance.mjs
   22:7   warning  'meter' is assigned a value but never used  @typescript-eslint/no-unused-vars
  193:60  warning  'serviceIds' is defined but never used      @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\verify-rls.mjs
  2:10  warning  'fileURLToPath' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\scripts\week7-validation.mjs
   8:10  warning  'performance' is defined but never used           @typescript-eslint/no-unused-vars
  75:17  warning  'categoryKey' is assigned a value but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\(auth)\onboarding\page.tsx
   40:22  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  102:81  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\auth\me\route.ts
  13:9   warning  'bearer' is assigned a value but never used  @typescript-eslint/no-unused-vars
  50:52  error    Unexpected any. Specify a different type     @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\bookings\[id]\route.ts
   8:12  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   8:26  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  22:12  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
  24:15  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  30:13  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\bookings\route.ts
   18:12  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
   39:45  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   48:32  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   70:12  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
   72:15  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   89:13  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  146:12  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\chats\[id]\messages\route.ts
  14:13  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\chats\[id]\read\route.ts
  18:12  warning  'e' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\customers\[id]\history\route.ts
  12:28  error    Unexpected any. Specify a different type                @typescript-eslint/no-explicit-any
  13:31  error    Unexpected any. Specify a different type                @typescript-eslint/no-explicit-any
  22:43  error    Unexpected any. Specify a different type                @typescript-eslint/no-explicit-any
  31:37  error    Unexpected any. Specify a different type                @typescript-eslint/no-explicit-any
  46:49  error    Unexpected any. Specify a different type                @typescript-eslint/no-explicit-any
  47:9   error    'totalsByRes' is never reassigned. Use 'const' instead  prefer-const
  54:37  error    Unexpected any. Specify a different type                @typescript-eslint/no-explicit-any
  61:46  error    Unexpected any. Specify a different type                @typescript-eslint/no-explicit-any
  64:12  warning  '_e' is defined but never used                          @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\customers\[id]\stats\route.ts
  19:31  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  20:34  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  35:20  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  44:40  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  44:77  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  47:12  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\onboarding\tenant\route.ts
  16:13  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  68:36  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  83:31  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\security\evaluate\route.ts
  2:10  warning  'getServerSupabase' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\skills\[id]\route.ts
   9:13  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  20:12  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  33:12  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\skills\route.ts
  16:12  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  22:13  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  33:12  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\staff-skills\[user_id]\[skill_id]\route.ts
  13:12  warning  'e' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\staff-skills\route.ts
  20:12  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  26:13  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  42:12  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\staff\[id]\attributes\route.ts
   9:13  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  21:31  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\staff\[id]\status\route.ts
  27:15  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\staff\metrics\route.ts
  27:15  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\staff\route.ts
  23:42  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\tenant-users\[userId]\role\route.ts
  23:15  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\tenants\[tenantId]\apikey\route.ts
  28:15  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\tenants\[tenantId]\invites\route.ts
  17:13  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  74:38  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\api\usage\route.ts
  11:9  warning  'today' is assigned a value but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\auth\callback\page.tsx
  35:18  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  53:33  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  84:22  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\clients\page.tsx
  11:11  warning  'tenant' is assigned a value but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\dashboard\staff\[id]\page.tsx
  22:47  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  32:27  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  32:52  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\page.tsx
  25:34  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\reservations\page.tsx
  8:9  warning  'params' is assigned a value but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\app\schedule\page.tsx
    2:10  warning  'useMemo' is defined but never used            @typescript-eslint/no-unused-vars
   25:54  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
   27:11  warning  'location' is assigned a value but never used  @typescript-eslint/no-unused-vars
   34:46  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
   43:30  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
   48:43  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
   54:28  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
   78:30  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
   79:30  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
   81:17  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
  142:36  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
  157:41  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
  200:28  warning  'bk' is defined but never used                 @typescript-eslint/no-unused-vars
  217:38  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any
  218:38  error    Unexpected any. Specify a different type       @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\ActivityFeed.tsx
  9:13  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\AnalyticsDashboard.tsx
  53:76  warning  'userRole' is assigned a value but never used                                                                         @typescript-eslint/no-unused-vars
  64:6   warning  React Hook useEffect has a missing dependency: 'loadAnalyticsData'. Either include it or remove the dependency array  react-hooks/exhaustive-deps

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\Calendar.tsx
   13:29  error    Unexpected any. Specify a different type                                                                        @typescript-eslint/no-explicit-any
   35:10  warning  'startOfTodayISO' is defined but never used                                                                     @typescript-eslint/no-unused-vars
  100:6   warning  React Hook React.useEffect has a missing dependency: 'range'. Either include it or remove the dependency array  react-hooks/exhaustive-deps
  103:48  error    Unexpected any. Specify a different type                                                                        @typescript-eslint/no-explicit-any
  145:5   warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')
  444:32  error    Unexpected any. Specify a different type                                                                        @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\OwnerLLMMetrics.client.tsx
   5:91  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  18:27  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  28:17  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  41:27  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  49:17  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\Phase5Dashboard.tsx
   16:3   warning  'Bot' is defined but never used                                                                                       @typescript-eslint/no-unused-vars
   17:3   warning  'Target' is defined but never used                                                                                    @typescript-eslint/no-unused-vars
   23:3   warning  'XCircle' is defined but never used                                                                                   @typescript-eslint/no-unused-vars
   24:3   warning  'Download' is defined but never used                                                                                  @typescript-eslint/no-unused-vars
   25:3   warning  'Upload' is defined but never used                                                                                    @typescript-eslint/no-unused-vars
   39:9   error    Unexpected any. Specify a different type                                                                              @typescript-eslint/no-explicit-any
   67:6   warning  React Hook useEffect has a missing dependency: 'loadDashboardData'. Either include it or remove the dependency array  react-hooks/exhaustive-deps
  379:91  error    Unexpected any. Specify a different type                                                                              @typescript-eslint/no-explicit-any
  412:90  error    Unexpected any. Specify a different type                                                                              @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\RealtimeSubscriptions.tsx
  13:32  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  17:49  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  20:32  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  21:32  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  32:29  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
  32:33  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\RoleBasedAnalytics.tsx
   4:39  warning  'AnalyticsPermissions' is defined but never used                 @typescript-eslint/no-unused-vars
  25:3   warning  'userId' is defined but never used                               @typescript-eslint/no-unused-vars
  26:3   warning  'analyticsData' is defined but never used                        @typescript-eslint/no-unused-vars
  51:22  error    `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`  react/no-unescaped-entities

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\SkillManager.client.tsx
   39:17  error    Unexpected any. Specify a different type                                                                    @typescript-eslint/no-explicit-any
   44:35  warning  React Hook useEffect has a missing dependency: 'loadAll'. Either include it or remove the dependency array  react-hooks/exhaustive-deps
   59:17  error    Unexpected any. Specify a different type                                                                    @typescript-eslint/no-explicit-any
   75:17  error    Unexpected any. Specify a different type                                                                    @typescript-eslint/no-explicit-any
   88:17  error    Unexpected any. Specify a different type                                                                    @typescript-eslint/no-explicit-any
  104:17  error    Unexpected any. Specify a different type                                                                    @typescript-eslint/no-explicit-any
  118:17  error    Unexpected any. Specify a different type                                                                    @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\StaffAnalytics.tsx
  15:52  warning  'staffId' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\TenantSettingsClient.tsx
  21:14  warning  'e' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\UnifiedDashboardNav.tsx
  94:57  warning  'tenantId' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\UsagePanel.client.tsx
  30:16  warning  'e' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\__tests__\ReservationsList.test.tsx
  7:35  warning  'MockSupabase' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\analytics\LineChart.tsx
  5:9   error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  8:48  warning  'data' is defined but never used          @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\analytics\PieChart.tsx
  5:9   error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  8:21  warning  'data' is defined but never used          @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\auth\TenantSelector.tsx
   6:72  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  24:16  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\booking\BookingComposer.tsx
  27:6   warning  'Step' is defined but never used          @typescript-eslint/no-unused-vars
  88:17  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\booking\BookingSidePanel.tsx
  14:78  error    Unexpected any. Specify a different type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      @typescript-eslint/no-explicit-any
  18:87  warning  'onUpdate' is defined but never used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          @typescript-eslint/no-unused-vars
  22:58  error    Unexpected any. Specify a different type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      @typescript-eslint/no-explicit-any
  27:5   error    Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\booking\BookingSidePanel.tsx:27:5
  25 |   useEffect(() => {
  26 |     if (!messages || messages.length === 0 || pendingMessages.length === 0) return;
> 27 |     setPendingMessages(pm => pm.filter(p => !messages.some(m => m.text === p.text && m.createdAt !== p.createdAt)));
     |     ^^^^^^^^^^^^^^^^^^ Avoid calling setState() directly within an effect
  28 |   }, [messages, pendingMessages]);
  29 |   const runAction = async (a: 'confirm'|'cancel'|'reschedule'|'mark_paid') => {
  30 |     if (onAction) return onAction(a);  react-hooks/set-state-in-effect
  72:24  warning  'err' is defined but never used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\bookings\BookingForm.tsx
  74:19  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\bookings\BookingsList.tsx
  62:26  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\charts\TrendsChart.tsx
  4:73  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  6:53  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\chat\ChatSidebar.tsx
  2:10  warning  'useState' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\chat\ChatsList.tsx
  22:24  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\chat\MessageInput.tsx
  24:19  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\customers\CustomerForm.tsx
  58:19  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\customers\CustomersList.tsx
   63:35  error    React Hook "useMemo" is called conditionally. React Hooks must be called in the exact same order in every component render. Did you accidentally call a React Hook after an early return?  react-hooks/rules-of-hooks
  139:28  warning  'id' is defined but never used                                                                                                                                                             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\reservations\ReservationForm.tsx
   13:88  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
   70:9   warning  'loadingBookings' is assigned a value but never used  @typescript-eslint/no-unused-vars
   87:14  warning  'e' is defined but never used                         @typescript-eslint/no-unused-vars
  100:23  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  107:20  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  169:19  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  185:19  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  217:45  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any
  265:41  error    Unexpected any. Specify a different type              @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\reservations\ReservationsList.tsx
   35:18  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   65:26  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  119:30  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\reservations\ReservationsTable.tsx
  70:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  79:35  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  81:35  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\reservations\ServicesMultiSelect.tsx
  31:35  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\reservations\StaffSelect.tsx
  23:26  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\services\ServiceForm.tsx
   8:105  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  56:19   error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\services\ServicesList.tsx
  63:26  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\superadmin\TenantsList.tsx
  8:18  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\superadmin\UsageChart.tsx
  5:10  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  8:23  warning  'usage' is defined but never used         @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\tenants\InviteStaffForm.tsx
  28:19  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\tenants\StaffList.tsx
  31:7   warning  Expected an assignment or function call and instead saw an expression  @typescript-eslint/no-unused-expressions
  46:7   warning  Expected an assignment or function call and instead saw an expression  @typescript-eslint/no-unused-expressions
  66:53  error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\tenants\WhatsAppQRCodeSection.tsx
   1:10   warning  'useState' is defined but never used                                                                                                                                                                                                                                                     @typescript-eslint/no-unused-vars
   7:110  error    `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`                                                                                                                                                                                                                          react/no-unescaped-entities
  10:11   warning  Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element  @next/next/no-img-element

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\ui\LoginForm.tsx
  18:19  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\ui\modal.tsx
  10:7   error    Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\components\ui\modal.tsx:10:7
   8 |   useEffect(() => {
   9 |     if (!open) {
> 10 |       setVisible(false);
     |       ^^^^^^^^^^ Avoid calling setState() directly within an effect
  11 |       return;
  12 |     }
  13 |     // Small delay to trigger CSS transition  react-hooks/set-state-in-effect
  22:16  warning  'e' is defined but never used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useBookingActions.ts
  8:96  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useBookings.ts
  26:49  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useChatRealtime.ts
  30:60   error    Unexpected any. Specify a different type                                                                                                                                                                                               @typescript-eslint/no-explicit-any
  38:6    warning  React Hook useCallback has a missing dependency: 'unreadMap'. Either include it or remove the dependency array. You can also replace multiple useState variables with useReducer if 'setChats' needs the current value of 'unreadMap'  react-hooks/exhaustive-deps
  48:56   error    Unexpected any. Specify a different type                                                                                                                                                                                               @typescript-eslint/no-explicit-any
  63:127  error    Unexpected any. Specify a different type                                                                                                                                                                                               @typescript-eslint/no-explicit-any
  98:20   error    Unexpected any. Specify a different type                                                                                                                                                                                               @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useMessages.ts
  20:18   error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any
  22:42   error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any
  25:136  error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any
  46:26   warning  Expected an assignment or function call and instead saw an expression  @typescript-eslint/no-unused-expressions
  54:80   error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useRealtimeClient.ts
   7:36  error  Unexpected any. Specify a different type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     @typescript-eslint/no-explicit-any
  15:5   error  Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useRealtimeClient.ts:15:5
  13 |     const c = getRealtimeClient(authToken || undefined);
  14 |     c.onStatus(setStatus);
> 15 |     setStatus(c.getStatus());
     |     ^^^^^^^^^ Avoid calling setState() directly within an effect
  16 |     setClient(c);
  17 |     return () => { /* keep singleton; do not stop */ };
  18 |   }, [token]);  react-hooks/set-state-in-effect
  20:49  error  Unexpected any. Specify a different type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useServices.ts
  13:22  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\hooks\useSuperadminTenants.ts
  31:52  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\analyticsService.ts
  436:13  warning  'verticalConfig' is assigned a value but never used  @typescript-eslint/no-unused-vars
  618:34  warning  'tenantId' is defined but never used                 @typescript-eslint/no-unused-vars
  629:39  warning  'tenantId' is defined but never used                 @typescript-eslint/no-unused-vars
  640:36  warning  'tenantId' is defined but never used                 @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\bookingNotifications.ts
  1:52  error  Parsing error: Invalid character

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\dialogManager.ts
  18:18  error    Unexpected any. Specify a different type                                                               @typescript-eslint/no-explicit-any
  28:5   warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-var-requires')
  29:21  error    A `require()` style import is forbidden                                                                @typescript-eslint/no-require-imports
  52:12  warning  'e' is defined but never used                                                                          @typescript-eslint/no-unused-vars
  71:25  error    Unexpected any. Specify a different type                                                               @typescript-eslint/no-explicit-any
  83:12  warning  'e' is defined but never used                                                                          @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\enhancedJobManager.ts
  520:50  warning  '_payload' is defined but never used  @typescript-eslint/no-unused-vars
  520:60  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  526:53  warning  '_payload' is defined but never used  @typescript-eslint/no-unused-vars
  526:63  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  532:52  warning  '_payload' is defined but never used  @typescript-eslint/no-unused-vars
  532:62  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  538:64  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  549:62  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars
  560:58  warning  '_context' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\eventBus.ts
  21:75  warning  'version' is assigned a value but never used                    @typescript-eslint/no-unused-vars
  71:92  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  86:1   warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\featureFlags.ts
  75:34  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\healthChecks.ts
    8:28  error    Unexpected any. Specify a different type        @typescript-eslint/no-explicit-any
  189:9   warning  'startTime' is assigned a value but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\llmQuota.ts
  34:30   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  38:50   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  41:37   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  41:85   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  54:28   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  54:70   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  56:33   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  56:72   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  56:108  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  60:12   warning  'e' is defined but never used                                   @typescript-eslint/no-unused-vars
  65:1    warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\location-context.tsx
  23:25  error  Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\location-context.tsx:23:25
  21 |       if (raw) {
  22 |         const parsed = JSON.parse(raw);
> 23 |         if (parsed?.id) setLocationState({ id: parsed.id, name: parsed.name });
     |                         ^^^^^^^^^^^^^^^^ Avoid calling setState() directly within an effect
  24 |       }
  25 |     } catch {}
  26 |   }, []);  react-hooks/set-state-in-effect

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\machineLearningService.ts
   17:30  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
   18:28  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  342:5   warning  'targetDate' is defined but never used      @typescript-eslint/no-unused-vars
  343:5   warning  'serviceId' is defined but never used       @typescript-eslint/no-unused-vars
  344:5   warning  'staffId' is defined but never used         @typescript-eslint/no-unused-vars
  345:14  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  366:5   warning  'staffId' is defined but never used         @typescript-eslint/no-unused-vars
  381:21  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  382:5   warning  'tenantId' is defined but never used        @typescript-eslint/no-unused-vars
  383:5   warning  'serviceId' is defined but never used       @typescript-eslint/no-unused-vars
  437:88  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  466:21  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  467:5   warning  'tenantId' is defined but never used        @typescript-eslint/no-unused-vars
  468:5   warning  'serviceId' is defined but never used       @typescript-eslint/no-unused-vars
  523:39  warning  'tenantId' is defined but never used        @typescript-eslint/no-unused-vars
  523:57  warning  'startDate' is defined but never used       @typescript-eslint/no-unused-vars
  523:74  warning  'endDate' is defined but never used         @typescript-eslint/no-unused-vars
  533:47  warning  'bookingData' is defined but never used     @typescript-eslint/no-unused-vars
  533:60  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  553:40  warning  'revenueData' is defined but never used     @typescript-eslint/no-unused-vars
  553:53  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  557:49  warning  'staffData' is defined but never used       @typescript-eslint/no-unused-vars
  557:60  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  561:49  warning  'customerData' is defined but never used    @typescript-eslint/no-unused-vars
  561:63  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  565:94  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  579:42  warning  'serviceId' is defined but never used       @typescript-eslint/no-unused-vars
  579:70  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  584:41  warning  'serviceId' is defined but never used       @typescript-eslint/no-unused-vars
  584:69  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  590:14  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  591:5   warning  'pricingHistory' is defined but never used  @typescript-eslint/no-unused-vars
  591:21  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  592:5   warning  'demandHistory' is defined but never used   @typescript-eslint/no-unused-vars
  592:20  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  617:92  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  631:65  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  642:15  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  643:14  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\messagingAdapter.ts
  113:1  warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\optimizedScheduler.ts
  191:34  error    Unexpected any. Specify a different type     @typescript-eslint/no-explicit-any
  225:5   warning  'durationMinutes' is defined but never used  @typescript-eslint/no-unused-vars
  280:31  error    Unexpected any. Specify a different type     @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\paraphraser.ts
  25:1  warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\paymentService.ts
   22:29   error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  181:19   error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  270:23   warning  'params' is defined but never used        @typescript-eslint/no-unused-vars
  315:31   error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  564:25   error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  606:103  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\paymentsAdapter.ts
  142:36   error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  142:105  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  155:1    warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\rbac.ts
  47:1  warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\realtimeClient.ts
   5:44  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  54:22  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  62:14  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\redis.ts
   5:20  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  13:21  error    A `require()` style import is forbidden                         @typescript-eslint/no-require-imports
  16:12  warning  'e' is defined but never used                                   @typescript-eslint/no-unused-vars
  18:21  error    A `require()` style import is forbidden                         @typescript-eslint/no-require-imports
  23:14  warning  'err' is defined but never used                                 @typescript-eslint/no-unused-vars
  47:52  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  66:1   warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\retrieval.ts
   9:5  error    'docs' is never reassigned. Use 'const' instead                 prefer-const
  40:1  warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\securityAutomation.ts
   20:37  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  294:41  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  332:90  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  368:21  warning  '_key' is defined but never used          @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\staffRouting.ts
  86:1  warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\summarizerWorker.ts
  24:79  warning  'tenantId' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\supabase\auth-context.tsx
   6:9   error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  14:36  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  40:19  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  46:54  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  46:68  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  49:16  warning  'e' is defined but never used                                                                                        @typescript-eslint/no-unused-vars
  58:9   error    Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment
  60:9   error    Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment
  62:16  warning  'e' is defined but never used                                                                                        @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\supabase\tenant-context.tsx
  38:16  warning  'e' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\usageMetrics.ts
  18:42  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  18:78  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  41:1   warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\verticalModuleManager.ts
   13:30  error  Unexpected any. Specify a different type                                                                 @typescript-eslint/no-explicit-any
   14:29  error  Unexpected any. Specify a different type                                                                 @typescript-eslint/no-explicit-any
   33:32  error  Unexpected any. Specify a different type                                                                 @typescript-eslint/no-explicit-any
   34:29  error  Unexpected any. Specify a different type                                                                 @typescript-eslint/no-explicit-any
   35:32  error  Unexpected any. Specify a different type                                                                 @typescript-eslint/no-explicit-any
   38:31  error  Unexpected any. Specify a different type                                                                 @typescript-eslint/no-explicit-any
   45:35  error  Unexpected any. Specify a different type                                                                 @typescript-eslint/no-explicit-any
  393:7   error  Do not assign to the variable `module`. See: https://nextjs.org/docs/messages/no-assign-module-variable  @next/next/no-assign-module-variable
  431:7   error  Do not assign to the variable `module`. See: https://nextjs.org/docs/messages/no-assign-module-variable  @next/next/no-assign-module-variable
  465:7   error  Do not assign to the variable `module`. See: https://nextjs.org/docs/messages/no-assign-module-variable  @next/next/no-assign-module-variable
  528:7   error  Do not assign to the variable `module`. See: https://nextjs.org/docs/messages/no-assign-module-variable  @next/next/no-assign-module-variable

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\whatsappBookingFlow.ts
  179:77  error  Parsing error: Invalid character

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\lib\workerRunner.ts
   37:57  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   48:19  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   51:14  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
   54:29  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   73:39  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   79:41  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  101:39  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\admin\summarize-chat.ts
  24:14  warning  'e' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\jobs\create-recurring.ts
  26:46  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  30:16  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\jobs\enqueue-reminders.ts
  12:64  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  24:57  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\reminders\trigger.ts
  11:64  warning  'e' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\scheduler\find-free-slot.ts
  18:64  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  21:54  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\scheduler\find-free-staff.ts
  14:64  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  17:56  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\scheduler\next-available.ts
  15:64  warning  'e' is defined but never used             @typescript-eslint/no-unused-vars
  18:59  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\tenants\[tenantId]\services.ts
  46:12  warning  '_err' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\tenants\[tenantId]\staff.ts
  11:64  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
  35:49  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  36:12  warning  '_err' is defined but never used          @typescript-eslint/no-unused-vars
  38:55  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  40:14  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
  56:14  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
  68:14  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars
  79:14  warning  '_e' is defined but never used            @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\pages\api\user\tenant.ts
  100:9   error    Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment
  105:45  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  110:44  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  135:14  warning  'upsertFallbackErr' is defined but never used                                                                        @typescript-eslint/no-unused-vars
  146:27  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  146:65  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  181:29  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  181:69  error    Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\test\jest.setup.ts
   1:1   error    Do not use "@ts-nocheck" because it alters compilation errors  @typescript-eslint/ban-ts-comment
  21:17  warning  '_opts' is defined but never used                              @typescript-eslint/no-unused-vars
  22:9   warning  '_task' is defined but never used                              @typescript-eslint/no-unused-vars
  22:26  warning  '_opts' is defined but never used                              @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\test\tinypoolStub.ts
  16:1  warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\types\analytics.ts
   41:29  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  117:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  129:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  155:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  186:10  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  327:30  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  338:29  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  343:41  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  350:9   error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\types\bookingFlow.ts
    8:27  warning  'BookingContext' is defined but never used  @typescript-eslint/no-unused-vars
   45:28  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  117:29  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  183:26  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  190:10  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  197:26  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  232:27  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  301:38  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  314:28  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  333:26  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
  430:29  error    Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\types\evolutionApi.ts
    9:43  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  421:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\types\permissions.ts
   55:10  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   72:26  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   81:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  386:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  411:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  421:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  430:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\src\worker\worker.ts
   9:28  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  11:36  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  19:29  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  19:61  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  25:64  error    Unexpected any. Specify a different type                        @typescript-eslint/no-explicit-any
  35:1   warning  Assign object to a variable before exporting as module default  import/no-anonymous-default-export

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\adapterContracts.test.ts
  17:42  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  18:40  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\authMe.test.ts
  16:14  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  21:14  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  23:47  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  25:8   error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  32:16  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  40:16  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\eventBus.test.ts
  7:8  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\invitesCookies.test.ts
   7:90  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
   8:25  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  15:95  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  26:14  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  33:14  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  36:70  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  38:40  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  41:8   error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any
  50:5   error  Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment
  53:32  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\llmQuota.test.ts
   4:44  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  15:12  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  17:8   error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\onboardingApi.test.ts
  14:32  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\skillManagerOptimistic.test.tsx
  8:1  error  Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\skillsApi.test.ts
   5:29  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   5:51  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  11:23  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  12:14  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  14:47  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  16:8   error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  24:72  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  29:32  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\skillsPatchDelete.test.ts
  10:25  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  12:14  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  14:47  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  16:8   error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  24:16  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  31:16  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\staffSkillUnassign.test.ts
  12:8  error  Parsing error: ',' expected

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\superadminHooks.test.tsx
   7:1   error  Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment
  23:17  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\usagePanel.test.tsx
  8:1  error  Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\useBookingActions.test.tsx
   7:1   error  Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment
  45:69  error  Unexpected any. Specify a different type                                                                             @typescript-eslint/no-explicit-any

C:\Users\DELL\Documents\Techclave\projects\booking\boka\tests\whatsappBookingIntegration.test.ts
  193:13  warning  'response' is assigned a value but never used  @typescript-eslint/no-unused-vars

C:\Users\DELL\Documents\Techclave\projects\booking\boka\types.ts
   81:29  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  173:29  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  230:77  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  232:26  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 499 problems (324 errors, 175 warnings)
  2 errors and 3 warnings potentially fixable with the `--fix` option.


C:\Users\DELL\Documents\Techclave\projects\booking\boka>