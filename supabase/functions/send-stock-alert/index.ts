import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, products, date } = await req.json() as {
      email: string;
      products: { nombre: string; stock: number; stockMinimo: number; unidadMedida: string }[];
      date: string;
    };

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY no configurada");

    const rows = products
      .map(p => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600">${p.nombre}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#ef4444;font-weight:700;text-align:center">${p.stock} ${p.unidadMedida}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;text-align:center">${p.stockMinimo} ${p.unidadMedida}</td>
      </tr>`)
      .join("");

    const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:#4f46e5;padding:24px 32px">
      <p style="margin:0;font-size:24px">🏪</p>
      <h1 style="color:white;margin:8px 0 0;font-size:20px">Stock bajo en tu negocio</h1>
      <p style="color:#c7d2fe;margin:4px 0 0;font-size:13px">${date}</p>
    </div>
    <div style="padding:24px 32px">
      <p style="color:#475569;margin:0 0 16px">Los siguientes productos están por debajo del stock mínimo:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:8px 12px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Producto</th>
            <th style="padding:8px 12px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Stock actual</th>
            <th style="padding:8px 12px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Mínimo</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0">Recibiste este aviso porque activaste las alertas de stock en tu app.</p>
    </div>
  </div>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Alertas Stock <onboarding@resend.dev>",
        to: [email],
        subject: `⚠️ Stock bajo — ${products.length} producto${products.length !== 1 ? "s" : ""} por reponer`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error: ${err}`);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
