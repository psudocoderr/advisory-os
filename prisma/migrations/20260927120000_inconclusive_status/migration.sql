-- A test session that ended too uncertain to pass or fail (flags.md D2).
-- Additive: code already deployed never writes it. The code that does ships
-- in a later release, after this has been applied.
ALTER TYPE "TestSessionStatus" ADD VALUE 'INCONCLUSIVE';
