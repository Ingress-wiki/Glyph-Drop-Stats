import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import { base64url } from "../domain/hash.ts";
import {
  CHALLENGE_SECONDS,
  findPasskey,
  passkeyIds,
  recordPasskeyUse,
  saveChallenge,
  takeChallenge,
  userHandleOf,
  type ChallengePurpose,
  type NewPasskey,
} from "./accounts.ts";
import type { Db } from "./db.ts";

/**
 * The WebAuthn ceremonies, through SimpleWebAuthn. Every passkey must be
 * discoverable (so sign-in needs no username) and verify its user (a PIN,
 * fingerprint or face, not just a tap). No attestation is asked for: which
 * device made a passkey is none of the site's business.
 */

export interface RelyingParty {
  /** The site's origin, the only one a ceremony or an account request may come from. */
  origin: string;
  /** Its host name, which passkeys are bound to. */
  id: string;
  name: string;
}

/**
 * `SITE_ORIGIN` pins production to its one address; without it (local
 * development, tests) the request's own origin is the site.
 */
export function relyingParty(env: { SITE_ORIGIN?: string }, request: Request): RelyingParty {
  const url = new URL(env.SITE_ORIGIN || request.url);
  return { origin: url.origin, id: url.hostname, name: "Glyph Drop Stats" };
}

const TIMEOUT_MS = CHALLENGE_SECONDS * 1000;

/** What a password manager lists the passkey as: the site and the day it was made, naming no one. */
const userName = (now: number) => `glyph-drop-stats-${new Date(now * 1000).toISOString().slice(0, 10)}`;

/** The options for a new account's first passkey. The account doesn't exist until it is verified. */
export async function registrationOptions(db: Db, rp: RelyingParty, now: number): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const userHandle = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const options = await creationOptions(rp, userHandle, [], now);
  await saveChallenge(db, { value: options.challenge, purpose: "register", userHandle }, now);
  return options;
}

/** The options for another passkey on a signed-in account, such as one on a second device. */
export async function addPasskeyOptions(db: Db, rp: RelyingParty, accountId: number, now: number): Promise<PublicKeyCredentialCreationOptionsJSON | null> {
  const userHandle = await userHandleOf(db, accountId);
  if (!userHandle) return null;
  const options = await creationOptions(rp, userHandle, await passkeyIds(db, accountId), now);
  await saveChallenge(db, { value: options.challenge, purpose: "add_passkey", accountId }, now);
  return options;
}

function creationOptions(rp: RelyingParty, userHandle: string, existing: { id: string; transports: string[] }[], now: number) {
  return generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userID: isoBase64URL.toBuffer(userHandle),
    userName: userName(now),
    userDisplayName: `Glyph Drop Stats (${userName(now).slice(-10)})`,
    attestationType: "none",
    // The same authenticator twice would be no backup at all.
    excludeCredentials: existing,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    timeout: TIMEOUT_MS,
  });
}

export async function signInOptions(db: Db, rp: RelyingParty, now: number): Promise<PublicKeyCredentialRequestOptionsJSON> {
  // No allowCredentials: the browser offers whichever of the site's passkeys the player has.
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "required", timeout: TIMEOUT_MS });
  await saveChallenge(db, { value: options.challenge, purpose: "sign_in" }, now);
  return options;
}

export type CeremonyFailure = "expired" | "failed" | "unknown_passkey";

/**
 * Takes the challenge the browser signed, for one use. It is gone whether or
 * not what follows verifies, so a response can't be tried twice.
 */
async function takeSignedChallenge(db: Db, clientDataJSON: string, purpose: ChallengePurpose, now: number) {
  let challenge: string;
  try {
    challenge = decodeClientDataJSON(clientDataJSON).challenge;
  } catch {
    return null;
  }
  if (typeof challenge !== "string" || challenge === "") return null;
  const taken = await takeChallenge(db, challenge, purpose, now);
  return taken && { challenge, ...taken };
}

/** A verified new passkey, and what its challenge was issued for. */
export type VerifiedRegistration = { ok: true; passkey: NewPasskey; userHandle: string | null; accountId: number | null } | { ok: false; failure: CeremonyFailure };

export async function verifyRegistration(db: Db, rp: RelyingParty, response: RegistrationResponseJSON, purpose: "register" | "add_passkey", now: number): Promise<VerifiedRegistration> {
  const taken = await takeSignedChallenge(db, response.response.clientDataJSON, purpose, now);
  if (!taken) return { ok: false, failure: "expired" };
  try {
    const verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: taken.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
    if (!verified.verified) return { ok: false, failure: "failed" };
    const { credential, credentialBackedUp } = verified.registrationInfo;
    return {
      ok: true,
      passkey: {
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        backedUp: credentialBackedUp,
      },
      userHandle: taken.userHandle,
      accountId: taken.accountId,
    };
  } catch {
    return { ok: false, failure: "failed" };
  }
}

export type VerifiedSignIn = { ok: true; accountId: number } | { ok: false; failure: CeremonyFailure };

export async function verifySignIn(db: Db, rp: RelyingParty, response: AuthenticationResponseJSON, now: number): Promise<VerifiedSignIn> {
  const taken = await takeSignedChallenge(db, response.response.clientDataJSON, "sign_in", now);
  if (!taken) return { ok: false, failure: "expired" };
  const passkey = await findPasskey(db, response.id);
  if (!passkey) return { ok: false, failure: "unknown_passkey" };
  // A discoverable passkey names its account; it must be the one the passkey was registered to.
  if (response.response.userHandle !== undefined && response.response.userHandle !== passkey.userHandle) return { ok: false, failure: "failed" };
  try {
    const verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: taken.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: { id: passkey.credentialId, publicKey: isoBase64URL.toBuffer(passkey.publicKey), counter: passkey.counter, transports: passkey.transports },
      requireUserVerification: true,
    });
    if (!verified.verified) return { ok: false, failure: "failed" };
    await recordPasskeyUse(db, passkey.credentialId, verified.authenticationInfo.newCounter, verified.authenticationInfo.credentialBackedUp, now);
    return { ok: true, accountId: passkey.accountId };
  } catch {
    return { ok: false, failure: "failed" };
  }
}

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The fields every ceremony reads before SimpleWebAuthn checks the rest. */
function isCredentialJSON(value: unknown): value is { id: string; rawId: string; type: "public-key"; response: Record<string, unknown>; clientExtensionResults: Record<string, unknown> } {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.rawId) &&
    value.type === "public-key" &&
    isObject(value.response) &&
    isString(value.response.clientDataJSON) &&
    isObject(value.clientExtensionResults)
  );
}

export function isRegistrationJSON(value: unknown): value is RegistrationResponseJSON {
  return isCredentialJSON(value) && isString(value.response.attestationObject);
}

export function isAuthenticationJSON(value: unknown): value is AuthenticationResponseJSON {
  return (
    isCredentialJSON(value) &&
    isString(value.response.authenticatorData) &&
    isString(value.response.signature) &&
    (value.response.userHandle === undefined || typeof value.response.userHandle === "string")
  );
}
