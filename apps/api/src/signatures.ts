import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function verifyElevenLabsSignature(payload: unknown, signatureHeader: string | undefined): boolean {
  if ((process.env.ELEVENLABS_WEBHOOK_SKIP_VERIFY ?? "").toLowerCase() === "true") {
    return true;
  }

  if (!signatureHeader) {
    return false;
  }

  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  const digestHex = createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
  const digestBase64 = Buffer.from(digestHex, "hex").toString("base64");

  const normalizedCandidates = signatureHeader
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) {
        return [part];
      }
      return [part, part.slice(idx + 1)];
    })
    .filter(Boolean);

  return normalizedCandidates.some((candidate) => safeEqual(candidate, digestHex) || safeEqual(candidate, digestBase64));
}

export function verifyTwilioSignature(params: {
  signatureHeader: string | undefined;
  url: string;
  formBody: Record<string, unknown>;
}): boolean {
  if (!params.signatureHeader) {
    return false;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return true;
  }

  const sortedKeys = Object.keys(params.formBody).sort();
  const concatenated = sortedKeys.reduce((acc, key) => `${acc}${key}${String(params.formBody[key] ?? "")}`, params.url);
  const computed = createHmac("sha1", authToken).update(concatenated).digest("base64");
  return safeEqual(computed, params.signatureHeader);
}
