/**
 * Calls the Firebase Auth REST API with the project's service credential to
 * update a user's real password without a prior client session. The secret
 * is read from the function's environment and never logged.
 */
const FIREBASE_PROJECT_ID = "salespilot-e581d";

interface FirebaseServiceAccountLike {
  client_email?: string;
  private_key?: string;
}

export type FirebaseAdminErrorKind =
  | "missing_firebase_service_account"
  | "invalid_firebase_service_account"
  | "firebase_token_exchange_failed"
  | "firebase_password_update_failed";

export class FirebaseAdminError extends Error {
  readonly kind: FirebaseAdminErrorKind;
  constructor(kind: FirebaseAdminErrorKind) {
    super(kind);
    this.name = "FirebaseAdminError";
    this.kind = kind;
  }
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  const keyJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!keyJson) throw new FirebaseAdminError("missing_firebase_service_account");
  const key = JSON.parse(keyJson) as FirebaseServiceAccountLike;
  if (!key.client_email || !key.private_key) throw new FirebaseAdminError("invalid_firebase_service_account");

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claims}`;
  const keyData = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(key.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyData, new TextEncoder().encode(unsigned));
  const signedJwt = `${unsigned}.${b64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("firebase token exchange failed", res.status, sanitizeErrorDetail(detail));
    throw new FirebaseAdminError("firebase_token_exchange_failed");
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new FirebaseAdminError("firebase_token_exchange_failed");
  return body.access_token;
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN[\s\S]+?-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Sets the real Firebase Auth password for the given uid. */
export async function updateFirebasePassword(uid: string, newPassword: string): Promise<void> {
  const accessToken = await getAccessToken();
  // Use the Admin REST endpoint, not the client SDK endpoint. The client
  // endpoint (accounts:update?key=…) expects an idToken in the body, while the
  // admin endpoint (projects/{projectId}/accounts:update) accepts localId +
  // password with the OAuth2 Bearer token we minted from the service account.
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:update`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ localId: uid, password: newPassword, disableUser: false, returnSecureToken: false }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("firebase password update failed", res.status, sanitizeErrorDetail(detail));
    throw new FirebaseAdminError("firebase_password_update_failed");
  }
}

/**
 * Looks up a Firebase user by email and returns their localId (uid). Used when
 * the member row has no stored firebase_uid yet — the account exists in
 * Firebase but hasn't been linked in our database.
 */
export async function lookupFirebaseUidByEmail(email: string): Promise<string | null> {
  const accessToken = await getAccessToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:lookup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email: [email] }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("firebase user lookup failed", res.status, sanitizeErrorDetail(detail));
    return null;
  }
  const body = (await res.json()) as { users?: { localId?: string }[] };
  const user = body.users?.[0];
  return user?.localId ?? null;
}

/**
 * Updates a Firebase user's password by email. If the member row has no stored
 * firebase_uid, looks it up from Firebase first, then updates the password.
 * Returns the uid used so the caller can persist it.
 */
export async function updateFirebasePasswordByEmail(email: string, newPassword: string): Promise<string> {
  const accessToken = await getAccessToken();
  // Look up the user by email to get their localId.
  const uid = await lookupFirebaseUidByEmail(email);
  if (!uid) throw new FirebaseAdminError("firebase_password_update_failed");
  await updateFirebasePassword(uid, newPassword);
  return uid;
}

function sanitizeErrorDetail(detail: string): string {
  // Keep only non-sensitive parts: status shape, never tokens or passwords.
  return detail.slice(0, 200).replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]");
}
