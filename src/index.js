import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { collectDefaultMetrics, register, Counter } from 'prom-client';
import { query, healthCheck } from './db.js';
import healthRoutes from './routes/health.js';
import notesRoutes from './routes/notes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- PROMETHEUS METRICS SETUP (BOVENAAN) ---
collectDefaultMetrics();

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Totaal aantal HTTP requests',
  labelNames: ['method', 'path', 'status']
});

// Zorg dat /metrics ALS EERSTE gedefinieerd staat
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});

// Middleware voor het tellen van verzoeken
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequests.inc({
      method: req.method,
      path: req.route ? req.route.path : req.path,
      status: res.statusCode
    });
  });
  next();
});

// --- OVERIGE EXPRESS MIDDLEWARE & ROUTES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Paden aangepast: zoekt nu direct in src/public en src/views
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/health', healthRoutes);
app.use('/api/notes', notesRoutes);

app.get('/', async (req, res) => {
  try {
    const result = await query('SELECT id, title, content, created_at FROM notes ORDER BY created_at DESC');
    res.render('index', { notes: result.rows });
  } catch (error) {
    console.error('Error rendering home page:', error);
    res.render('index', { notes: [], error: 'Failed to load notes' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, async () => {
  console.log(`dotNOVI listening on port ${PORT}`);
  try {
    const isHealthy = await healthCheck();
    if (isHealthy) {
      console.log('Database connection: OK');
    } else {
      console.warn('Database connection: FAILED - check DATABASE_URL');
    }
  } catch (error) {
    console.warn('Database health check error:', error.message);
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;