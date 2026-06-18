import express from "express";
import https from "node:https";
import net from "net";
import os from "os";
import fs from "node:fs";
import path from "path";
import { join } from "node:path";
import { execSync } from "node:child_process";
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
