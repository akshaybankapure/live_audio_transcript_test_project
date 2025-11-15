# Real-Time Group Discussion Monitor

A full-stack web application for monitoring structured group discussions in Indian classrooms. The system uses one smartphone per group (3-6 students) to continuously listen, transcribe, and provide real-time actionable signals to teachers. Built with real ASR/diarization APIs, WebSocket streaming, and comprehensive content analysis.

**Use Case**: Teachers monitor multiple groups simultaneously in noisy classroom environments, receiving live alerts for inappropriate language, language policy violations, participation imbalances, and topic adherence issues.

## Features

### Real-Time Signals 

**Immediate Alerts** (Near Real-Time):
- **Foul/Inappropriate Language**: Real-time detection and flagging with context and speaker identification
- **Language Policy Enforcement**: Detects non-allowed language usage (e.g., must speak English) and alerts immediately

**Delayed Analysis** (Within Short Delay):
- **Participation Balance**: Identifies dominant speakers (>50% talk time) and silent participants (<5% talk time)
- **Topic Adherence**: Basic keyword-based detection to identify when groups drift off-topic

### Core Functionality
- **Real-Time Transcription**: WebSocket-based live transcription with speaker diarization via Soniox API
- **Progressive Auto-Save**: Incremental saving of transcript segments during live recording
- **Multi-Group Monitoring**: Teacher can monitor multiple groups simultaneously
- **Quality & Observability**: Comprehensive logging, metrics, and quality validation tests

### User Interfaces
- **Group Device UI**: Simple interface for students to start/stop recording, view live transcript
- **Teacher Monitoring Dashboard**: Real-time dashboard with:
  - Live alert feed (profanity, language violations, participation, topic adherence)
  - Per-group statistics and metrics
  - Aggregate statistics across all groups
- **Material Design 3**: Clean, professional UI optimized for readability

### Technical Features
- **Real ASR/Diarization**: Uses Soniox API for speech-to-text and speaker identification
- **WebSocket Streaming**: Low-latency pipeline from group device → backend → teacher view
- **Content Analysis**: Comprehensive analysis combining profanity, language policy, participation, and topic adherence
- **Quality Validation**: Automated tests to reduce false positives and ensure alert usefulness

### Data Management
- **Persistent Storage**: PostgreSQL database for transcripts, users, and flagged content
- **Session Management**: Device-based authentication with session persistence
- **Data Ownership**: User ownership validation on all API endpoints

## Tech Stack

### Frontend
- **React 18** - UI library
- **TypeScript** - Type safety
- **Wouter** - Client-side routing
- **TanStack Query** - Data fetching and caching
- **Tailwind CSS** - Styling
- **Shadcn UI** - Component library
- **Soniox Web SDK** - Real-time transcription

### Backend
- **Node.js** - Runtime environment
- **Express** - Web framework
- **TypeScript** - Type safety
- **Drizzle ORM** - Database ORM
- **PostgreSQL** - Primary database
- **WebSockets (ws)** - Real-time communication
- **express-session** - Session management

### External Services
- **Soniox API** - Speech-to-text transcription
- **PostgreSQL** - Database (Neon, Supabase, RDS, etc.)

## Prerequisites

Before setting up the project, ensure you have the following:

### Required Software
- **Node.js** 20+ and npm (check with `node --version` and `npm --version`)

