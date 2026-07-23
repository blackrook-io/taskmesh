import "dotenv/config";
import { runBackup } from "../services/backups.js";

const manifest = await runBackup();
console.log(JSON.stringify(manifest, null, 2));
process.exit(manifest.pgDumpOk ? 0 : 1);
