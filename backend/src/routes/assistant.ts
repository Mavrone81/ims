import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { asyncHandler } from '../utils/http.js';
import { ApiError, badRequest } from '../errors.js';

// AI inventory assistant. Claude answers questions about the user's CURRENT
// project using two safe mechanisms:
//   1. Tool use — a fixed set of parameterized, project/org-scoped query tools
//      (the model never writes SQL; every query is bound to req.projectId /
//      req.user.org_id, so multi-tenant isolation is enforced server-side).
//   2. Vision — optional attached images (base64) for "what/how many is this?".
export const assistantRouter = Router();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
const MAX_TOOL_ROUNDS = 5;

const AskSchema = z
  .object({
    question: z.string().trim().max(1000).optional().default(''),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
      .max(10)
      .optional(),
    images: z
      .array(
        z.object({
          media_type: z.enum(IMAGE_MEDIA_TYPES),
          data: z.string().min(1).max(7_000_000),
        })
      )
      .max(4)
      .optional(),
  })
  .refine((v) => (v.question && v.question.trim().length > 0) || (v.images && v.images.length > 0), {
    message: 'Provide a question or at least one image',
  });

// ── Scoped query tools the model may call ──────────────────────────────
interface ToolCtx {
  projectId: string;
  orgId: string;
}

const TOOLS = [
  {
    name: 'inventory_summary',
    description: 'Totals for the current project: item count, total units on hand, total stock value (native currencies summed), and out-of-stock count.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_items',
    description: 'Search items in the current project by item number or description (case-insensitive). Returns matches with stock on hand, unit price and category.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to match in item_no or description' }, limit: { type: 'integer', description: 'Max rows (default 20, max 50)' } },
      required: ['query'],
    },
  },
  {
    name: 'item_detail',
    description: 'Full detail for one item by exact item number: description, category, stock on hand, reorder level, unit price/currency, and linked supplier names.',
    input_schema: { type: 'object', properties: { item_no: { type: 'string' } }, required: ['item_no'] },
  },
  {
    name: 'list_low_stock',
    description: 'Items at or below their reorder level in the current project (the reorder/low-stock list).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'recent_movements',
    description: 'Recent stock transactions in the current project, newest first. Optionally filter to one item number and/or a lookback window in days (default 30, max 365).',
    input_schema: { type: 'object', properties: { item_no: { type: 'string' }, days: { type: 'integer' }, limit: { type: 'integer' } } },
  },
  {
    name: 'list_suppliers',
    description: 'Suppliers for the organization (names), optionally filtered by a name fragment.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } },
  },
];

