import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { parse as parseUrl } from 'url';
import { parse as parseCookie } from 'cookie';
import { storage } from './storage';
import { UserRole } from '@shared/schema';
import { pool } from './db';
import type { IncomingMessage } from 'http';

export interface AlertPayload {
  type: 'PROFANITY_ALERT' | 'LANGUAGE_POLICY_ALERT' | 'PARTICIPATION_ALERT' | 'TOPIC_ADHERENCE_ALERT';
  deviceId: string;
  deviceName: string;
  transcriptId: string;
  flaggedWord: string;
  timestampMs: number;
  speaker: string;
  context: string;
  flagType?: 'profanity' | 'language_policy' | 'participation' | 'off_topic';
}

// Legacy interface for backward compatibility
export interface ProfanityAlertPayload extends AlertPayload {
  type: 'PROFANITY_ALERT';
}

interface AlertClient {
  ws: WebSocket;
  userId: string;
  role?: string;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private alertClients: Set<AlertClient> = new Set();

  private async getUserIdFromSession(request: IncomingMessage): Promise<string | null> {
    try {
      const cookies = request.headers.cookie;
      if (!cookies) return null;

      const parsedCookies = parseCookie(cookies);
      let sessionId = parsedCookies['connect.sid'];
      
      if (!sessionId) return null;

      // Remove 's:' prefix and signature if present (connect-pg-simple format)
      if (sessionId.startsWith('s:')) {
        sessionId = sessionId.substring(2).split('.')[0];
      }

      // Query the session store
      const result = await pool.query(
        'SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()',
        [sessionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const session = result.rows[0].sess;

      // Check for device-based auth (development)
      if (session.deviceUserId) {
        return session.deviceUserId;
      }

      // Check for authenticated user
      if (session.passport?.user?.claims?.sub) {
        return session.passport.user.claims.sub;
      }

      return null;
    } catch (error) {
      console.error('[WebSocket] Session parsing error:', error);
      return null;
    }
  }

  initialize(httpServer: Server) {
    this.wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrade
    httpServer.on('upgrade', async (request, socket, head) => {
      const { pathname } = parseUrl(request.url || '');

      // Only handle /ws/monitor path for admin monitoring
      if (pathname === '/ws/monitor') {
        try {
          // Extract and validate session
          const userId = await this.getUserIdFromSession(request);
          
          if (!userId) {
            // Log more details for debugging
            const cookies = request.headers.cookie;
            console.log('[WebSocket] No valid session found');
            console.log('[WebSocket] Cookies present:', !!cookies);
            if (cookies) {
              const parsedCookies = parseCookie(cookies);
              console.log('[WebSocket] Session cookie present:', !!parsedCookies['connect.sid']);
            }
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // Verify user exists (allow all authenticated users, not just admin)
          const user = await storage.getUser(userId);
          if (!user) {
            console.log(`[WebSocket] User ${userId} not found`);
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }

          // Log connection (admin gets full monitoring, regular users get alerts)
          if (user.role === UserRole.ADMIN) {
            console.log(`[WebSocket] Admin user ${userId} connected for full monitoring`);
          } else {
            console.log(`[WebSocket] User ${userId} connected for alerts`);
          }

          // Attach userId to request for use in connection handler
          (request as any).userId = userId;

          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request);
          });
        } catch (error) {
          console.error('[WebSocket] Upgrade error:', error);
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          socket.destroy();
        }
      }
    });

    this.wss.on('connection', async (ws: WebSocket, request: any) => {
      // userId was attached during upgrade phase
      const userId = request.userId;
      
      if (!userId) {
        console.error('[WebSocket] Connection without userId, this should not happen');
        ws.close(1011, 'Internal server error');
        return;
      }

      // Get user role
      const user = await storage.getUser(userId);
      const userRole = user?.role || 'user';

      // Add to alert clients
      const client: AlertClient = { ws, userId, role: userRole };
      this.alertClients.add(client);
      console.log(`[WebSocket] Client connected: ${userId} (role: ${userRole})`);

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        message: 'Alerts connected',
        userId,
        role: userRole,
      }));

      // Handle client disconnection
      ws.on('close', () => {
        this.alertClients.delete(client);
        console.log(`[WebSocket] Client disconnected: ${userId}`);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[WebSocket] Client error for ${userId}:`, error);
        this.alertClients.delete(client);
      });
    });

    console.log('[WebSocket] Service initialized for alerts monitoring');
  }

  /**
   * Broadcast any type of alert to all connected clients (all authenticated users)
   */
  broadcastAlert(payload: AlertPayload) {
    if (!this.wss) {
      console.warn('[WebSocket] Cannot broadcast: service not initialized');
      return;
    }

    const message = JSON.stringify(payload);
    let sentCount = 0;

    // Convert Set to Array for iteration
    const clients = Array.from(this.alertClients);
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
          sentCount++;
        } catch (error) {
          console.error(`[WebSocket] Error sending to client ${client.userId}:`, error);
        }
      }
    }

    console.log(`[WebSocket] ${payload.type} broadcasted to ${sentCount} clients`);
  }

  /**
   * Legacy method for backward compatibility
   */
  broadcastProfanityAlert(payload: ProfanityAlertPayload) {
    this.broadcastAlert(payload);
  }

  getConnectedClientCount(): number {
    return this.alertClients.size;
  }

  getConnectedAdminCount(): number {
    return Array.from(this.alertClients).filter(c => c.role === UserRole.ADMIN).length;
  }
}

export const websocketService = new WebSocketService();
