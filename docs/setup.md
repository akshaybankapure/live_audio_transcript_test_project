# Setup Guide

## Prerequisites

- Node.js 20+
- Database URL (provided)
- Soniox API key

## Steps

1. Extract the zip file
   ```bash
   unzip AudioTranscriptLive.zip
   cd AudioTranscriptLive
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Create `.env` file
   ```bash
   DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
   SESSION_SECRET=your-random-32-char-secret
   SONIOX_API_KEY=your-soniox-key
   ```

4. Initialize database
   ```bash
   npm run db:push
   ```

5. Start server
   ```bash
   npm run dev
   ```

6. Open browser
   ```
   http://localhost:5000
   ```

## Production

```bash
npm run build
npm start
```

