/**
 * One-off Excel migration importer (PRD §6).
 *
 * Usage: node dist/importExcel.js <parsed.json> [--replace]
 *
 * Input JSON: { items: [{ item_no, description, specification, model, supplier,
 *   department, location, stock_balance, currency, unit_price, comments,
 *   transactions: [{ purpose, qty, date|null }] }] }   (row/column order preserved)
 *
 * --replace wipes the target project's items/ledger/stock first (for replacing
 * seed/demo data). Users, projects, sites, locations, settings are never touched.
 *
 * Each "Purpose & Date / Qty Change" pair becomes one ledger row: the first
 * entry mentioning "initial" becomes an `opening`, otherwise sign decides
 * receipt/issue. Unparseable dates carry the item's last seen date forward
 * (base 2018-01-01) and keep column order via minute offsets. After replay,
 * any difference vs the Excel "Stock Balance" cell gets a reconciliation
 * `adjustment`, and the item is listed in the final report.
 */
import { readFileSync } from 'node:fs';
import { pool } from './db.js';

interface XTxn { purpose: string; qty: number; date: string | null }
interface XItem {
  item_no: string; description: string; specification: string | null; model: string | null;
  supplier: string | null; department: string | null; location: string | null;
  stock_balance: number | null; currency: string | null; unit_price: number | null;
  comments: string | null; transactions: XTxn[];
}

const SITE_CODE = process.env.IMPORT_SITE_CODE ?? 'CNW';
const PROJECT_CODE = process.env.IMPORT_PROJECT_CODE ?? 'MAINT-CNW';
const FALLBACK_LOCATION = 'UNSPECIFIED';

