// Railway boot: if the volume has no database yet, start from the committed demo snapshot.
import fs from "node:fs";
import path from "node:path";

const dest = process.env.DATABASE_PATH;
if (!dest || fs.existsSync(dest)) process.exit(0);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(path.join(process.cwd(), "data", "demo-snapshot.db"), dest);
console.log(`copied data/demo-snapshot.db to ${dest}`);
