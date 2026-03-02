"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const index_1 = require("./index");
console.log("DB URL:", process.env.DATABASE_URL);
(async () => {
    const result = await (0, index_1.query)("SELECT NOW()");
    console.log("✅ DB time:", result);
    process.exit(0);
})();
