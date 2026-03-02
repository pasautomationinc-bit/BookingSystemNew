import { query } from "../db";

const SLOT_INCREMENT_MIN = 15;
const CLEANUP_BUFFER_MIN = 10;

type Slot = {
  staff_id: string;
  start_at: Date;
  end_at: Date;
};

export async function getAvailableSlots(
  date: string,
  serviceId: string,
  addonIds: string[] = [],
  staffId?: string
): Promise<Slot[]> {
  // 1) Get service duration
  const serviceRes = await query<{ duration_min: number }>(
    `SELECT duration_min FROM services WHERE id = $1`,
    [serviceId]
  );

  const service = serviceRes.rows[0];
  if (!service) throw new Error("Service not found");

  // 2) Get addon duration
  let addonDuration = 0;

  if (addonIds.length) {
    const addonsRes = await query<{ extra_duration_min: number }>(
      `SELECT extra_duration_min FROM addons WHERE id = ANY($1)`,
      [addonIds]
    );

    addonDuration = addonsRes.rows.reduce(
      (sum: number, a: { extra_duration_min: number }) => sum + a.extra_duration_min,
      0
    );
  }

  const totalDuration =
    service.duration_min + addonDuration + CLEANUP_BUFFER_MIN;

  // 3) Get staff list
  const staffList: { id: string }[] = staffId
    ? [{ id: staffId }]
    : (
        await query<{ id: string }>(
          `SELECT DISTINCT s.id
           FROM staff s
           JOIN staff_services ss ON ss.staff_id = s.id
           WHERE ss.service_id = $1 AND s.active = true`,
          [serviceId]
        )
      ).rows;

  const slots: Slot[] = [];

  for (const staff of staffList) {
    // 4) Get working hours
    const availabilityRes = await query<{
      start_time: string;
      end_time: string;
    }>(
      `SELECT start_time, end_time
       FROM staff_availability
       WHERE staff_id = $1
       AND day_of_week = EXTRACT(DOW FROM DATE $2)`,
      [staff.id, date]
    );

    const availability = availabilityRes.rows;
    if (!availability.length) continue;

    const { start_time, end_time } = availability[0];

    let cursor = new Date(`${date}T${start_time}`);
    const endOfDay = new Date(`${date}T${end_time}`);

    // 5) Existing bookings + holds
    const busyRes = await query<{
      start_at: Date;
      end_at: Date;
    }>(
      `SELECT start_at, end_at
       FROM appointments
       WHERE staff_id = $1
       AND status IN ('hold', 'confirmed')
       AND DATE(start_at) = DATE $2`,
      [staff.id, date]
    );

    const busy = busyRes.rows;

    while (cursor.getTime() + totalDuration * 60000 <= endOfDay.getTime()) {
      const slotEnd = new Date(cursor.getTime() + totalDuration * 60000);

      const overlaps = busy.some((b) => {
        const busyStart = new Date(b.start_at);
        const busyEnd = new Date(b.end_at);
        return cursor < busyEnd && slotEnd > busyStart;
      });

      if (!overlaps) {
        slots.push({
          staff_id: staff.id,
          start_at: new Date(cursor),
          end_at: slotEnd,
        });
      }

      cursor = new Date(cursor.getTime() + SLOT_INCREMENT_MIN * 60000);
    }
  }

  return slots;
}