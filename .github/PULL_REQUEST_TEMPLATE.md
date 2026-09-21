## What changed

<!-- One or two sentences. What does this do, and why now? -->

## Checks

- [ ] `npm run lint && npm run typecheck && npm run format:check && npm run test` pass locally

### If the database schema changed

- [ ] Migration committed under `prisma/migrations/`
- [ ] Expand/contract respected — nothing is dropped in the same release that stops writing to it ([runbook §2](../docs/engineering/runbook.md))
- [ ] `npm run db:seed` still succeeds against a fresh local database

### If personal data is now collected, stored or shared

- [ ] Data category added to the privacy policy
- [ ] Retention period defined and added to the retention schedule
- [ ] Lawful basis identified (DPDP / GDPR)

### If a third-party script, font, CDN or SDK was added

- [ ] Cookie policy updated — the "we use no third-party scripts" claim is now false
- [ ] Consent category registered in `src/lib/consent.ts`, which is what makes the consent banner appear
- [ ] Sub-processor list updated

### If curriculum or SOP content changed

- [ ] Sources recorded with a real locator (a clause or section, not just a document title)
- [ ] Nothing reproduced verbatim from proprietary material — see `docs/legal/attribution-guide.md`
