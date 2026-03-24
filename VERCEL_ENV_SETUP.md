# Vercel Environment Variables Setup

## The Issue
`vercel.json` was referencing a secret that doesn't exist. **Solution:** Set environment variables directly in Vercel Dashboard instead.

## ✅ How to Set Environment Variables in Vercel

### Step 1: Go to Your Vercel Project
1. Visit [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click on your project: **o2c-graph-dodge**
3. Navigate to **Settings** tab

### Step 2: Go to Environment Variables
Click **Settings** → **Environment Variables** (or visit: `https://vercel.com/your-username/o2c-graph-dodge/settings/environment-variables`)

### Step 3: Add the Required Variable

Click **"Add New"** and fill in:

| Field | Value |
|-------|-------|
| **Name** | `GEMINI_API_KEY` |
| **Value** | `your_new_api_key_here` |
| **Environment** | Select all: Production ✓, Preview ✓, Development ✓ |

Then click **"Save"**

### Step 4: Redeploy

After saving, you must redeploy:
- Option A: Click **"Redeploy"** button in Vercel dashboard
- Option B: Run in terminal: `git push origin main`

---

## 🔐 Getting Your New API Key

Since your old key was exposed, you need a fresh one:

1. Go to [Google AI Studio](https://ai.google.dev/)
2. Click **"Get API Key"** → **"Create API key in new project"**
3. Copy the new API key
4. Use it in Step 3 above

---

## ✅ Verify Deployment

After redeploy completes:
1. Click the **"Visit"** button or go to `https://o2c-graph-dodge.vercel.app`
2. Try a test query: **"Which products have the most billing documents?"**
3. Should see the 3D graph load with data
4. Check browser console for any errors

---

## Troubleshooting

**Error: "GEMINI_API_KEY is not defined"**
- Environment variable was not saved
- Try logging out and back into Vercel
- Redeploy after setting variable

**Error: "Invalid API key"**
- Using the old exposed key (delete it from Google AI Console)
- Use the new API key instead

**Build succeeds but app doesn't work**
- Check that ALL environments (Production, Preview, Dev) have the variable set
- Redeploy once more after setting all three

---

## Current vercel.json (Fixed)

```json
{
  "name": "o2c-graph-dodge",
  "version": 2,
  "regions": ["iad1"],
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "functions": {
    "app/api/**": {
      "memory": 2048,
      "maxDuration": 30
    }
  },
  "installCommand": "npm ci --legacy-peer-deps"
}
```

✅ No environment variables defined here anymore  
✅ All variables set in Vercel Dashboard instead (more secure)

---

## Summary

| Before | After |
|--------|-------|
| ❌ vercel.json had secret reference | ✅ vercel.json is clean |
| ❌ Secret didn't exist | ✅ Set variable in Vercel Dashboard |
| ❌ Deployment error | ✅ Ready to deploy |
