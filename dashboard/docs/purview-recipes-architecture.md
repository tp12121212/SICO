# Purview Recipes Architecture Note (Phase 1)

Current phase intentionally uses local seed data with a repository boundary:

- `src/features/purview-recipes/repositories/*`
- `src/features/purview-recipes/types/*`
- `src/features/purview-recipes/seed/*`
- `src/data/sit/patterns.json`

This supports deterministic UI development now while keeping a clean migration path to database/API-backed storage later.

## Future-ready direction

Recommended future storage: database-backed service (plus API) because planned scope includes:

- anonymous/public recipe browsing
- authenticated contributor submissions
- moderation workflow
- premium/private recipe catalogs and entitlements
- version history and search/indexing

## Migration path

1. Keep page/UI contracts stable (`NormalizedSitPattern`, `DlpRuleRecord`).
2. Replace repository internals to fetch from API/DB rather than local JSON/seed.
3. Add auth and entitlements at API boundary (not in page components).
4. Add moderation/status fields and revision history tables without breaking route structure.

No auth/payment flows are implemented in this phase.