### Required Services & API Keys
- **PostgreSQL Database URL**: Provided database connection string
- **Soniox API**: 
  - Sign up at [Soniox](https://soniox.com) to get an API key
  - Required for real-time speech-to-text transcription

## Installation & Setup

### Step 1: Extract the Project

   ```bash
   unzip AudioTranscriptLive.zip
   cd AudioTranscriptLive
   ```

### Step 2: Install Dependencies

   ```bash
   npm install
   ```

This will install all required Node.js packages for both frontend and backend.

### Step 3: Get Soniox API Key

1. Sign up at [Soniox](https://soniox.com)
2. Navigate to your API keys section
3. Create a new API key
4. Copy the key for use in environment variables

### Step 4: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
# Database Connection (REQUIRED - provided)
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
   
# Session Secret (REQUIRED) - Generate a random 32+ character string
SESSION_SECRET=your-random-secret-key-here-minimum-32-characters
   
# Soniox API (REQUIRED)
SONIOX_API_KEY=your-soniox-api-key-here

# Language Policy (OPTIONAL - defaults to 'en')
ALLOWED_LANGUAGE=en

# Server Port (OPTIONAL - defaults to 5000)
PORT=5000

# Environment (OPTIONAL - defaults to development)
NODE_ENV=development
```

**Important**: 
- Generate a secure `SESSION_SECRET` using: `openssl rand -base64 32` or any random string generator
- Never commit the `.env` file to version control (it's already in `.gitignore`)

### Step 5: Initialize Database Schema

Run the database migration to create all required tables:

   ```bash
   npm run db:push
   ```

This will create the following tables:
- `users` - User and group accounts
- `sessions` - Express session storage
- `transcripts` - Audio transcriptions
- `flagged_content` - Alert records
- `quality_logs` - System observability data
- `device_identifiers` - Device authentication mappings

**Verify**: Check your database to confirm tables were created successfully.

### Step 6: Start the Development Server

```bash
npm run dev
```

This command:
- Starts the Express backend server
- Starts the Vite development server for the frontend
- Enables hot module replacement (HMR) for instant updates
- Serves the application on `http://localhost:5000`

### Step 7: Verify Installation

1. **Open your browser** and navigate to `http://localhost:5000`
2. **Check the console** for any errors
3. **Test authentication**: The app should auto-authenticate in development mode
4. **Check server logs** in your terminal for startup messages

**Expected Behavior**:
- Initial page load: 4-8 seconds (development mode)
- Server logs show: `[Bootstrap] Admin user ready`
- Browser shows the application interface
- No errors in browser console or terminal

## Running the Application

### Development Mode

   ```bash
   npm run dev
   ```

**Features**:
- Hot module replacement (HMR) - changes reflect immediately
- Source maps for debugging
- Detailed error messages
- Automatic device authentication
- Admin login available at `/api/auth/admin`

**Access Points**:
- Frontend: `http://localhost:5000`
- API: `http://localhost:5000/api/*`
- WebSocket: `ws://localhost:5000`

### Production Mode

1. **Build the application**:
   ```bash
   npm run build
   ```
   This creates:
   - Frontend static files in `dist/public/`
   - Backend bundle in `dist/index.js`

2. **Start the production server**:
   ```bash
   npm start
   ```

3. **Set production environment variables**:
   ```bash
   export NODE_ENV=production
   export DATABASE_URL=your-production-database-url
   export SESSION_SECRET=your-production-secret
   # ... other production variables
   npm start
   ```

**Production Features**:
- Optimized and minified code
- Faster load times (1-3 seconds)
- No HMR overhead
- Production error handling

### Type Checking

Run TypeScript type checking without starting the server:

```bash
npm run check
```

This helps catch type errors before running the application.

## First-Time Setup Checklist

- [ ] Node.js 20+ installed and verified
- [ ] Project extracted
- [ ] Dependencies installed (`npm install`)
- [ ] Database URL obtained
- [ ] Soniox API key obtained
- [ ] `.env` file created with all required variables
- [ ] Database schema initialized (`npm run db:push`)
- [ ] Development server starts without errors (`npm run dev`)
- [ ] Application loads in browser at `http://localhost:5000`
- [ ] No errors in browser console or terminal

## Configuration

### Environment Variables

#### Required
- `DATABASE_URL`: PostgreSQL connection string (provided)
- `SESSION_SECRET`: Random secret for session encryption (32+ characters recommended)
- `SONIOX_API_KEY`: Your Soniox API key

#### Optional
- `ALLOWED_LANGUAGE`: Language policy enforcement - language students must speak (default: 'en')
- `PORT`: Server port (default: 5000)
- `NODE_ENV`: Environment mode (development/production)

### Database Setup

The application uses Drizzle ORM with PostgreSQL. Run migrations:

```bash
npm run db:push
```

This creates the following tables:
- `users` - User and group accounts
- `sessions` - Express session storage
- `transcripts` - Audio transcriptions with participation balance and topic adherence scores
- `flagged_content` - All alert types (profanity, language policy, off-topic) with flagType field
- `quality_logs` - Observability and quality metrics for system improvement
- `device_identifiers` - Device authentication mappings

**Schema Features**:
- Language policy violations tracking in transcripts
- Participation balance stored as JSONB (speaker talk time percentages)
- Topic adherence scores (0-1) for each transcript
- Quality logs for debugging and system improvement

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (frontend + backend with HMR) |
| `npm run build` | Build for production (creates `dist/` directory) |
| `npm run start` | Start production server (requires `npm run build` first) |
| `npm run check` | Type check with TypeScript (no server start) |
| `npm run db:push` | Push database schema changes to PostgreSQL |

### Development Workflow

1. **Make code changes** in `client/src/` or `server/`
2. **Save files** - Vite HMR automatically reloads frontend changes
3. **Backend changes** require server restart (stop with `Ctrl+C`, then `npm run dev`)
4. **Database changes** require running `npm run db:push` after modifying `shared/schema.ts`

### Project Structure

```
AudioTranscriptLive/
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Route pages
│   │   ├── lib/           # Utilities and helpers
│   │   └── hooks/         # Custom React hooks
│   └── public/            # Static assets
├── server/                # Backend Express application
│   ├── middleware/       # Express middleware
│   ├── types/             # TypeScript type definitions
│   └── *.ts              # Server modules
├── shared/                # Shared code between frontend and backend
│   └── schema.ts         # Database schema
├── docs/                  # Documentation
└── uploads/              # Temporary file uploads
```

### Development Features

- **Hot Module Replacement**: Frontend updates automatically
- **TypeScript**: Full type safety across the stack
- **Device Authentication**: Automatic device authentication in development
- **Admin Login**: Development-only admin login endpoint (`/api/auth/admin`)

## Deployment

### Quick Deployment Options

#### Monolithic Deployment
Deploy both frontend and backend together on a single server.

#### Separate Services Deployment
- **Backend**: Deploy to Node.js hosting (Render, Railway, Fly.io, etc.)
- **Frontend**: Deploy static files to Vercel, Netlify, Cloudflare Pages, etc.

## API Endpoints

### Authentication
- `POST /api/auth/device` - Device authentication (development only)
- `POST /api/auth/admin` - Admin login (development only)
- `GET /api/auth/user` - Get current user

### Transcripts
- `POST /api/transcripts` - Create draft transcript
- `PATCH /api/transcripts/:id/segments` - Append segments to transcript
- `PATCH /api/transcripts/:id/complete` - Mark transcript as complete
- `GET /api/transcripts` - Get user's transcripts
- `GET /api/transcripts/:id` - Get single transcript

### Dashboard
- `GET /api/dashboard/overview` - Get dashboard overview
- `GET /api/dashboard/device/:deviceId` - Get device details
- `GET /api/flagged-content` - Get user's flagged content

### Admin
- `GET /api/dashboard/stats` - Get aggregate statistics (admin only)
- WebSocket connection for real-time profanity alerts

### WebSocket
- Connect to `/` for live transcription
- Admin clients receive profanity alerts in real-time

## Security

- **Session-Based Authentication**: Secure session management with HttpOnly cookies
- **User Ownership Validation**: All API endpoints validate user ownership
- **Role-Based Access**: Admin endpoints protected by role validation
- **Input Validation**: Zod schemas for request validation

## Documentation

- **[PRODUCT_NOTE.md](./PRODUCT_NOTE.md)**: Product framing, MVP scope, design decisions, and trade-offs
- **[TECHNICAL_NOTE.md](./TECHNICAL_NOTE.md)**: Architecture, technical decisions, alert computation, limitations, and improvements
- **[docs/setup.md](./docs/setup.md)**: Quick setup and run instructions
- **[docs/performance.md](./docs/performance.md)**: Performance characteristics, load time expectations, and optimization details

## Quality & Observability

The system includes comprehensive quality measures:

### Quality Validation Tests
- **Profanity Detection Accuracy**: Prevents false positives and spammy alerts
- **Language Policy Detection**: Validates language detection correctness
- **Participation Balance Reasonableness**: Ensures useful participation signals
- **Alert Spam Prevention**: Limits alert frequency to prevent teacher overload

### Observability
- **Decision Logging**: All detection decisions are logged with context
- **Quality Metrics**: Per-group metrics tracked (participation balance, topic adherence scores)
- **Quality Logs**: Stored in `quality_logs` table for analysis and improvement

### Monitoring Signals
- Alert rate per group (target: <5 alerts per minute)
- False positive rate (target: <10%)
- System latency (target: alerts within 2-3 seconds)
- API error rates and database performance

## Design Guidelines

The application follows Material Design 3 principles with a focus on:
- **Information Clarity**: Transcripts are the primary focus
- **Professional Utility**: Clean, distraction-free interface
- **Readability**: Inter font with optimized typography hierarchy
- **Speaker Color Coding**: Consistent color mapping for speaker identification

## Future Features

Planned enhancements (see [docs/audio-capture-architecture.md](./docs/audio-capture-architecture.md)):
- Audio capture and playback
- Snippet extraction for flagged content
- Background job processing
- Audio waveform visualization
- Transcript-audio synchronization

## Troubleshooting

### Common Issues

**401 Unauthorized on API requests**
- Verify `SESSION_SECRET` is set
- Check that cookies are enabled in browser
- Ensure `ALLOWED_ORIGIN` matches frontend URL exactly (if using separate deployment)

**CORS errors**
- Set `ALLOWED_ORIGIN` environment variable on backend
- Ensure origin includes protocol (https://) and no trailing slash
- Restart backend after environment variable changes

**Database connection errors**
- Verify `DATABASE_URL` is correct
- Ensure database is accessible from your network
- Check database credentials and permissions

## License

MIT

## Support

For issues or questions:
- Review server logs and browser console
- Consult Soniox API documentation for transcription-related issues

