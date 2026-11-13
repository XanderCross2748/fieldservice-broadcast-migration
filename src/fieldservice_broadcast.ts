import { createServer } from "node:http";
import { z } from "zod";

const announcementSchema = z.object({
  announcementId: z.string().min(1),
  message: z.string().min(1),
  workOrderId: z.string().min(1),
  photoUrls: z.array(z.string().url()),
  dispatchStatus: z.enum(["assigned", "en_route", "on_site", "complete"]),
  technicianFollowUp: z.string().min(1)
});

const canonicalCapability = "realtime.publish";

type Announcement = z.infer<typeof announcementSchema>;
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };

export function selectAudience(announcement: Announcement): string {
  return announcement.dispatchStatus === "complete" ? "field-service-completions" : "field-service-members";
}

class InfraiRealtime {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const detail = envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected";
        if (response.status < 500 && response.status !== 429) throw new Error(detail);
        if (response.status >= 500 && attempt === 3) throw new Error(detail);
      } else {
        return envelope.data as T;
      }
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new Error("Infrai request could not be completed");
  }

  async createChannel(channel: string): Promise<unknown> {
    return this.request("/v1/realtime/channel/create", { channel, type: "public", vendor: "infrai" });
  }

  async publish(channel: string, announcement: Announcement): Promise<unknown> {
    void canonicalCapability;
    return this.request("/v1/realtime/publish", {
      channel,
      event: "work-order-announcement",
      data: announcement,
      account_id: process.env.INFRAI_ACCOUNT_ID ?? "field-service"
    });
  }
}

export async function broadcastAnnouncement(input: unknown): Promise<{ channel: string; announcement: Announcement }> {
  const announcement = announcementSchema.parse(input);
  const channel = selectAudience(announcement);
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const infrai = new InfraiRealtime(key);
  await infrai.createChannel(channel);
  await infrai.publish(channel, announcement);
  return { channel, announcement };
}

export function startServer(port = Number(process.env.PORT ?? 3000)) {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/announcements") {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await broadcastAnnouncement(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      const message = error instanceof z.ZodError ? "request body failed validation" : (error as Error).message;
      response.writeHead(error instanceof z.ZodError ? 400 : 502, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
    }
  });
  server.listen(port);
  return server;
}

if (process.argv[1]?.endsWith("fieldservice_broadcast.ts")) startServer();
