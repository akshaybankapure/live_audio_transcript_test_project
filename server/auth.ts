import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  // Use provided secret or generate a default for development
  const sessionSecret = process.env.SESSION_SECRET || 
    (process.env.NODE_ENV === 'development' ? 'dev-session-secret-change-in-production' : undefined);
  
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set. Generate a random secret for production.");
  }
  
  const cookieConfig: session.CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
    maxAge: sessionTtl,
    sameSite: process.env.NODE_ENV === 'production' && process.env.ALLOWED_ORIGIN ? 'none' : 'lax', // Use 'lax' in development, 'none' in production with CORS
    path: '/', // Ensure cookie is available for all paths
  };
  
  return session({
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: cookieConfig,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  
  // Logout endpoint - destroy session and redirect
  app.get("/api/logout", (req, res) => {
    req.session?.destroy(() => {
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Check for device-based authentication
  const session = req.session as any;
  if (session?.deviceUserId) {
    try {
      const deviceUser = await storage.getUser(session.deviceUserId);
      if (deviceUser) {
        // Populate req.user with device user
        (req as any).user = {
          claims: {
            sub: deviceUser.id,
            email: deviceUser.email,
            first_name: deviceUser.firstName,
            last_name: deviceUser.lastName,
          },
          displayName: deviceUser.displayName,
        };
        return next();
      }
    } catch (error) {
      console.error("Error loading device user:", error);
    }
  }

  // Device auth failed
  return res.status(401).json({ message: "Unauthorized" });
};

