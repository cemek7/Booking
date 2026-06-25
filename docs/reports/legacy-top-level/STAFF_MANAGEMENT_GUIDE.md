# Staff Management Guide for Owners

## Available Features ✅

Your booking platform already has complete staff management for owners:

### 1. Staff Management Dashboard
**Path:** `/dashboard/staff` (or `/dashboard/owner/staff`)

**What You Can Do:**
- View all staff members in your organization
- See staff performance metrics (ratings, completed bookings, revenue)
- Invite new staff members
- Assign or change staff roles
- Remove staff members
- View staff schedules

### 2. Staff Invitation
**How to Invite Staff:**
1. Go to `/dashboard/staff`
2. Click the "Invite Staff" button (appears as a modal)
3. Enter staff email address
4. Select role:
   - **Staff**: Basic access (personal bookings only)
   - **Manager**: Team management (can manage staff, view team analytics)
5. Click "Send Invitation"

**What Happens:**
- Staff member receives email invitation
- They click the link to create an account
- Their role is automatically set based on your selection
- They can immediately start accessing the system with their role permissions

### 3. Role Management
**Available Roles:**
- **Staff** (Level 3): 
  - Personal bookings and schedule
  - Can view own analytics
  - Cannot access settings or staff management
  
- **Manager** (Level 2):
  - All staff permissions PLUS
  - Team scheduling and management
  - Can invite staff members
  - Can view team analytics
  - Cannot access tenant settings
  
- **Owner** (Level 1):
  - All manager and staff permissions PLUS
  - Full tenant administration
  - Billing and payment management
  - Tenant settings and configuration
  - API key management
  - Can invite managers and staff
  - Can assign and change roles

### 4. API Endpoints for Staff Management
The system uses these APIs (already protected):

```
GET /api/owner/staff
  - List all staff in your tenant
  - Protected: owners only
  - Returns: [{ id, email, role, active, ... }]

POST /api/owner/staff
  - Manage staff (invite, update, remove)
  - Protected: owners only
  - Actions:
    - { action: 'invite', data: { email, role, fullName } }
    - { action: 'update', data: { staffId, role, active } }
    - { action: 'remove', data: { staffId } }
```

### 5. Navigation
The staff management section is available in your dashboard navigation when logged in as an owner.

**Menu Path:**
```
Dashboard
├── Staff (Only for owners/managers)
│   ├── Staff List
│   ├── Invite Staff Button
│   └── Role Management
```

## Common Tasks

### Invite a Manager
1. Click "Invite Staff" on `/dashboard/staff`
2. Enter their email (e.g., manager@example.com)
3. Select "Manager" role
4. They'll receive an invitation email
5. Once they sign up, they can manage team and schedule

### Change a Staff Member's Role
1. Go to `/dashboard/staff`
2. Find the staff member in the list
3. Click on them or the "Edit Role" button
4. Select new role (Staff, Manager, or Owner)
5. Save changes

### Remove a Staff Member
1. Go to `/dashboard/staff`
2. Find the staff member
3. Click "Remove" button
4. Confirm deletion
5. They lose access to the system

### View Staff Performance
1. Go to `/dashboard/staff`
2. Each staff member card shows:
   - Average rating (from customer reviews)
   - Number of completed bookings
   - Total revenue generated
   - Current status (active/on leave)

## Technical Notes

### Role Hierarchy
```
SuperAdmin > Owner > Manager > Staff
```

**What This Means:**
- Owners have all permissions that managers and staff have
- Managers have all staff permissions plus team management
- Staff have only their personal work permissions
- SuperAdmin has system-wide control (for platform support)

### Tenant Isolation
- Staff can ONLY see and work with bookings/customers in your tenant
- No cross-tenant access (everyone is isolated by their organization)
- When you invite staff, they automatically become part of your tenant

### Permissions Model
The system uses role-based access control (RBAC):
- **Server-side:** All API routes check user role before returning data
- **Client-side:** Navigation hides inaccessible features (UX only)
- **Database:** Queries filtered by tenant_id automatically

## Troubleshooting

### "Access Denied" when visiting /dashboard/staff
- **Cause:** You're not logged in as an owner
- **Fix:** Contact your account owner or check your role

### Staff member not receiving invitation email
- **Cause:** Email service may be down or address is invalid
- **Fix:** 
  1. Verify email address is correct
  2. Ask staff member to check spam folder
  3. Retry the invitation

### Staff member can't see their assignments
- **Cause:** Role might be "staff" instead of "manager"
- **Fix:** 
  1. Go to `/dashboard/staff`
  2. Update their role to "manager"
  3. They'll immediately have manager access

### Can't invite managers
- **Cause:** You need to be an owner (not manager)
- **Fix:** Ask your account owner to send the invitation

## API Reference for Developers

### Get Staff List
```bash
curl -X GET http://localhost:3000/api/owner/staff \
  -H "Authorization: Bearer {token}" \
  -H "X-Tenant-ID: {tenantId}"
```

### Invite Staff Member
```bash
curl -X POST http://localhost:3000/api/owner/staff \
  -H "Authorization: Bearer {token}" \
  -H "X-Tenant-ID: {tenantId}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "invite",
    "data": {
      "email": "newstaff@example.com",
      "role": "staff",
      "fullName": "John Doe"
    }
  }'
```

### Update Staff Role
```bash
curl -X POST http://localhost:3000/api/owner/staff \
  -H "Authorization: Bearer {token}" \
  -H "X-Tenant-ID: {tenantId}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update",
    "data": {
      "staffId": "{userId}",
      "role": "manager",
      "active": true
    }
  }'
```

### Remove Staff Member
```bash
curl -X POST http://localhost:3000/api/owner/staff \
  -H "Authorization: Bearer {token}" \
  -H "X-Tenant-ID: {tenantId}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "remove",
    "data": {
      "staffId": "{userId}"
    }
  }'
```

## Next Steps

1. **Test staff invitation:** Go to `/dashboard/staff` and try inviting a test account
2. **Verify role access:** Invite staff with different roles and verify they see correct features
3. **Check dashboard:** Ensure all analytics and metrics load correctly
4. **Test staff access:** Have staff member log in and verify they see only their data

---

**All features are ready to use!** Start inviting your staff to collaborate.