async function runTool(name: string, input: any, ctx: ToolCtx): Promise<any> {
  const clamp = (n: any, def: number, max: number) => Math.min(max, Math.max(1, Number(n) || def));
  switch (name) {
    case 'inventory_summary': {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS item_count, COALESCE(SUM(stock_on_hand),0)::float AS total_units,
                ROUND(COALESCE(SUM(value_native),0)::numeric,2)::float AS total_value_native,
                COUNT(*) FILTER (WHERE stock_on_hand <= 0)::int AS out_of_stock
         FROM v_item_valuation WHERE project_id = $1`,
        [ctx.projectId]
      );
      return rows[0];
    }
    case 'search_items': {
      const limit = clamp(input?.limit, 20, 50);
      const q = `%${String(input?.query ?? '').slice(0, 100)}%`;
      const { rows } = await query(
        `SELECT v.item_no, v.description, v.stock_on_hand::float AS on_hand, v.unit_price::float AS unit_price,
                v.currency, c.name AS category
         FROM v_item_valuation v LEFT JOIN categories c ON c.id = v.category_id
         WHERE v.project_id = $1 AND (v.item_no ILIKE $2 OR v.description ILIKE $2)
         ORDER BY v.item_no LIMIT ${limit}`,
        [ctx.projectId, q]
      );
      return { count: rows.length, items: rows };
    }
    case 'item_detail': {
      const { rows } = await query(
        `SELECT v.item_no, v.description, v.stock_on_hand::float AS on_hand, v.unit_price::float AS unit_price,
                v.currency, c.name AS category, i.reorder_level::float AS reorder_level
         FROM v_item_valuation v JOIN items i ON i.id = v.item_id
         LEFT JOIN categories c ON c.id = v.category_id
         WHERE v.project_id = $1 AND v.item_no = $2 LIMIT 1`,
        [ctx.projectId, String(input?.item_no ?? '')]
      );
      if (!rows[0]) return { found: false };
      const suppliers = await query(
        `SELECT s.name FROM item_suppliers isup JOIN suppliers s ON s.id = isup.supplier_id
         JOIN items i ON i.id = isup.item_id
         WHERE i.project_id = $1 AND i.item_no = $2 ORDER BY s.name`,
        [ctx.projectId, String(input?.item_no ?? '')]
      );
      return { found: true, ...rows[0], suppliers: suppliers.rows.map((r) => r.name) };
    }
    case 'list_low_stock': {
      const { rows } = await query(
        `SELECT item_no, description, stock_on_hand::float AS on_hand, reorder_level::float AS reorder_level
         FROM v_reorder WHERE project_id = $1 ORDER BY (stock_on_hand - reorder_level) ASC LIMIT 100`,
        [ctx.projectId]
      );
      return { count: rows.length, items: rows };
    }
    case 'recent_movements': {
      const days = clamp(input?.days, 30, 365);
      const limit = clamp(input?.limit, 30, 100);
      const params: any[] = [ctx.projectId];
      let where = `t.project_id = $1 AND t.performed_at >= now() - ($2 || ' days')::interval`;
      params.push(String(days));
      if (input?.item_no) {
        params.push(String(input.item_no));
        where += ` AND i.item_no = $${params.length}`;
      }
      const { rows } = await query(
        `SELECT i.item_no, t.type, t.quantity_delta::float AS qty_delta, t.performed_at
         FROM stock_transactions t JOIN items i ON i.id = t.item_id
         WHERE ${where} ORDER BY t.performed_at DESC LIMIT ${limit}`,
        params
      );
      return { count: rows.length, movements: rows };
    }
    case 'list_suppliers': {
      const params: any[] = [ctx.orgId];
      let where = `org_id = $1 AND deleted_at IS NULL`;
      if (input?.query) {
        params.push(`%${String(input.query).slice(0, 100)}%`);
        where += ` AND name ILIKE $${params.length}`;
      }
      const { rows } = await query(`SELECT name FROM suppliers WHERE ${where} ORDER BY name LIMIT 100`, params);
      return { count: rows.length, suppliers: rows.map((r) => r.name) };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

async function callClaude(body: any, signal: AbortSignal): Promise<any> {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new ApiError(502, 'AI_ERROR', `AI service returned ${r.status}`, [detail.slice(0, 300)]);
  }
  return r.json();
}

assistantRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = AskSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid request', parsed.error.issues);
    if (!config.anthropicApiKey) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'The AI assistant is not configured on this server.');
    }

    const { question, history = [], images = [] } = parsed.data;
    const ctx: ToolCtx = { projectId: req.projectId!, orgId: req.user!.org_id };

    const system =
      `You are the inventory assistant inside an Inventory Management System (IMS). You help with the user's ` +
      `CURRENTLY ACTIVE project only. Use the provided tools to look up live data before answering — do not guess ` +
      `numbers. Refer to items by item_no and description. Quantities are in each item's own unit; monetary values are ` +
      `in each item's native currency. If a lookup returns nothing, say so plainly. If an image is attached, use it ` +
      `(e.g. read a label/part number, then look it up with a tool). Keep answers short and practical; use compact bullets.`;

    // Build the first user turn (text + any images).
    const userContent: any[] = [];
    for (const img of images) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
    }
    userContent.push({ type: 'text', text: question || 'Please look at the attached image and help.' });

    const messages: any[] = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent },
    ];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      let answer = '';
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const data = await callClaude(
          { model: config.anthropicModel, max_tokens: 1024, temperature: 0.2, system, tools: TOOLS, messages },
          ctrl.signal
        );
        const content: any[] = Array.isArray(data.content) ? data.content : [];
        const toolUses = content.filter((b) => b?.type === 'tool_use');
        if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
          answer = content.filter((b) => b?.type === 'text').map((b) => b.text).join('');
          break;
        }
        messages.push({ role: 'assistant', content });
        const results = [];
        for (const tu of toolUses) {
          let out: any;
          try {
            out = await runTool(tu.name, tu.input ?? {}, ctx);
          } catch (e) {
            out = { error: 'tool execution failed' };
          }
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 20000) });
        }
        messages.push({ role: 'user', content: results });
      }

      res.json({ answer: answer || 'Sorry, I could not find an answer. Try rephrasing or check the Reports page.' });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if ((err as any)?.name === 'AbortError') throw new ApiError(504, 'AI_TIMEOUT', 'The AI assistant timed out. Please try again.');
      throw new ApiError(502, 'AI_ERROR', 'Could not reach the AI service.');
    } finally {
      clearTimeout(timer);
    }
  })
);
