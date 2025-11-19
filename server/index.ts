import "dotenv/config";
// Suppress Node.js deprecation warnings for punycode (used by dependencies like ws)
// This warning comes from dependencies, not our code, and will be fixed when they update
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    // Silently ignore punycode deprecation warnings from dependencies
    return;
  }
  // Still show other warnings
  console.warn(warning.name, warning.message);
});

// Suppress PostCSS warnings about missing `from` option
// This is a harmless warning from PostCSS plugins that don't pass the `from` option internally
// It doesn't affect functionality and will be fixed when plugin maintainers update their code
const originalWarn = console.warn;
console.warn = (...args) => {
  const message = args.join(' ');
  if (message.includes('PostCSS plugin did not pass the `from` option')) {
    // Silently ignore this specific PostCSS warning
    return;
  }
  originalWarn.apply(console, args);
};

import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
import compression from "compression";

const app = express();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";

// In development, always enable CORS for localhost to allow cookies to work
// In production, only enable if ALLOWED_ORIGIN is set
if (app.get("env") === "development" || ALLOWED_ORIGIN) {
  const allowedOrigins = ALLOWED_ORIGIN 
    ? ALLOWED_ORIGIN.split(',').map(origin => origin.trim())
    : ['http://localhost:5000', 'http://localhost:5001', 'http://localhost:5173', 'http://127.0.0.1:5000', 'http://127.0.0.1:5001', 'http://127.0.0.1:5173'];
  
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, etc.) in development
      if (app.get("env") === "development" && !origin) {
        return callback(null, true);
      }
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  log(`CORS enabled for origins: ${allowedOrigins.join(', ')}`);
}

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Enable response compression for faster payload delivery
app.use(
  compression({
    threshold: 1024, // compress responses > 1KB
    // let Node negotiate best encoding with client (gzip/br), defaults are fine
  })
);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      // Don't truncate log lines - show full information for debugging
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Ensure admin user exists before starting server
  await storage.ensureAdminUser();
  log('[Bootstrap] Admin user ready');

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({port, host:"0.0.0.0", reusePort: false}, () => {
    log(`serving on port ${port}`);
  });
})();
