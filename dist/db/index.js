"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
require("dotenv/config");
const pg_1 = require("pg");
if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
}
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
async function query(text, params) {
    return exports.pool.query(text, params);
}
