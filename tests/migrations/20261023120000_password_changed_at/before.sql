-- Accounts as they exist before the column: an admin and an advisor.
INSERT INTO users (id, email, name, "passwordHash", role, "updatedAt")
VALUES ('u_admin', 'admin@test.local', 'Admin', 'x', 'ADMIN', now()),
       ('u_advisor', 'advisor@test.local', 'Advisor', 'x', 'ADVISOR', now());
