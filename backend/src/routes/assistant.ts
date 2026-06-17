import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { asyncHandler } from '../utils/http.js';
import { ApiError, badRequest } from '../errors.js';

// AI inventory assistant. Answers a user's question using a bounded, project-
// scoped snapshot of their own inventory (context injection only — the model
// never sees other projects/orgs and never generates SQL). Powered by Anthropic
// Claude; the API key is server-managed (config.anthropicApiKey).
export const assistantRouter = Router();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const AskSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(10)
    .optional(),
});

/** Compact, project-scoped inventory snapshot fed to the model as context. */
async function buildSnapshot(projectId: string) {
  const totals = (
    await query(
      `SELECT COUNT(*)::int AS item_count,
              COALESCE(SUM(stock_on_hand), 0)::float AS total_units,
              ROUND(COALESCE(SUM(value_native), 0)::numeric, 2)::float AS total_value_native,
              COUNT(*) FILTER (WHERE stock_on_hand <= 0)::int AS out_of_stock
       FROM v_item_valuation WHERE project_id = $1`,
      [projectId]
    )
  ).rows[0];

  const reorder = (
    await query(
      `SELECT item_no, description, stock_on_hand::float AS on_hand, reorder_level::float AS reorder_level
       FROM v_reorder WHERE project_id = $1
       ORDER BY (stock_on_hand - reorder_level) ASC LIMIT 25`,
      [projectId]
    )
  ).rows;

  const top_by_value = (
    await query(
      `SELECT item_no, description, stock_on_hand::float AS on_hand, currency,
              ROUND(value_native::numeric, 2)::float AS value
       FROM v_item_valuation WHERE project_id = $1 AND value_native > 0
       ORDER BY value_native DESC LIMIT 15`,
      [projectId]
    )
  ).rows;

  const movements_30d = (
    await query(
      `SELECT type, COUNT(*)::int AS txns,
              SUM(CASE WHEN quantity_delta > 0 THEN quantity_delta ELSE 0 END)::float AS qty_in,
              SUM(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END)::float AS qty_out
       FROM stock_transactions
       WHERE project_id = $1 AND performed_at >= now() - interval '30 days'
       GROUP BY type ORDER BY type`,
      [projectId]
    )
  ).rows;

  return { totals, reorder_items: reorder, top_by_value, movements_30d };
}

assistantRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = AskSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid request', parsed.error.issues);

    if (!config.anthropicApiKey) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'The AI assistant is not configured on this server.');
    }

    const { question, history = [] } = parsed.data;
    const snapshot = await buildSnapshot(req.projectId!);

    const system =
      `You are the inventory assistant inside an Inventory Management System (IMS). ` +
      `Answer the user's question concisely and practically using ONLY the JSON inventory snapshot below, ` +
      `which covers the user's currently active project. If the answer is not derivable from the data, say so plainly ` +
      `and point them to the relevant screen (Inventory, Movements, or Reports). Refer to items by their item_no and description. ` +
      `Quantities are in each item's own unit; values are in each item's native currency (see "currency"). ` +
      `Keep answers short; use compact bullet points for lists. Do not invent items or numbers.\n\n` +
      `INVENTORY SNAPSHOT (JSON):\n${JSON.stringify(snapshot)}`;

    const messages = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: question },
    ];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.anthropicModel,
          max_tokens: 700,
          temperature: 0.2,
          system,
          messages,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        throw new ApiError(502, 'AI_ERROR', `AI service returned ${r.status}`, [detail.slice(0, 300)]);
      }
      const data: any = await r.json();
      const answer = Array.isArray(data.content)
        ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
        : '';
      res.json({
        answer: answer || 'Sorry, I could not generate a response. Please try rephrasing.',
        snapshot_summary: {
          item_count: snapshot.totals.item_count,
          out_of_stock: snapshot.totals.out_of_stock,
          reorder_count: snapshot.reorder_items.length,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if ((err as any)?.name === 'AbortError') throw new ApiError(504, 'AI_TIMEOUT', 'The AI assistant timed out. Please try again.');
      throw new ApiError(502, 'AI_ERROR', 'Could not reach the AI service.');
    } finally {
      clearTimeout(timer);
    }
  })
);
