# Accounts: optional, with passkeys

Anonymous use is the default and stays complete. Submitting, checking,
withdrawing and making agent keys all work with a receipt alone, exactly as
before accounts existed. An account is a convenience on top:

- one place to see your submissions, without pasting receipts;
- withdrawing them from that list;
- agent keys that read every submission in the account, including ones
  added after the key was made.

The page's **Account** tab (`#account`) offers it. Nothing else asks for
it, and the Submit page only offers to add a submission to one after it
was submitted or looked up.

## What an account is

An account is its passkeys. It has no email, username or password.

- **Creating one** asks the browser for a new passkey. The passkey must be
  discoverable, so signing in needs no name, and must verify its user
  (PIN, fingerprint or face, not just a tap). No attestation is asked for,
  so the site never learns which device or provider made it.
- **The WebAuthn user handle** is 32 random bytes. The name a password
  manager shows is `glyph-drop-stats-YYYY-MM-DD`, the day it was made.
  Neither names anyone.
- **The site stores** each passkey's credential id, its public key, its
  signature counter, its transport hints, whether its provider syncs it,
  and when it was added and last used. A public key can check a sign-in
  but never make one.
- **Submissions join an account** only when their receipt holder adds
  them, and the receipt proves it. A submission is in one account at
  most. The account keeps which submissions it holds, never their
  receipts.

## Signing in

A session is a random 256-bit token in one cookie:

```
__Host-gds_session=<token>; Max-Age=1209600; Path=/; Secure; HttpOnly; SameSite=Strict
```

- `__Host-` with `Secure` and `Path=/` and no `Domain`: only this host
  sets it or receives it. `HttpOnly`: the page's scripts can't read it.
- The server stores only the token's SHA-256, with the account and an
  expiry 14 days on. Every sign-in makes a new token and ends the
  browser's previous session. Signing out deletes it.
- The daily cron deletes expired sessions and challenges.

## Security

| Concern | How it is handled |
| --- | --- |
| Phishing, credential reuse | Passkeys are bound to the site's host (the RP ID) and origin. A passkey made for another site never verifies here. |
| Replayed ceremonies | Every challenge is random, stored server-side, single use (taken with `DELETE … RETURNING` before verifying), bound to its purpose (`register`, `sign_in`, `add_passkey`) and expires after 5 minutes. |
| A challenge used across accounts | A challenge for adding a passkey is bound to the account that asked for it; another account's session can't use it. |
| Cloned authenticators | The signature counter must increase for authenticators that keep one. |
| A forged user handle | At sign-in, the user handle the passkey returns must be the account's. |
| Cross-site requests (CSRF) | Every account `POST` must carry the site's own `Origin` and a JSON body (a plain form can't send one). `SameSite=Strict` already keeps the cookie off cross-site requests. `GET /api/account` changes nothing and sends no CORS headers, so other sites can't read it. |
| Pinning the origin | Production sets `SITE_ORIGIN` (wrangler.jsonc), so passkeys and the origin check use `https://stats.ingress.wiki` whatever the request's host. Elsewhere the request's own origin is used. |
| Claiming someone else's submission | Adding needs the submission's receipt in `Authorization: Receipt …`, as every receipt action does. |
| Reaching another account's things | Every query that reads or changes a submission, passkey or key is scoped by the session's account id. Ids from another account answer "not in your account". |
| Locking yourself out | The last passkey can't be removed. Add another (on a second device, or in another password manager) to keep a way in. |
| Account keys and receipts | An account's agent key reads only, like any agent key. A receipt can't link a submission to an account's key: it joins through the account instead. |
| Limits | 20 passkeys and 500 submissions per account. Request bodies over 16 KiB are refused before they are read. |

**Not yet done:**

- **Rate limiting.** Creating accounts and challenges is unauthenticated,
  as submitting is. Abuse would be best met with a Cloudflare rate-limiting
  rule on `/api/account/*`, for the whole API, before submissions open for
  real.
- **Recovery.** There is none beyond a second passkey. That is deliberate
  (no email to recover through), and the account holds nothing a receipt
  can't reach.
- **Re-authentication.** Withdrawing and deleting the account need the
  session, not a fresh passkey check.

## Deleting the account

Deleting removes the account, its passkeys, sessions, pending challenges
and agent keys, and which submissions it held. The submissions themselves
stay, as anonymous as before they were added; their receipts still check
and withdraw them, and they can be added to another account. After
deleting or removing a passkey, the page tells the browser through the
WebAuthn Signal API, where supported, so password managers stop offering
the passkey.

During the test period, the wipe deletes every submission, the links to
accounts and all agent keys. Accounts, passkeys and sessions stay, empty,
so their holders can still sign in.

## Endpoints

All under `/api/account`, answered with `cache-control: no-store`. Every
`POST` needs the site's `Origin` and `content-type: application/json`.
Those marked *session* need the cookie and answer 401 `signed_out`
(clearing it) without one. Changes answer with the account as it now is.

| Endpoint | Does |
| --- | --- |
| `GET /api/account` | `{"account": …}` for the session, or `null` when signed out. |
| `POST /register/options`, `POST /register` | Options for a new account's passkey; then `{"response": …}` creates the account and signs in. |
| `POST /login/options`, `POST /login` | Options for signing in with any of the site's passkeys; then `{"response": …}` signs in. |
| `POST /logout` | Ends the session. |
| `POST /passkeys/options`, `POST /passkeys` | *Session.* Adds a passkey. |
| `POST /passkeys/remove` | *Session.* `{"passkeyId": …}`; refused for the last one. |
| `POST /submissions` | *Session* and `Authorization: Receipt …`. Adds that submission. Idempotent. |
| `POST /submissions/withdraw` | *Session.* `{"submissionId": …}`. Idempotent, like withdrawing with the receipt. |
| `POST /agent-keys` | *Session.* `{"keyHash": …}`: the key is made in the browser and only its hash is sent. |
| `POST /agent-keys/revoke` | *Session.* `{"keyId": …}`. Holders can also revoke with the key itself (`/api/agent-key/revoke`). |
| `POST /delete` | *Session.* Deletes the account. |

## Code

- **Worker:**
  - `src/worker/accounts.ts`: the tables' rules;
  - `src/worker/passkeys.ts`: the ceremonies, through
    [SimpleWebAuthn](https://simplewebauthn.dev);
  - `src/worker/accountApi.ts`: the endpoints, the cookie and the origin
    check.
- **Page:** `src/web/passkeys.ts` runs the ceremonies in the browser.
  `src/web/Account.tsx` is the account page and the offer beside a
  receipt. The store (`src/web/app/store.ts`) holds the state.
- **Schema:** `migrations/0005_accounts.sql`.

**Tests:**

- `tests/d1/accounts.test.ts` runs every ceremony against the real
  verifier with a software authenticator (`tests/helpers/authenticator.ts`).
  It also covers origins, cookies, challenge reuse and expiry, claims,
  withdrawal, keys, limits and deletion, and that anonymous use is
  unchanged.
- `tests/browser/account.mjs` drives Chrome's virtual authenticator
  through the whole page.
