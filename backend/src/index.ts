import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';
import { authenticate, projectScope } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { itemsRouter } from './routes/items.js';
import { transactionsRouter } from './routes/transactions.js';
import { stockRouter } from './routes/stock.js';
import { customFieldsRouter } from './routes/customFields.js';
import { categoriesRouter, suppliersRouter, currenciesRouter, exchangeRatesRouter } from './routes/catalog.js';
import { sitesRouter, projectsRouter, locationsRouter } from './routes/org.js';
import { usersRouter } from './routes/users.js';
import { reportsRouter } from './routes/reports.js';
import { auditRouter } from './routes/audit.js';

const app = express();
app.set('trust proxy', true);
app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['X-Duplicate-Warning'] }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit);

const api = express.Router();
app.use(config.apiBasePath, api);

api.get('/health', async (_req, res) => {
  let db = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    db = 'error';
  }
  res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'degraded', db, version: '1.0.0' });
});

api.use('/auth', authRouter);

// Org-level resources (no project scope needed)
api.use('/sites', authenticate, sitesRouter);
api.use('/projects', authenticate, projectsRouter);
api.use('/locations', authenticate, locationsRouter);
api.use('/users', authenticate, usersRouter);
api.use('/currencies', authenticate, currenciesRouter);
api.use('/exchange-rates', authenticate, exchangeRatesRouter);
api.use('/audit-logs', authenticate, projectScope, auditRouter);

// Project-scoped resources (require X-Project-Id)
api.use('/items', authenticate, projectScope, itemsRouter);
api.use('/transactions', authenticate, projectScope, transactionsRouter);
api.use('/stock', authenticate, projectScope, stockRouter);
api.use('/custom-fields', authenticate, projectScope, customFieldsRouter);
api.use('/categories', authenticate, projectScope, categoriesRouter);
api.use('/suppliers', authenticate, projectScope, suppliersRouter);
api.use('/reports', authenticate, projectScope, reportsRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`IMS API listening on :${config.port}${config.apiBasePath}`);
});
