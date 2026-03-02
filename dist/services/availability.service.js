"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableSlots = getAvailableSlots;
const db_1 = require("../db");
const SLOT_INCREMENT_MIN = 15;
const CLEANUP_BUFFER_MIN = 10;
async function getAvailableSlots(date, serviceId, addonIds = [], staffId) {
    // 1) Get service duration
    const serviceRes = await (0, db_1.query)(`SELECT duration_min FROM services WHERE id = $1`, [serviceId]);
    const service = serviceRes.rows[0];
    if (!service)
        throw new Error("Service not found");
    // 2) Get addon duration
    let addonDuration = 0;
    if (addonIds.length) {
        const addonsRes = await (0, db_1.query)(`SELECT extra_duration_min FROM addons WHERE id = ANY($1)`, [addonIds]);
        addonDuration = addonsRes.rows.reduce((sum, a) => sum + a.extra_duration_min, 0);
    }
    const totalDuration = service.duration_min + addonDuration + CLEANUP_BUFFER_MIN;
    // 3) Get staff list
    const staffList = staffId
        ? [{ id: staffId }]
        : (await (0, db_1.query)(`SELECT DISTINCT s.id
           FROM staff s
           JOIN staff_services ss ON ss.staff_id = s.id
           WHERE ss.service_id = $1 AND s.active = true`, [serviceId])).rows;
    const slots = [];
    for (const staff of staffList) {
        // 4) Get working hours
        const availabilityRes = await (0, db_1.query)(`SELECT start_time, end_time
       FROM staff_availability
       WHERE staff_id = $1
       AND day_of_week = EXTRACT(DOW FROM DATE $2)`, [staff.id, date]);
        const availability = availabilityRes.rows;
        if (!availability.length)
            continue;
        const { start_time, end_time } = availability[0];
        let cursor = new Date(`${date}T${start_time}`);
        const endOfDay = new Date(`${date}T${end_time}`);
        // 5) Existing bookings + holds
        const busyRes = await (0, db_1.query)(`SELECT start_at, end_at
       FROM appointments
       WHERE staff_id = $1
       AND status IN ('hold', 'confirmed')
       AND DATE(start_at) = DATE $2`, [staff.id, date]);
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
