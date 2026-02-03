import { query } from "../db";
import { v4 as uuid } from "uuid";

const HOLD_MINUTES = 10;

export async function createHold(
  tenantId: string,
  staffId: string,
  startAt: Date,
  endAt: Date,
  totalPriceCents: number
) {
  // Re-check overlap (safety)
  const overlaps = await query(
    `SELECT 1 FROM appointments
     WHERE staff_id = $1
     AND status IN ('hold', 'confirmed')
     AND tstzrange(start_at, end_at)
     && tstzrange($2, $3)`,
    [staffId, startAt, endAt]
  );

  if (overlaps.length) {
    throw new Error("Time slot already booked");
  }

  const appointmentId = uuid();
  const holdExpiresAt = new Date(
    Date.now() + HOLD_MINUTES * 60000
  );

  await query(
    `INSERT INTO appointments
     (id, tenant_id, staff_id, start_at, end_at, status, hold_expires_at, total_price_cents)
     VALUES ($1,$2,$3,$4,$5,'hold',$6,$7)`,
    [
      appointmentId,
      tenantId,
      staffId,
      startAt,
      endAt,
      holdExpiresAt,
      totalPriceCents,
    ]
  );

  return {
    appointment_id: appointmentId,
    hold_expires_at: holdExpiresAt,
  };
}