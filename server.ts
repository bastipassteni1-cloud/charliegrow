import express from "express";
import https from "node:https";
import net from "net";
import os from "os";
import fs from "node:fs";
import path from "path";
import { join } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { createServer as createViteServer } from "vite";
const HTTPS_PORT = 3443;

const app = express();
const HOST = process.env.HOST || "0.0.0.0";
let PORT = Number(process.env.PORT || 3000);

function getAvailablePort(startPort: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(getAvailablePort(startPort + 1, host));
        return;
      }

      reject(error);
    });

    server.listen(startPort, host, () => {
      server.close(() => resolve(startPort));
    });
  });
}

function getNetworkUrl(port: number) {
  const interfaces = os.networkInterfaces();
  for (const details of Object.values(interfaces)) {
    for (const entry of details || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return `http://${entry.address}:${port}`;
      }
    }
  }
  return `http://localhost:${port}`;
}

function getNetworkIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const details of Object.values(interfaces)) {
    for (const entry of details || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

function tryStartHttps(expressApp: express.Application) {
  const ip = getNetworkIp() || "127.0.0.1";
  const certDir  = join(os.tmpdir(), "negocio-dev-ssl");
  const certFile = join(certDir, "cert.pem");
  const keyFile  = join(certDir, "key.pem");

  try {
    fs.mkdirSync(certDir, { recursive: true });

    // 1. Intenta mkcert (genera certs confiados → sin advertencias en el navegador)
    let usedMkcert = false;
    try {
      execSync("mkcert -version", { stdio: "ignore" });
      execSync(
        `mkcert -cert-file "${certFile}" -key-file "${keyFile}" ${ip} localhost 127.0.0.1`,
        { stdio: "ignore" }
      );
      usedMkcert = true;
    } catch { /* mkcert no instalado */ }

    // 2. Fallback: openssl con SAN para el IP actual
    if (!usedMkcert) {
      // Forzar regeneración si el cert no incluye el IP (cert anterior puede ser inválido)
      const needsRegen = !fs.existsSync(certFile) || (() => {
        try {
          const pem = fs.readFileSync(certFile, "utf-8");
          return !pem.includes(ip); // Regenerar si el IP cambió
        } catch { return true; }
      })();

      if (needsRegen) {
        const san = `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`;
        execSync(
          `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" ` +
          `-days 365 -nodes -subj "/CN=${ip}" -addext "${san}"`,
          { stdio: "ignore" }
        );
      }
    }

    const creds = { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    https.createServer(creds, expressApp).listen(HTTPS_PORT, HOST, () => {
      console.log(`\n📷  HTTPS listo en: https://localhost:${HTTPS_PORT}`);
      if (ip !== "127.0.0.1") {
        console.log(`📱  Red (celular):   https://${ip}:${HTTPS_PORT}`);
      }
      if (!usedMkcert) {
        console.log(`\n   ⚠️  Certificado autofirmado: el navegador mostrará advertencia.`);
        console.log(`   → Haz clic en "Opciones avanzadas" → "Continuar a ${ip} (no seguro)"\n`);
        console.log(`   💡 Para eliminar la advertencia para siempre:`);
        console.log(`      brew install mkcert && mkcert -install`);
        console.log(`      (luego reinicia el servidor)\n`);
      } else {
        console.log(`✅  Certificado confiado (mkcert) — sin advertencias en el navegador.\n`);
      }
    });
  } catch (e) {
    console.log("ℹ️  HTTPS no disponible — la cámara solo funciona en localhost.");
    console.log("   Instala openssl o mkcert para habilitar HTTPS en red local.\n");
  }
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Auto-confirma email de usuario recién registrado
app.post("/api/confirm-user", async (req, res) => {
  const { userId } = req.body as { userId: string };
  if (!userId) { res.status(400).json({ error: "userId requerido" }); return; }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// --- Impresión de etiquetas TSPL2 directa (DINON 9385 / 4BARCODE 4B-2054A) ---
// Rollo 108mm, 3 columnas de ~33mm, gap ~3mm entre columnas
// Posiciones X en dots (203 DPI = 8 dots/mm): col1=24, col2=312, col3=600
const IS_WINDOWS = process.platform === "win32";
// En Windows: nombre exacto de la impresora en Panel de control → Dispositivos
// En Mac:     nombre de la cola CUPS (lpadmin -p ...)
const LABEL_PRINTER_WIN = "Charlie Grow Etiquetas";
const LABEL_PRINTER_MAC = "Charlie_Grow_Labels";
const COL_X = [24, 312, 600]; // dots desde borde izquierdo del rollo

app.post("/api/print-label", (req, res) => {
  const { code, name, qty } = req.body as { code: string; name: string; qty: number };
  if (!code) return res.status(400).json({ error: "Código requerido" });

  const safeCode = code.replace(/[^A-Za-z0-9\-]/g, "").substring(0, 20);
  const safeName = (name || "").replace(/"/g, "'").substring(0, 22);
  const count = Math.max(1, Math.min(20, Number(qty) || 1));

  const rows: number[][] = [];
  for (let i = 0; i < count; i += 3) {
    rows.push(COL_X.slice(0, Math.min(count - i, 3)));
  }

  const lines: string[] = ["SIZE 108 mm, 30 mm", "GAP 3 mm, 0", "DIRECTION 0"];
  for (const rowCols of rows) {
    lines.push("CLS");
    for (const x of rowCols) {
      if (safeName) lines.push(`TEXT ${x + 8},6,"2",0,1,1,"${safeName}"`);
      lines.push(`BARCODE ${x + 4},${safeName ? 30 : 20},"CODE128",100,1,0,2,4,"${safeCode}"`);
    }
    lines.push("PRINT 1,1");
  }

  const tspl = lines.join("\r\n") + "\r\n";
  const tmpFile = path.join(os.tmpdir(), `label_${Date.now()}.tspl`);

  try {
    fs.writeFileSync(tmpFile, tspl, "binary");

    if (IS_WINDOWS) {
      // Windows: copia raw al puerto de la impresora (requiere driver TSC instalado)
      execSync(`copy /B "${tmpFile}" "\\\\localhost\\${LABEL_PRINTER_WIN}"`, { shell: "cmd.exe" });
    } else {
      // macOS / Linux: lp raw via CUPS
      execFileSync("lp", ["-d", LABEL_PRINTER_MAC, "-o", "raw", tmpFile]);
    }

    fs.unlinkSync(tmpFile);
    res.json({ ok: true, rows: rows.length });
  } catch (err: any) {
    try { fs.unlinkSync(tmpFile); } catch { /* ya borrado */ }
    console.error("[print-label]", err.message);
    res.status(500).json({ error: err.message || "Error al imprimir" });
  }
});

// Setup Vite Development Server or Static Serving
async function startServer() {
  PORT = await getAvailablePort(Number(process.env.PORT || 3000), HOST);

  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: {
        host: HOST,
        port: PORT,
        strictPort: false,
        middlewareMode: true,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
    console.log(`Network URL: ${getNetworkUrl(PORT)}`);
  });

  tryStartHttps(app);
}

startServer();
