import { browserSupportsWebAuthn, sendSignal, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { accountRequest, ceremonyOptions, networkProblem, type AccountOutcome, type ApiIssue } from "./api.ts";

/**
 * The passkey ceremonies, through the browser's WebAuthn API and
 * SimpleWebAuthn. Each asks the server for options, lets the browser and the
 * player's passkey provider do their part, and sends the result back.
 */

export type Ceremony = "register" | "signIn" | "addPasskey";

/**
 * - `cancelled`: the player closed the browser's passkey dialog, or let it time out.
 * - `unsupported`: this browser can't use passkeys.
 */
export type CeremonyOutcome = AccountOutcome | { kind: "cancelled" } | { kind: "unsupported" };

const PATHS: Record<Ceremony, { options: string; finish: string }> = {
  register: { options: "/api/account/register/options", finish: "/api/account/register" },
  signIn: { options: "/api/account/login/options", finish: "/api/account/login" },
  addPasskey: { options: "/api/account/passkeys/options", finish: "/api/account/passkeys" },
};

/** The refusal the server would give, for a passkey the browser already knows is registered. */
const ALREADY_REGISTERED: ApiIssue = { code: "passkey_exists", key: "api.passkeyExists", message: "This passkey is already registered." };

export async function runCeremony(ceremony: Ceremony): Promise<CeremonyOutcome> {
  if (!browserSupportsWebAuthn()) return { kind: "unsupported" };
  const options = await ceremonyOptions(PATHS[ceremony].options);
  if (options.kind !== "ok") return options;
  let response: unknown;
  try {
    response =
      ceremony === "signIn"
        ? await startAuthentication({ optionsJSON: options.options as unknown as PublicKeyCredentialRequestOptionsJSON })
        : await startRegistration({ optionsJSON: options.options as unknown as PublicKeyCredentialCreationOptionsJSON });
  } catch (error) {
    if (error instanceof WebAuthnError && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return { kind: "refused", issues: [ALREADY_REGISTERED] };
    if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")) return { kind: "cancelled" };
    return { kind: "uncertain", problem: networkProblem(error) };
  }
  return accountRequest(PATHS[ceremony].finish, { response });
}

/**
 * Tells the player's passkey providers that these passkeys no longer work
 * here, so they stop offering them. Best effort: browsers without the Signal
 * API ignore it, and nothing depends on it.
 */
export function forgetPasskeys(rpID: string, ids: readonly string[]): void {
  for (const credentialID of ids) {
    sendSignal({ signalName: "unknownCredential", rpID, credentialID }).catch(() => undefined);
  }
}
