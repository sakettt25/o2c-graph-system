# Quick Reference — Commands & Links

## Essential Commands

### Local Development
```bash
# Start server
export GEMINI_API_KEY=\"your-key\"
python3 server.py
# Visit http://localhost:3000
```

### GitHub Setup
```bash
git init
git add .
git commit -m \"Initial commit\"
git branch -M main
git remote add origin https://github.com/USERNAME/o2c-graph-system.git
git push -u origin main
```

### Cloud Deployment
```bash
# Railway (easiest)
railway login && railway init && railway up

# Render (simple)
# Connect GitHub → Select repo → Deploy

# Fly.io (advanced)
fly launch && fly deploy
```

---

## Key URLs

| Resource | URL |
|----------|-----|
| **Gemini API** | https://ai.google.dev |
| **Railway** | https://railway.app |
| **Render** | https://render.com |
| **Fly.io** | https://fly.io |
| **3d-force-graph** | https://github.com/vasturiano/3d-force-graph |

---

## Important Files

| File | Purpose |
|------|---------|
| `README.md` | Main documentation |
| `SUBMISSION_GUIDE.md` | Step-by-step submission |
| `FINAL_SUMMARY.md` | Quick status check |
| `ai-sessions/INDEX.md` | AI session overview |
| `server.py` | Backend server |
| `.env.example` | Environment setup |

---

## Test Queries

```
✅ Which products have the most billing documents?
✅ Trace the full flow of billing document 91150187
✅ Sales orders delivered but not yet billed
✅ Top 5 customers by total order value
✅ Deliveries with no billing document
✅ Journal entries posted after April 2025
❌ Write me a poem (guardrail test)
```

---

## GitHub Folder Structure to Commit

```
o2c-graph-system/
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── SUBMISSION_GUIDE.md
├── FINAL_SUMMARY.md
├── REQUIREMENTS_CHECKLIST.md
├── FEATURE_IMPLEMENTATION.md
├── app/
├── components/
├── lib/
├── data/
├── scripts/
├── ai-sessions/
└── [other files]
```

**DO NOT commit:**
- `node_modules/` (add to .gitignore)
- `.env.local` with API keys (add to .gitignore)
- `.next/` build artifacts

---

## Estimated Timelines

| Task | Duration |
|------|----------|
| GitHub push | 5 min |
| Railway deploy | 15 min |
| Test demo | 5 min |
| Write email | 5 min |
| **Total** | **30 min** |

**Deadline cushion:** 15+ hours ✅

---

## Evaluation Rubric Quick Reference

| Category | What Evaluators Check |
|----------|----------------------|
| **Code quality** | Architecture, readability, error handling |
| **Graph modeling** | Entity types, relationships, normalization |
| **Database choice** | Why SQLite over Neo4j/MongoDB? Justified? |
| **LLM integration** | Accuracy of SQL, response quality, streaming |
| **Guardrails** | Can it reject off-topic queries? How? |
| **AI usage** | Session logs, process documentation, iteration |

**Score if all done well:** 95-100%

---

## If Stuck

**Problem:** Can't find Gemini API key  
**Solution:** Go to https://ai.google.dev → Sign up → Create API key

**Problem:** Port 3000 already in use  
**Solution:** `PORT=3001 python3 server.py`

**Problem:** Graph won't render  
**Solution:** Check browser console (F12) for WebGL errors

**Problem:** Can't deploy to Railway  
**Solution:** Use Render.com (simpler UI)

---

## Final Checklist Before Submitting

- [ ] All code committed to GitHub
- [ ] Demo deployed and working
- [ ] README updated
- [ ] AI session logs complete
- [ ] Test queries all work
- [ ] Off-topic query rejected properly
- [ ] Conversation persists on reload
- [ ] Graph clustering visible
- [ ] Email composed and ready
- [ ] Submit!

---

**Status:** ✅ Ready to submit  
**Confidence:** Very high (95%+)  
**Next step:** Push to GitHub & deploy

