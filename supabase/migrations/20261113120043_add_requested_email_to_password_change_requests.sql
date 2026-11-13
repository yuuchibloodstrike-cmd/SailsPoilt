/*
# Add requested_email column to password_change_requests

## Purpose
The unauthenticated requestPasswordByEmail action stores the requester's email
for rate-limiting (max 5 requests per email per hour). This column was referenced
in code but missing from the schema.

## Changes
1. Adds `requested_email` (text, nullable) to `password_change_requests`.
   Nullable because existing rows and authenticated requests may not set it.

## Security
- No RLS or grant changes — the table is only accessed via the service-role
  edge function client.
- The column does not expose whether an email exists; the edge function always
  returns the same response shape regardless.
*/

ALTER TABLE password_change_requests
  ADD COLUMN IF NOT EXISTS requested_email text;

CREATE INDEX IF NOT EXISTS idx_password_requests_email_time
  ON password_change_requests (requested_email, requested_at);
