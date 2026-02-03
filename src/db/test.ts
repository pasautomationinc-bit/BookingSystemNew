import "dotenv/config";
import { query } from "./index";

console.log("DB URL:", process.env.DATABASE_URL);

(async () => {
  const result = await query("SELECT NOW()");
  console.log("✅ DB time:", result);
  process.exit(0);
})();