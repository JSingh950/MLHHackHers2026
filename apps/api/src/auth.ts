import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 3600);
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
const TOKEN_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";
const TOKEN_ISSUER = process.env.JWT_ISSUER ?? "goalcoach-api";

interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: "access";
  iat: number;
  exp: number;
  iss: string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signValue(value: string): string {
  return createHmac("sha256", TOKEN_SECRET).update(value).digest("base64url");
}

function safeEqualText(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function getAccessTokenTtlSeconds(): number {
  return ACCESS_TOKEN_TTL_SECONDS;
}

export function getRefreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith("scrypt$")) {
    // Temporary compatibility for legacy seed/dev data.
    return password === hash;
  }

  const [, salt, expectedHex] = hash.split("$");
  if (!salt || !expectedHex) {
    return false;
  }

  const derived = scryptSync(password, salt, 64).toString("hex");
  return safeEqualText(derived, expectedHex);
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHmac("sha256", TOKEN_SECRET).update(token).digest("hex");
}

export function signAccessToken(params: { userId: string; sessionId: string }): string {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayload = {
    sub: params.userId,
    sid: params.sessionId,
    typ: "access",
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    iss: TOKEN_ISSUER
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = signValue(signingInput);

  return `${signingInput}.${signature}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, providedSignature] = segments;
  const expectedSignature = signValue(`${encodedHeader}.${encodedPayload}`);
  if (!safeEqualText(expectedSignature, providedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AccessTokenPayload;

    if (payload.typ !== "access" || payload.iss !== TOKEN_ISSUER || !payload.sub || !payload.sid) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
