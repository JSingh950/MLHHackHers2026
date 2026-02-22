interface DispatchParams {
  userId: string;
  checkinEventId: string;
  toNumber: string;
}

interface DispatchResult {
  providerCallId: string;
}

const callProvider = (process.env.CALL_PROVIDER ?? "mock").toLowerCase();

export function getCallProviderName(): string {
  return callProvider;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function dispatchViaElevenLabs(params: DispatchParams): Promise<DispatchResult> {
  const endpoint = requireEnv("ELEVENLABS_OUTBOUND_URL");
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const agentId = requireEnv("ELEVENLABS_AGENT_ID");
  const agentPhoneNumberId = process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID;

  const body: Record<string, unknown> = {
    agent_id: agentId,
    to_number: params.toNumber,
    // Keep metadata for existing webhook processors that expect these fields.
    metadata: {
      user_id: params.userId,
      checkin_event_id: params.checkinEventId
    },
    // Also send official conversation init payload supported by ElevenLabs APIs.
    conversation_initiation_client_data: {
      dynamic_variables: {
        user_id: params.userId,
        checkin_event_id: params.checkinEventId
      }
    }
  };

  if (agentPhoneNumberId) {
    body.agent_phone_number_id = agentPhoneNumberId;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs outbound call failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const providerCallId =
    (typeof data.call_id === "string" && data.call_id) ||
    (typeof data.id === "string" && data.id) ||
    (typeof data.callSid === "string" && data.callSid) ||
    (typeof data.conversation_id === "string" && data.conversation_id) ||
    `elv-${params.checkinEventId}`;

  return { providerCallId };
}

async function dispatchViaTwilio(params: DispatchParams): Promise<DispatchResult> {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  const fromNumber = requireEnv("TWILIO_FROM_NUMBER");
  const twimlUrl = requireEnv("TWILIO_TWIML_URL");

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
  const body = new URLSearchParams({
    To: params.toNumber,
    From: fromNumber,
    Url: twimlUrl,
    StatusCallback: process.env.TWILIO_STATUS_CALLBACK_URL ?? "",
    StatusCallbackMethod: "POST"
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio call failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { sid?: string };
  return { providerCallId: data.sid ?? `twilio-${params.checkinEventId}` };
}

function dispatchMock(params: DispatchParams): DispatchResult {
  return {
    providerCallId: `mock-${params.checkinEventId}`
  };
}

export async function dispatchOutboundCall(params: DispatchParams): Promise<DispatchResult> {
  if (callProvider === "elevenlabs") {
    return dispatchViaElevenLabs(params);
  }

  if (callProvider === "twilio") {
    return dispatchViaTwilio(params);
  }

  return dispatchMock(params);
}
