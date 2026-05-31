import { z } from 'zod';

export const ChatBody = z.object({
  // Accept canonical UUID v1-5 or a generic hex-ish session id (>=32 hex chars + optional dashes).
  uuid: z
    .string()
    .uuid()
    .or(z.string().regex(/^[a-f0-9-]{32,}$/i, 'invalid uuid')),
  prompt: z.string().min(1),
  projectName: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
});

export type ChatBody = z.infer<typeof ChatBody>;
