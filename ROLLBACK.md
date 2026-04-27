# Verification Cache — Rollback Instructions

## Trigger: "ROLLBACK CACHE NOW"

### Step 1: Disable Feature Flag (immediate — no redeploy)
In Vercel Dashboard → Settings → Environment Variables:
- Set `VERIFICATION_CACHE_ENABLED` to `false`
- Or delete the variable entirely

This instantly disables the cache. All requests go directly to Claude API.

### Step 2: Revert Git Changes
```bash
cd "/Users/Muath/Documents/New project 4/on_call_look_up 6"
git checkout main
git branch -D feature/verification-cache
# If already merged:
git revert <merge-commit-hash>
git push
```

### Step 3: Drop Supabase Table
Run in Supabase SQL Editor:
```sql
DROP TABLE IF EXISTS verification_cache;
```

### Step 4: Clean Up Vercel Environment
In Vercel Dashboard → Settings → Environment Variables:
- Remove `VERIFICATION_CACHE_ENABLED`

### Step 5: Verify
- Hard refresh the app (Cmd+Shift+R)
- Upload a Medicine On-Call PDF
- Confirm Claude API is called (check Vercel function logs)
- Confirm no errors in browser console
