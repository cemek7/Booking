# Booka Supabase Auth Templates

Owner-run configuration only. Save the current template text before replacing it.

## Required configuration

1. In **Authentication → URL Configuration**, retain:
   - `https://staging.app.techclave.cloud/booka/auth/callback**`
   - `https://app.techclave.cloud/booka/auth/callback**`
2. In **Authentication → Email Templates**, replace the three enabled templates below.
3. In **Authentication → Providers → Email**, keep **Secure Email Change enabled**.
4. Test staging first. Inspect the destination host before opening the message.
5. Roll back by restoring the saved prior template text.

Supabase Invite and Recovery are unused. Booka tenant invites use Booka's hashed-token flow, and Booka has no password recovery flow.

## Magic Link

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Your secure link to Booka</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f5ef;color:#10211a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Use this secure, one-time link to continue into Booka.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5ef;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
          <tr><td style="padding:0 4px 18px;"><strong style="font-size:23px;">Booka</strong><div style="font-size:12px;color:#597061;">by Techclave</div></td></tr>
          <tr><td style="background:#fff;border:1px solid #d8d3c4;border-radius:24px;overflow:hidden;">
            <div style="height:6px;background:#16a369;"></div>
            <div style="padding:38px 34px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#16875b;">Secure sign-in</div>
              <h1 style="margin:14px 0 0;font-size:30px;line-height:38px;">Continue into Booka.</h1>
              <p style="margin:18px 0 0;font-size:16px;line-height:27px;color:#4d6357;">Use this one-time link to sign in and return to your Booka workspace.</p>
              <p style="margin:28px 0 0;"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#16875b;color:#fff;font-weight:700;text-decoration:none;">Sign in to Booka</a></p>
              <p style="margin:28px 0 0;font-size:13px;color:#718078;">If the button does not work:</p>
              <p style="margin:8px 0 0;"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email" style="color:#16875b;text-decoration:underline;">Open secure sign-in link</a></p>
              <p style="margin:30px 0 0;padding-top:22px;border-top:1px solid #e8e4d9;font-size:13px;color:#718078;">This link is personal and can only be used once.</p>
            </div>
          </td></tr>
          <tr><td style="padding:20px 6px;text-align:center;font-size:12px;color:#7c887f;">Booka by Techclave · AI Revenue Front Desk</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

## Confirm Signup

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Confirm your email for Booka</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f5ef;color:#10211a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm your email and continue into Booka.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5ef;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
          <tr><td style="padding:0 4px 18px;"><strong style="font-size:23px;">Booka</strong><div style="font-size:12px;color:#597061;">by Techclave</div></td></tr>
          <tr><td style="background:#fff;border:1px solid #d8d3c4;border-radius:24px;overflow:hidden;">
            <div style="height:6px;background:#16a369;"></div>
            <div style="padding:38px 34px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#16875b;">Confirm your email</div>
              <h1 style="margin:14px 0 0;font-size:30px;line-height:38px;">Your Booka workspace is one click away.</h1>
              <p style="margin:18px 0 0;font-size:16px;line-height:27px;color:#4d6357;">Confirm your address to continue setting up your Booka workspace.</p>
              <p style="margin:28px 0 0;"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#16875b;color:#fff;font-weight:700;text-decoration:none;">Confirm email and continue</a></p>
              <p style="margin:28px 0 0;font-size:13px;color:#718078;">If the button does not work:</p>
              <p style="margin:8px 0 0;"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email" style="color:#16875b;text-decoration:underline;">Open secure confirmation link</a></p>
              <p style="margin:30px 0 0;padding-top:22px;border-top:1px solid #e8e4d9;font-size:13px;color:#718078;">If you did not start a Booka signup, ignore this email.</p>
            </div>
          </td></tr>
          <tr><td style="padding:20px 6px;text-align:center;font-size:12px;color:#7c887f;">Booka by Techclave · AI Revenue Front Desk</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

## Change Email

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Confirm your Booka login email</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f5ef;color:#10211a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm your Booka login email change.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5ef;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
          <tr><td style="padding:0 4px 18px;"><strong style="font-size:23px;">Booka</strong><div style="font-size:12px;color:#597061;">by Techclave</div></td></tr>
          <tr><td style="background:#fff;border:1px solid #d8d3c4;border-radius:24px;overflow:hidden;">
            <div style="height:6px;background:#16a369;"></div>
            <div style="padding:38px 34px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#16875b;">Login email change</div>
              <h1 style="margin:14px 0 0;font-size:30px;line-height:38px;">Confirm your new login email.</h1>
              <p style="margin:18px 0 0;font-size:16px;line-height:27px;color:#4d6357;">Confirm the change from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>.</p>
              <p style="margin:28px 0 0;"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email_change" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#16875b;color:#fff;font-weight:700;text-decoration:none;">Confirm login email</a></p>
              <p style="margin:28px 0 0;font-size:13px;color:#718078;">If the button does not work:</p>
              <p style="margin:8px 0 0;"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email_change" style="color:#16875b;text-decoration:underline;">Open secure confirmation link</a></p>
              <p style="margin:30px 0 0;padding-top:22px;border-top:1px solid #e8e4d9;font-size:13px;color:#718078;">If you did not request this change, do not open the link.</p>
            </div>
          </td></tr>
          <tr><td style="padding:20px 6px;text-align:center;font-size:12px;color:#7c887f;">Booka by Techclave · AI Revenue Front Desk</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

## Staging check

Send each enabled message from staging. Before opening it, confirm the destination begins with `https://staging.app.techclave.cloud/booka/auth/callback`. Never paste a live token into chat, logs, or documentation.
