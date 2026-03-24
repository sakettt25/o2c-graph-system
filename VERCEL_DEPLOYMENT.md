# Vercel Deployment Guide

## Project: o2c-graph-dodge

### Step 1: Push to GitHub

```bash
git add .
git commit -m "Final deployment setup for Vercel"
git push origin main
```

### Step 2: Create Vercel Project

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Project name: `o2c-graph-dodge`
5. Framework: **Next.js** (should auto-detect)
6. Root directory: `.` (default)

### Step 3: Set Environment Variables

**In Vercel Dashboard:**

1. Navigate to your project settings
2. Go to **Settings** → **Environment Variables**
3. Add the following variables **for all environments** (Production, Preview, Development):

| Name | Value | Environments |
|------|-------|--------------|
| `GEMINI_API_KEY` | `AIzaSyA3G4USh3-lEkLETCcXH5pkWMeuZS3vtMM` | Production, Preview, Development |
| `DB_PATH` | `./data/o2c.db` | Production, Preview, Development |
| `NODE_ENV` | `production` | Production only |

**Important:** These environment variables are required for:
- **GEMINI_API_KEY**: LLM API calls for natural language query generation
- **DB_PATH**: SQLite database location
- **NODE_ENV**: Runtime environment flag

### Step 4: Deploy

After setting environment variables:

1. Click **"Deploy"** button in Vercel dashboard
2. Wait for build to complete (~2-3 minutes)
3. Once successful, your app will be live at: **https://o2c-graph-dodge.vercel.app**

### Step 5: Verify Deployment

1. Visit the live URL
2. Test a query: "Which products have the most billing documents?"
3. Check that graph loads with 669 nodes and 759 edges
4. Verify streaming response works

### Troubleshooting

**Build fails with "better-sqlite3" error:**
- Vercel can't build native SQLite bindings. Solution: Use `serverless-sqlite` or move DB to edge function
- Alternatively, pre-build locally and commit `node_modules` (not recommended)

**Database not loading:**
- Ensure `DB_PATH` is correctly set to `./data/o2c.db`
- Verify `o2c.db` file is committed to git

**GEMINI_API_KEY not recognized:**
- Check Vercel Environment Variables are saved
- Redeploy after adding env vars
- The API key in.env.production is for local testing only

### Optional: Custom Domain

To add a custom domain:
1. Go to **Settings** → **Domains**
2. Add your domain
3. Follow DNS configuration instructions

---

**Deployment Status:** Ready for production ✅  
**Live URL:** https://o2c-graph-dodge.vercel.app  
**Database:** Included in repo (./data/o2c.db)  
**Build framework:** Next.js 14.2.5
