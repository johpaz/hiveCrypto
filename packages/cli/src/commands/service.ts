import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const HOME = process.env.HOME || "";
const SYSTEMD_DIR = path.join(HOME, ".config", "systemd", "user");

export async function installService(): Promise<void> {
  console.log("🔧 Instalando servicio systemd para Hive...\n");

  if (!fs.existsSync(SYSTEMD_DIR)) {
    fs.mkdirSync(SYSTEMD_DIR, { recursive: true });
  }

  const serviceContent = `[Unit]
Description=hiveCrypto Personal AI Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${HOME}/.bun/bin/hivecrypto start
ExecStop=${HOME}/.bun/bin/hivecrypto stop
Restart=on-failure
RestartSec=5
Environment=PATH=${HOME}/.bun/bin:${HOME}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=${HOME}

[Install]
WantedBy=default.target
`;

  const servicePath = path.join(SYSTEMD_DIR, "hivecrypto.service");

  fs.writeFileSync(servicePath, serviceContent, "utf-8");
  console.log(`✅ Archivo de servicio creado: ${servicePath}\n`);

  console.log("Recargando systemd...");
  execSync("systemctl --user daemon-reload", { stdio: "inherit" });

  console.log("Habilitando servicio...");
  execSync("systemctl --user enable hivecrypto", { stdio: "inherit" });

  console.log("\n✅ Servicio instalado correctamente.\n");
  console.log("Comandos disponibles:");
  console.log("  systemctl --user start hivecrypto    # Iniciar");
  console.log("  systemctl --user stop hivecrypto     # Detener");
  console.log("  systemctl --user status hivecrypto   # Ver estado");
  console.log("  journalctl --user -u hive -f   # Ver logs");
}
