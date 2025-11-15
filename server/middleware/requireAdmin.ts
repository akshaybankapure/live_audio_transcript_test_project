import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@shared/schema';
import { storage } from '../storage';

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    // Get userId from device auth
    let userId: string | undefined;
    
    // Check for device-based auth
    if (req.session && (req.session as any).deviceUserId) {
      userId = (req.session as any).deviceUserId;
    }
    // Check for user from auth middleware
    else if (req.user?.claims?.sub) {
      userId = req.user.claims.sub;
    }

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Fetch full user from database (including role)
    const dbUser = await storage.getUser(userId);

    if (!dbUser) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Check admin role
    if (dbUser.role !== UserRole.ADMIN) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    // Cache user on request for downstream use
    req.authUser = dbUser;
    next();
  } catch (error) {
    console.error('[requireAdmin] Error fetching user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function isAdmin(req: Request): Promise<boolean> {
  // Use cached user if available
  if (req.authUser) {
    return req.authUser.role === UserRole.ADMIN;
  }

  // Get userId from device auth
  let userId: string | undefined;
  if (req.session && (req.session as any).deviceUserId) {
    userId = (req.session as any).deviceUserId;
  } else if (req.user?.claims?.sub) {
    userId = req.user.claims.sub;
  }

  if (!userId) {
    return false;
  }

  // Otherwise fetch from database
  try {
    const dbUser = await storage.getUser(userId);
    return dbUser?.role === UserRole.ADMIN;
  } catch {
    return false;
  }
}
