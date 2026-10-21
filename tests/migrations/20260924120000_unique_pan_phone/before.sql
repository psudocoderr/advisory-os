-- Rows as the app stored them before PAN and mobile became fixed-format:
-- bare 10-digit mobiles, numbers already in E.164, a PAN typed in lower case
-- with spaces, and a prospect and client sharing one number (allowed: the
-- uniqueness is per table).
INSERT INTO users (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt")
VALUES ('u1', 'Advisor', 'advisor@migration.test', 'x', 'ADVISOR', true, now(), now());

INSERT INTO prospects (id, name, phone, source, "firstContactDate", stage, notes, "assignedToId", "createdAt", "updatedAt")
VALUES
  ('p1', 'Bare ten digits', '9876543210', 'REFERRAL', now(), 'LEAD', '', 'u1', now(), now()),
  ('p2', 'Already E.164, India', '+919812345678', 'REFERRAL', now(), 'LEAD', '', 'u1', now(), now()),
  ('p3', 'Already E.164, UK', '+447400123456', 'REFERRAL', now(), 'LEAD', '', 'u1', now(), now());

INSERT INTO clients (id, name, phone, pan, "kycStatus", aum, "onboardingDate", "assignedToId", "createdAt", "updatedAt")
VALUES
  ('c1', 'Lower-case padded PAN', '9898981122', ' abcde1234f ', 'PENDING', 100, now(), 'u1', now(), now()),
  ('c2', 'Same number as prospect p1', '9876543210', 'PQRSX2345L', 'PENDING', 100, now(), 'u1', now(), now());
