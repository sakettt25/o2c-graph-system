# Vercel Deployment Plans & Limits

## Current Configuration

**o2c-graph-dodge** is configured for **Vercel Hobby Plan**

```json
{
  "memory": 2048,      // Max for Hobby plan
  "maxDuration": 30,   // Seconds
  "regions": ["iad1"]  // N. Virginia (US East)
}
```

---

## Vercel Plan Comparison

| Feature | Hobby (Free) | Pro ($20/mo) | Enterprise |
|---------|-------------|------------|-----------|
| **Serverless Function Memory** | 2048 MB | 3008 MB | 10,240 MB |
| **Function Execution Time** | 30s | 900s (15 min) | Custom |
| **Builds/Month** | Unlimited | Unlimited | Unlimited |
| **Bandwidth** | 100GB/month | 1TB/month | Custom |
| **Concurrent Functions** | 12 | Unlimited | Unlimited |
| **Teams** | Personal only | Teams | Teams |
| **Cost** | Free | $20/month | Custom |

---

## Current Capacity (Hobby Plan)

✅ **This app works fine on Hobby plan because:**
- API responses stream via SSE (not blocking)
- Database queries execute quickly (<1s)
- Graph visualization is client-side (3D-force-graph in browser)
- Memory usage is well under 2048 MB

❌ **May need Pro plan if you:**
- Add complex batch processing
- Generate large reports (>50MB)
- Scale to thousands of concurrent users
- Need functions to run longer than 30 seconds

---

## Upgrading to Pro Plan

### Option 1: Upgrade in Vercel Dashboard (30 seconds)

1. Go to [vercel.com/account/billing](https://vercel.com/account/billing)
2. Click **"Update Plan"** → **Pro ($20/month)**
3. Update `vercel.json` memory to 3008:
   ```json
   "memory": 3008
   ```
4. Redeploy (`vercel --prod`)

### Option 2: Create a Team (Pro features for free)

Vercel offers **Pro features for free** if you create a team:

1. Go to [vercel.com/dashboard/teams](https://vercel.com/dashboard/teams)
2. Click **"Create Team"**
3. Set team name (can be your GitHub org or personal name)
4. You get Pro plan benefits for that team

---

## Memory Configuration Guide

**For Hobby Plan (Keep at 2048):**
```json
"memory": 2048
```
✅ Good for: Standard CRUD, API proxies, small data processing

**For Pro Plan (Increase to 3008):**
```json
"memory": 3008
```
✅ Good for: Data processing, ML models, large dataset queries

**For Enterprise (Up to 10,240):**
```json
"memory": 10240
```
✅ Good for: Heavy computation, large ML models, batch processing

---

## Deployment Status

**Current Setup:**
- ✅ Memory: **2048 MB** (Hobby plan compatible)
- ✅ Duration: **30 seconds** (sufficient for graph queries)
- ✅ Function timeout: Adequate for Gemini API calls + SQLite queries
- ✅ Ready to deploy immediately

**To Deploy:**
```bash
git push origin main
# Then deploy via Vercel dashboard or CLI:
vercel --prod --name o2c-graph-dodge
```

---

## Monitoring Function Usage

After deployment, check real usage in Vercel Dashboard:

1. Go to your project → **Settings → Functions**
2. Check actual memory usage vs. allocation
3. Downgrade if using <1500 MB consistently
4. Upgrade if hitting limits

---

## Cost Notes

- **Hobby Plan:** Free tier (limited features)
- **Pro Plan:** $20/month (pro-rated daily)
  - Try Pro for 1 month: **$0.67/day** (1 day trial)
- **Bandwidth:** Included with plan (100GB Hobby, 1TB Pro)
- **Build minutes:** Unlimited on both

---

**⚡ Recommendation:** Start with Hobby plan. Upgrade to Pro only if you hit limits.
