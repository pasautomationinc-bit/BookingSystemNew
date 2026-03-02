"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHold = createHold;
const db_1 = require("../db");
const uuid_1 = require("uuid");
const HOLD_MINUTES = 10;
async function createHold(tenantId, staffId, startAt, endAt, totalPriceCents) {
    // Re-check overlap (safety)
    const overlaps = await (0, db_1.query)(`SELECT 1 FROM appointments
     WHERE staff_id = $1
       AND status IN ('hold', 'confirmed')
       AND tstzrange(start_at, end_at)
           && tstzrange($2, $3)
     LIMIT 1`, [staffId, startAt, endAt]);
    if ((overlaps.rowCount ?? 0) > 0) {
        throw new Error("Time slot already booked");
    }
    const appointmentId = (0, uuid_1.v4)();
    const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60000);
    await (0, db_1.query)(`INSERT INTO appointments
     (id, tenant_id, staff_id, start_at, end_at, status, hold_expires_at, total_price_cents)
     VALUES ($1,$2,$3,$4,$5,'hold',$6,$7)`, [
        appointmentId,
        tenantId,
        staffId,
        startAt,
        endAt,
        holdExpiresAt,
        totalPriceCents,
    ]);
    return {
        appointment_id: appointmentId,
        hold_expires_at: holdExpiresAt,
    };
}
