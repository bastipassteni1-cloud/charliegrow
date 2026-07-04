import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).end(); return; }
  const { userId } = req.body as { userId: string };
  if (!userId) { res.status(400).json({ error: "userId requerido" }); return; }

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
}
