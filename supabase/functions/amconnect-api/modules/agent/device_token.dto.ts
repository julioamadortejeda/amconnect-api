import { z } from "zod";

export const DeviceTokenRegisterSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["android", "ios", "web"]),
});

export type DeviceTokenRegisterDTO = z.infer<typeof DeviceTokenRegisterSchema>;

export const DeviceTokenResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  token: z.string(),
  platform: z.enum(["android", "ios", "web"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DeviceTokenResponseDTO = z.infer<typeof DeviceTokenResponseSchema>;
