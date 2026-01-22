import { query } from "./index";

(async () => {
  const result = await query("SELECT NOW()");
  console.log(result);
  process.exit(0);
})();