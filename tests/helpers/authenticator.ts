import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import type { webcrypto } from "node:crypto";

type CryptoKeyPair = webcrypto.CryptoKeyPair;

/**
 * A software passkey authenticator for tests: ES256 keys in WebCrypto,
 * "none" attestation, and the byte formats of WebAuthn Level 3, so the
 * server's real verifier checks every ceremony. It plays the browser's part
 * too (clientDataJSON), for whatever origin it is told it runs on.
 */

interface Credential {
  id: Uint8Array<ArrayBuffer>;
  rpId: string;
  userHandle: string;
  keys: CryptoKeyPair;
  counter: number;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

const utf8 = (text: string) => new TextEncoder().encode(text);
const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const uint32 = (value: number) => new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);

/** An ECDSA signature from WebCrypto's r‖s to the DER that WebAuthn carries. */
function derSignature(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const trimmed = bytes.slice(start);
    const body = trimmed[0] & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, body.length]), body);
  };
  const sequence = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(new Uint8Array([0x30, sequence.length]), sequence);
}

async function cosePublicKey(keys: CryptoKeyPair): Promise<Uint8Array> {
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  // kty EC2, alg ES256, crv P-256, x, y.
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x ?? "")],
      [-3, isoBase64URL.toBuffer(jwk.y ?? "")],
    ]),
  );
}

export class SoftAuthenticator {
  readonly credentials: Credential[] = [];
  /** Whether new passkeys say they are synced, as a password manager's are. */
  backedUp = true;
  /** False to act like a security key with no PIN set: present, but not verified. */
  verifiesUser = true;

  readonly origin: string;

  constructor(origin: string) {
    this.origin = origin;
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string) {
    return utf8(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  private flags(extra: number) {
    return new Uint8Array([FLAG_UP | (this.verifiesUser ? FLAG_UV : 0) | (this.backedUp ? FLAG_BE | FLAG_BS : 0) | extra]);
  }

  async create(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON> {
    const rpId = options.rp.id ?? new URL(this.origin).hostname;
    if ((options.excludeCredentials ?? []).some((excluded) => this.credentials.some((credential) => isoBase64URL.fromBuffer(credential.id) === excluded.id))) {
      throw new Error("InvalidStateError: this authenticator already holds a passkey for the account");
    }
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const credential: Credential = { id: crypto.getRandomValues(new Uint8Array(32)), rpId, userHandle: options.user.id, keys, counter: 0 };
    this.credentials.push(credential);
    const authData = concat(
      await sha256(utf8(rpId)),
      this.flags(FLAG_AT),
      uint32(credential.counter),
      new Uint8Array(16),
      new Uint8Array([0, credential.id.length]),
      credential.id,
      await cosePublicKey(keys),
    );
    const attStmt = new Map<string, never>();
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, never> | Uint8Array>([
        ["fmt", "none"],
        ["attStmt", attStmt],
        ["authData", authData],
      ]),
    );
    const id = isoBase64URL.fromBuffer(credential.id);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(this.clientData("webauthn.create", options.challenge)),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Signs with the given passkey, or the first one for the RP, as a browser offering discoverable passkeys would. */
  async get(options: PublicKeyCredentialRequestOptionsJSON, which?: Credential): Promise<AuthenticationResponseJSON> {
    const rpId = options.rpId ?? new URL(this.origin).hostname;
    const credential = which ?? this.credentials.find((candidate) => candidate.rpId === rpId);
    if (!credential) throw new Error("NotAllowedError: no passkey for this site");
    credential.counter += 1;
    const authData = concat(await sha256(utf8(rpId)), this.flags(0), uint32(credential.counter));
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const signed = concat(authData, await sha256(clientDataJSON));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, credential.keys.privateKey, signed));
    const id = isoBase64URL.fromBuffer(credential.id);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(derSignature(raw)),
        userHandle: credential.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