async function main() {
  const jsonPath = process.argv[2];
  const replace = process.argv.includes('--replace');
  if (!jsonPath) {
    console.error('usage: node dist/importExcel.js <parsed.json> [--replace]');
    process.exit(1);
  }
  const { items } = JSON.parse(readFileSync(jsonPath, 'utf8')) as { items: XItem[] };
  console.log(`loaded ${items.length} items from ${jsonPath}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const org = (await client.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)).rows[0];
    const site = (await client.query(`SELECT id FROM sites WHERE org_id=$1 AND code=$2`, [org.id, SITE_CODE])).rows[0];
    const project = (await client.query(`SELECT id FROM projects WHERE site_id=$1 AND code=$2`, [site.id, PROJECT_CODE])).rows[0];
    const admin = (await client.query(`SELECT id FROM users WHERE org_id=$1 AND username='admin'`, [org.id])).rows[0];
    if (!org || !site || !project || !admin) throw new Error('org/site/project/admin not found');

    if (replace) {
      const counts = await client.query(
        `SELECT (SELECT count(*) FROM items WHERE project_id=$1) items,
                (SELECT count(*) FROM stock_transactions WHERE project_id=$1) txns`,
        [project.id]
      );
      console.log(`--replace: removing ${counts.rows[0].items} items / ${counts.rows[0].txns} transactions from project`);
      await client.query(`DELETE FROM custom_field_values WHERE item_id IN (SELECT id FROM items WHERE project_id=$1)`, [project.id]);
      await client.query(`DELETE FROM item_suppliers WHERE item_id IN (SELECT id FROM items WHERE project_id=$1)`, [project.id]);
      await client.query(`DELETE FROM attachments WHERE item_id IN (SELECT id FROM items WHERE project_id=$1)`, [project.id]);
      await client.query(`DELETE FROM stock_transactions WHERE project_id=$1`, [project.id]);
      await client.query(`DELETE FROM stock_levels WHERE item_id IN (SELECT id FROM items WHERE project_id=$1)`, [project.id]);
      await client.query(`DELETE FROM purchase_order_lines WHERE item_id IN (SELECT id FROM items WHERE project_id=$1)`, [project.id]);
      await client.query(`DELETE FROM items WHERE project_id=$1`, [project.id]);
    }

    // Currencies
    const currencies = new Set(items.map((i) => i.currency).filter(Boolean) as string[]);
    for (const code of currencies) {
      await client.query(
        `INSERT INTO currencies (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, [code, code]
      );
    }

    // Suppliers
    const supplierIds = new Map<string, string>();
    for (const name of new Set(items.map((i) => i.supplier).filter(Boolean) as string[])) {
      const r = await client.query(
        `INSERT INTO suppliers (org_id, name) VALUES ($1, $2)
         ON CONFLICT (org_id, name) DO UPDATE SET updated_at = now() RETURNING id`,
        [org.id, name]
      );
      supplierIds.set(name, r.rows[0].id);
    }

    // Locations (+ fallback for items without one)
    const locationIds = new Map<string, string>();
    const locationCodes = new Set(items.map((i) => i.location).filter(Boolean) as string[]);
    locationCodes.add(FALLBACK_LOCATION);
    for (const code of locationCodes) {
      const r = await client.query(
        `INSERT INTO locations (site_id, code, name) VALUES ($1, $2, $2)
         ON CONFLICT (site_id, code) DO UPDATE SET name = locations.name RETURNING id`,
        [site.id, code]
      );
      locationIds.set(code, r.rows[0].id);
    }
    console.log(`upserted ${supplierIds.size} suppliers, ${locationIds.size} locations, ${currencies.size} currencies`);

    // Items + ledger
    const seenNos = new Map<string, number>();
    const mismatches: { item_no: string; excel: number; ledger: number }[] = [];
    let itemCount = 0, txnCount = 0, dupCount = 0;

    for (const it of items) {
      let itemNo = it.item_no;
      let comments = it.comments;
      const n = (seenNos.get(itemNo) ?? 0) + 1;
      seenNos.set(itemNo, n);
      if (n > 1) {
        itemNo = `${it.item_no}-DUP${n}`;
        comments = `[duplicate item no in source Excel] ${comments ?? ''}`.trim();
        dupCount++;
      }
      const locId = locationIds.get(it.location ?? FALLBACK_LOCATION) ?? locationIds.get(FALLBACK_LOCATION)!;

      const inserted = await client.query(
        `INSERT INTO items (project_id, item_no, description, specification, model, supplier_id,
                            department, default_location_id, unit_price, currency, barcode, comments, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$2,$11,$12) RETURNING id`,
        [project.id, itemNo, it.description, it.specification, it.model,
         it.supplier ? supplierIds.get(it.supplier) : null, it.department, locId,
         it.unit_price, it.currency, comments, admin.id]
      );
      const itemId = inserted.rows[0].id;
      itemCount++;

      let lastDate = '2018-01-01';
      let ledgerSum = 0;
      for (const [idx, t] of it.transactions.entries()) {
        if (t.date) lastDate = t.date;
        const performedAt = new Date(Date.parse(`${lastDate}T08:00:00Z`) + idx * 60_000).toISOString();
        const isOpening = idx === 0 && /initial/i.test(t.purpose) && t.qty > 0;
        const type = isOpening ? 'opening' : t.qty > 0 ? 'receipt' : 'issue';
        await client.query(
          `INSERT INTO stock_transactions (project_id, item_id, type, quantity_delta,
                                           from_location_id, to_location_id, unit_price, currency,
                                           purpose, performed_by, performed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [project.id, itemId, type, t.qty,
           t.qty < 0 ? locId : null, t.qty > 0 ? locId : null,
           it.unit_price, it.currency,
           `${t.purpose}${t.date ? '' : ' [date not parsed]'}`.trim(), admin.id, performedAt]
        );
        ledgerSum += t.qty;
        txnCount++;
      }

      // Reconciliation vs the Excel "Stock Balance" cell
      if (it.stock_balance !== null && Math.abs(ledgerSum - it.stock_balance) > 0.001) {
        const diff = it.stock_balance - ledgerSum;
        await client.query(
          `INSERT INTO stock_transactions (project_id, item_id, type, quantity_delta, to_location_id,
                                           purpose, performed_by, performed_at)
           VALUES ($1,$2,'adjustment',$3,$4,'Reconciliation: Excel stock balance differs from transaction history',$5,now())`,
          [project.id, itemId, diff, locId, admin.id]
        );
        mismatches.push({ item_no: itemNo, excel: it.stock_balance, ledger: ledgerSum });
        txnCount++;
      }

      if (itemCount % 1000 === 0) console.log(`  ${itemCount} items, ${txnCount} transactions...`);
    }

    await client.query('COMMIT');
    console.log(`\nIMPORT COMPLETE`);
    console.log(`  items:        ${itemCount} (${dupCount} duplicate item-nos suffixed)`);
    console.log(`  transactions: ${txnCount}`);
    console.log(`  reconciliation adjustments: ${mismatches.length}`);
    for (const m of mismatches.slice(0, 30)) {
      console.log(`    ${m.item_no}: excel=${m.excel} ledger=${m.ledger}`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
