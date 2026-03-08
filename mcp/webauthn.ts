/**
 * webauthn.ts — WebAuthn passkey registration and authentication handlers.
 *
 * Uses @simplewebauthn/server for passkey crypto.
 * Separated from OAuth because these are a distinct authentication mechanism.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13";
import type {
  AuthenticatorTransportFuture,
} from "npm:@simplewebauthn/server@13";

import * as db from "./db.ts";

// ─── Configuration ───────────────────────────────────────────────

const RP_NAME = "sync-mcp";
const STABLE_RP_ID = Deno.env.get("WEBAUTHN_RP_ID") ?? "parc.land";

function getOrigin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export function getRpId(req: Request): string {
  const hostname = new URL(req.url).hostname;
  if (hostname === STABLE_RP_ID || hostname.endsWith("." + STABLE_RP_ID)) {
    return STABLE_RP_ID;
  }
  return hostname;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
    },
  });
}

// ─── WebAuthn: Registration Options ──────────────────────────────

export async function handleRegisterOptions(req: Request): Promise<Response> {
  const { username } = await req.json();
  if (
    !username || typeof username !== "string" || username.length < 1 ||
    username.length > 64
  ) {
    return json({ error: "Username required (1-64 chars)" }, 400);
  }

  const existing = await db.getUserByUsername(username);
  if (existing) {
    return json(
      { error: "Username already taken. Try signing in instead." },
      409,
    );
  }

  const userId = db.generateId();
  const rpId = getRpId(req);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId,
    userName: username,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const challengeId = db.generateId();
  await db.saveChallenge(
    challengeId,
    options.challenge,
    "registration",
    userId,
  );

  return json({
    options,
    challengeId,
    userId,
    username,
  });
}

// ─── WebAuthn: Registration Verify ───────────────────────────────

export async function handleRegisterVerify(req: Request): Promise<Response> {
  const { challengeId, userId, username, response } = await req.json();

  const challenge = await db.getChallenge(challengeId);
  if (!challenge || challenge.type !== "registration") {
    return json({ error: "Invalid or expired challenge" }, 400);
  }

  const rpId = getRpId(req);
  const origin = getOrigin(req);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return json({ error: "Verification failed" }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    await db.createUser(userId, username);

    await db.saveCredential({
      id: credential.id,
      userId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports as string[],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      rpId: getRpId(req),
    });

    await db.deleteChallenge(challengeId);

    const sessionId = await db.createSession(userId);

    return json({ verified: true, sessionId });
  } catch (err) {
    return json(
      { error: `Registration failed: ${(err as Error).message}` },
      400,
    );
  }
}

// ─── WebAuthn: Authentication Options ────────────────────────────

export async function handleAuthOptions(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const rpId = getRpId(req);

  let allowCredentials: {
    id: string;
    transports?: AuthenticatorTransportFuture[];
  }[] | undefined;
  if (body.username) {
    const user = await db.getUserByUsername(body.username);
    if (user) {
      const creds = await db.getCredentialsByUserId(user.id, rpId);
      allowCredentials = creds.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[] | undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "preferred",
    allowCredentials,
  });

  const challengeId = db.generateId();
  await db.saveChallenge(challengeId, options.challenge, "authentication");

  return json({ options, challengeId });
}

// ─── WebAuthn: Authentication Verify ─────────────────────────────

export async function handleAuthVerify(req: Request): Promise<Response> {
  const { challengeId, response } = await req.json();

  const challenge = await db.getChallenge(challengeId);
  if (!challenge || challenge.type !== "authentication") {
    return json({ error: "Invalid or expired challenge" }, 400);
  }

  const credential = await db.getCredentialById(response.id);
  if (!credential) {
    return json({ error: "Unknown credential" }, 400);
  }

  const rpId = getRpId(req);
  const origin = getOrigin(req);

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    });

    if (!verification.verified) {
      return json({ error: "Authentication failed" }, 400);
    }

    await db.updateCredentialCounter(
      credential.id,
      verification.authenticationInfo.newCounter,
    );
    await db.deleteChallenge(challengeId);

    const sessionId = await db.createSession(credential.userId);

    return json({ verified: true, sessionId });
  } catch (err) {
    return json({ error: `Auth failed: ${(err as Error).message}` }, 400);
  }
}
