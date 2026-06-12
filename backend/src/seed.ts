import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './db.js';
import { config } from './config.js';

// Idempotent demo seed: org, currencies/FX, site CNW, project Maintenance-CNW,
// locations, categories, suppliers, users, custom fields, items + ledger history.
async function seed() {
  const existing = await pool.query(`SELECT id FROM organizations LIMIT 1`);
  if (existing.rows[0]) {
    console.log('Database already seeded — skipping.');
    await pool.end();
    return;
  }

  await withTransaction(async (c) => {
    const org = (
      await c.query(
        `INSERT INTO organizations (name, base_currency) VALUES ('Bamboo Industries', 'USD') RETURNING id`
      )
    ).rows[0];

    await c.query(`INSERT INTO currencies (code, name, symbol) VALUES
      ('USD','US Dollar','$'), ('EUR','Euro','€'), ('SGD','Singapore Dollar','S$'),
      ('JPY','Japanese Yen','¥'), ('CNY','Chinese Yuan','¥')`);

    const fx: [string, string, number][] = [
      ['SGD', 'USD', 0.74], ['EUR', 'USD', 1.08], ['JPY', 'USD', 0.0064], ['CNY', 'USD', 0.14],
      ['SGD', 'EUR', 0.685], ['USD', 'EUR', 0.926],
    ];
    for (const [from, to, rate] of fx) {
      await c.query(
        `INSERT INTO exchange_rates (org_id, from_currency, to_currency, rate, effective_date)
         VALUES ($1,$2,$3,$4,'2026-06-01')`,
        [org.id, from, to, rate]
      );
    }

    const site = (
      await c.query(
        `INSERT INTO sites (org_id, code, name, address) VALUES ($1,'CNW','CNW Plant','Singapore') RETURNING id`,
        [org.id]
      )
    ).rows[0];

    const project = (
      await c.query(
        `INSERT INTO projects (site_id, code, name, description)
         VALUES ($1,'MAINT-CNW','Maintenance-CNW','Maintenance spare part inventory') RETURNING id`,
        [site.id]
      )
    ).rows[0];

    const locCodes = ['CNW L/L R1A', 'CNW L/L R1B', 'CNW L/L R1C', 'CNW L/L R1D'];
    const locs: Record<string, string> = {};
    for (const code of locCodes) {
      const row = (
        await c.query(`INSERT INTO locations (site_id, code, name) VALUES ($1,$2,$2) RETURNING id`, [site.id, code])
      ).rows[0];
      locs[code] = row.id;
    }

    const catNames = ['Solenoid Valves', 'Transmitters', 'Sensors', 'Breakers'];
    const cats: Record<string, string> = {};
    for (const name of catNames) {
      const row = (
        await c.query(`INSERT INTO categories (org_id, name) VALUES ($1,$2) RETURNING id`, [org.id, name])
      ).rows[0];
      cats[name] = row.id;
    }

    const supplierRows: [string, number | null, string][] = [
      ['Burkert', 14, 'SGD'], ['VEGA', 21, 'SGD'], ['Norgren', 14, 'EUR'], ['Schneider', 7, 'SGD'],
    ];
    const sups: Record<string, string> = {};
    for (const [name, lead, currency] of supplierRows) {
      const row = (
        await c.query(
          `INSERT INTO suppliers (org_id, name, lead_time_days, currency) VALUES ($1,$2,$3,$4) RETURNING id`,
          [org.id, name, lead, currency]
        )
      ).rows[0];
      sups[name] = row.id;
    }

    const hash = (pw: string) => bcrypt.hash(pw, config.saltRounds);
    const addUser = async (username: string, fullName: string, pw: string, isAdmin = false) =>
      (
        await c.query(
          `INSERT INTO users (org_id, username, email, full_name, password_hash, is_org_admin)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [org.id, username, `${username}@ims.local`, fullName, await hash(pw), isAdmin]
        )
      ).rows[0];

    const admin = await addUser('admin', 'Samuel (Admin)', 'admin123', true);
    const manager = await addUser('manager', 'Mahesh (Manager)', 'manager123');
    const tech = await addUser('tech', 'Sara (Technician)', 'tech123');
    const auditor = await addUser('audit', 'Auditor (Viewer)', 'audit123');
    await c.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES
       ($1,$2,'manager'), ($1,$3,'technician'), ($1,$4,'viewer')`,
      [project.id, manager.id, tech.id, auditor.id]
    );

    // Custom fields on Solenoid Valves (FR-4.x)
    const voltageField = (
      await c.query(
        `INSERT INTO custom_field_defs (org_id, category_id, key, label, type, sort_order, help_text)
         VALUES ($1,$2,'voltage','Voltage','select',1,'Operating voltage') RETURNING id`,
        [org.id, cats['Solenoid Valves']]
      )
    ).rows[0];
    for (const [i, v] of ['24V', '110V', '230V'].entries()) {
      await c.query(
        `INSERT INTO custom_field_options (field_id, value, label, sort_order) VALUES ($1,$2,$2,$3)`,
        [voltageField.id, v, i]
      );
    }
    await c.query(
      `INSERT INTO custom_field_defs (org_id, category_id, key, label, type, sort_order, help_text)
       VALUES ($1,$2,'wattage','Wattage (W)','number',2,'Rated power in watts')`,
      [org.id, cats['Solenoid Valves']]
    );

    // Items from the workbook examples in the docs
    const items: {
      no: string; desc: string; spec?: string; model?: string; sup: string; cat: string;
      loc: string; price: number; cur: string; reorder: number; max?: number; abc: 'A' | 'B' | 'C';
      custom?: any; opening: number;
    }[] = [
      { no: 'C4100050001', desc: 'SOLENOID VALVE', spec: 'v=24 HZ=8W Rated ED 100% Norgren', model: '00125660',
        sup: 'Burkert', cat: 'Solenoid Valves', loc: 'CNW L/L R1D', price: 240, cur: 'SGD', reorder: 1, max: 4,
        abc: 'B', custom: { voltage: '24V', wattage: 8 }, opening: 3 },
      { no: 'C4100050008', desc: 'Pressure Transmitter', spec: '0-10Bar', model: 'BR52.XXGSWGZKMAS',
        sup: 'VEGA', cat: 'Transmitters', loc: 'CNW L/L R1C', price: 1673, cur: 'SGD', reorder: 1, max: 4,
        abc: 'A', opening: 2 },
      { no: 'C4100050009', desc: 'Pressure Transmitter 0.1Bar', spec: '0-0.1Bar', model: 'BR52.XXGSWGZKMAS',
        sup: 'VEGA', cat: 'Transmitters', loc: 'CNW L/L R1C', price: 1673, cur: 'SGD', reorder: 1,
        abc: 'A', opening: 1 },
      { no: 'C4100050021', desc: 'Circuit Breaker D20', spec: '20A curve D', model: 'iC60N-D20',
        sup: 'Schneider', cat: 'Breakers', loc: 'CNW L/L R1A', price: 85, cur: 'SGD', reorder: 2, max: 8,
        abc: 'C', opening: 2 },
      { no: 'C4100050032', desc: 'Proximity Sensor M12', spec: 'PNP NO 2mm', model: 'XS612B1PAL2',
        sup: 'Schneider', cat: 'Sensors', loc: 'CNW L/L R1B', price: 132, cur: 'SGD', reorder: 2, max: 6,
        abc: 'C', opening: 4 },
      { no: 'C4100050040', desc: 'SOLENOID VALVE 230V', spec: '230V 50Hz G1/4', model: '6213EV',
        sup: 'Norgren', cat: 'Solenoid Valves', loc: 'CNW L/L R1D', price: 198, cur: 'EUR', reorder: 1, max: 3,
        abc: 'B', custom: { voltage: '230V', wattage: 10 }, opening: 2 },
    ];

    const itemIds: Record<string, string> = {};
    for (const it of items) {
      const row = (
        await c.query(
          `INSERT INTO items (project_id, category_id, item_no, description, specification, model,
                              supplier_id, department, default_location_id, unit_price, currency,
                              reorder_level, max_level, abc_class, barcode, custom, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Maintenance',$8,$9,$10,$11,$12,$13,$3,$14,$15) RETURNING id`,
          [project.id, cats[it.cat], it.no, it.desc, it.spec ?? null, it.model ?? null, sups[it.sup],
           locs[it.loc], it.price, it.cur, it.reorder, it.max ?? null, it.abc,
           JSON.stringify(it.custom ?? {}), admin.id]
        )
      ).rows[0];
      itemIds[it.no] = row.id;

      // EAV mirror for custom values
      if (it.custom?.voltage) {
        await c.query(
          `INSERT INTO custom_field_values (item_id, field_id, value_text) VALUES ($1,$2,$3)`,
          [row.id, voltageField.id, it.custom.voltage]
        );
      }

      await c.query(
        `INSERT INTO stock_transactions (project_id, item_id, type, quantity_delta, to_location_id,
                                         unit_price, currency, purpose, performed_by, performed_at)
         VALUES ($1,$2,'opening',$3,$4,$5,$6,'Initial stock (Excel migration)',$7,'2024-01-15T08:00:00Z')`,
        [project.id, row.id, it.opening, locs[it.loc], it.price, it.cur, admin.id]
      );
    }

    // A few historical movements (mirrors the "Purpose & Date / Qty Change" pairs)
    const movements: [string, string, number, string, string, string, string][] = [
      // item_no, type, qty(delta), location, purpose, reference, performed_at
      ['C4100050001', 'issue', -1, 'CNW L/L R1D', 'Replaced on CM8G blower', 'WO-8842', '2025-11-03T09:30:00Z'],
      ['C4100050008', 'issue', -1, 'CNW L/L R1C', 'Sara update — line 2 swap', 'WO-9120', '2026-02-12T14:00:00Z'],
      ['C4100050008', 'receipt', 1, 'CNW L/L R1C', 'PO-2026-014 received', 'PO-2026-014', '2026-04-20T10:00:00Z'],
      ['C4100050009', 'issue', -1, 'CNW L/L R1C', 'Calibration spare used', 'WO-9255', '2026-05-30T11:15:00Z'],
      ['C4100050021', 'issue', -1, 'CNW L/L R1A', 'Tripped breaker replacement', 'WO-9301', '2026-06-05T08:45:00Z'],
    ];
    for (const [no, type, delta, loc, purpose, ref, at] of movements) {
      await c.query(
        `INSERT INTO stock_transactions (project_id, item_id, type, quantity_delta,
                                         ${delta < 0 ? 'from_location_id' : 'to_location_id'},
                                         purpose, reference, performed_by, performed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [project.id, itemIds[no], type, delta, locs[loc], purpose, ref, tech.id, at]
      );
    }
  });

  console.log('Seed complete.');
  console.log('  admin   / admin123   (org admin)');
  console.log('  manager / manager123 (project manager)');
  console.log('  tech    / tech123    (technician)');
  console.log('  audit   / audit123   (viewer)');
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
