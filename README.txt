Liyaqa Interactive Workout Upgrade

Files included:
- index.html
- app.js
- styles.css
- manifest.json
- sw.js
- config.js
- workout_sessions.sql

What changed:
- Interactive workout player
- Start / pause / complete / cancel workout session
- Session saving to Supabase if workout_sessions table exists
- Automatic local-storage fallback if the table does not exist yet
- Recent workout sessions panel
- Dashboard summary adds completed sessions and active minutes

Recommended:
1. Keep your existing working config.js if it already contains the real Supabase values.
2. Replace index.html, app.js, styles.css, manifest.json, sw.js.
3. Run workout_sessions.sql in Supabase SQL Editor to enable DB saving for workout sessions.
