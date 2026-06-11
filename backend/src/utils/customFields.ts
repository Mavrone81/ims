import type pg from 'pg';
import { badRequest } from '../errors.js';

export interface FieldDef {
  id: string;
  category_id: string | null;
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect';
  is_required: boolean;
  options?: { value: string; label: string }[];
}

/** Field defs applicable to a category (category-specific + org-wide). */
export async function fieldDefsForCategory(
  client: pg.PoolClient | pg.Pool,
  orgId: string,
  categoryId: string | null
): Promise<FieldDef[]> {
  const { rows } = await client.query(
    `SELECT d.id, d.category_id, d.key, d.label, d.type, d.is_required,
            COALESCE(json_agg(json_build_object('value', o.value, 'label', o.label) ORDER BY o.sort_order)
                     FILTER (WHERE o.id IS NOT NULL), '[]') AS options
     FROM custom_field_defs d
     LEFT JOIN custom_field_options o ON o.field_id = d.id
     WHERE d.org_id = $1 AND d.deleted_at IS NULL
       AND (d.category_id IS NULL OR d.category_id = $2)
     GROUP BY d.id ORDER BY d.sort_order`,
    [orgId, categoryId]
  );
  return rows;
}

/**
 * Validate `custom` payload against defs, then write typed EAV rows and return
 * the JSONB mirror to store on items.custom (see docs/02_DATABASE.md §3.7).
 */
export async function saveCustomValues(
  client: pg.PoolClient,
  itemId: string,
  defs: FieldDef[],
  custom: Record<string, any>,
  requireAll: boolean
): Promise<Record<string, any>> {
  const mirror: Record<string, any> = {};
  const byKey = new Map(defs.map((d) => [d.key, d]));

  for (const key of Object.keys(custom)) {
    if (!byKey.has(key)) throw badRequest(`Unknown custom field '${key}'`);
  }

  for (const def of defs) {
    const raw = custom[def.key];
    if (raw === undefined || raw === null || raw === '') {
      if (def.is_required && requireAll) throw badRequest(`Custom field '${def.label}' is required`);
      await client.query('DELETE FROM custom_field_values WHERE item_id = $1 AND field_id = $2', [
        itemId,
        def.id,
      ]);
      continue;
    }

    let text: string | null = null;
    let num: number | null = null;
    let date: string | null = null;
    let bool: boolean | null = null;

    switch (def.type) {
      case 'number':
        num = Number(raw);
        if (Number.isNaN(num)) throw badRequest(`Custom field '${def.label}' must be a number`);
        mirror[def.key] = num;
        break;
      case 'date':
        if (Number.isNaN(Date.parse(String(raw))))
          throw badRequest(`Custom field '${def.label}' must be a date (YYYY-MM-DD)`);
        date = String(raw);
        mirror[def.key] = date;
        break;
      case 'boolean':
        bool = raw === true || raw === 'true';
        mirror[def.key] = bool;
        break;
      case 'select': {
        text = String(raw);
        const valid = def.options?.some((o) => o.value === text);
        if (def.options?.length && !valid)
          throw badRequest(`'${text}' is not a valid option for '${def.label}'`);
        mirror[def.key] = text;
        break;
      }
      case 'multiselect': {
        const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        for (const v of values) {
          if (def.options?.length && !def.options.some((o) => o.value === v))
            throw badRequest(`'${v}' is not a valid option for '${def.label}'`);
        }
        text = JSON.stringify(values);
        mirror[def.key] = values;
        break;
      }
      default:
        text = String(raw);
        mirror[def.key] = text;
    }

    await client.query(
      `INSERT INTO custom_field_values (item_id, field_id, value_text, value_num, value_date, value_bool)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (item_id, field_id)
       DO UPDATE SET value_text = $3, value_num = $4, value_date = $5, value_bool = $6`,
      [itemId, def.id, text, num, date, bool]
    );
  }
  return mirror;
}
