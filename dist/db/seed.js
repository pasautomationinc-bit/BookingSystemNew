"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const uuid_1 = require("uuid");
(async () => {
    const tenantId = (0, uuid_1.v4)();
    const staffId = (0, uuid_1.v4)();
    const serviceId = (0, uuid_1.v4)();
    const addonId = (0, uuid_1.v4)();
    await (0, index_1.query)(`INSERT INTO tenants (id, name, timezone)
     VALUES ($1,'Demo Nail Salon','America/Toronto')`, [tenantId]);
    await (0, index_1.query)(`INSERT INTO staff (id, tenant_id, name, active)
     VALUES ($1,$2,'Anna',true)`, [staffId, tenantId]);
    await (0, index_1.query)(`INSERT INTO services (id, tenant_id, name, duration_min, price_cents)
     VALUES ($1,$2,'Gel Manicure',45,4500)`, [serviceId, tenantId]);
    await (0, index_1.query)(`INSERT INTO addons (id, tenant_id, name, extra_duration_min, extra_price_cents)
     VALUES ($1,$2,'Nail Art (Simple)',15,1000)`, [addonId, tenantId]);
    await (0, index_1.query)(`INSERT INTO staff_services (staff_id, service_id)
     VALUES ($1,$2)`, [staffId, serviceId]);
    await (0, index_1.query)(`INSERT INTO staff_availability
     (id, staff_id, day_of_week, start_time, end_time)
     VALUES ($1,$2,1,'09:00','17:00')`, [(0, uuid_1.v4)(), staffId]);
    console.log("✅ Seed data inserted");
    process.exit(0);
})();
