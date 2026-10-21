-- bare Indian mobiles gain +91, E.164 numbers are left alone
SELECT array_agg(phone::text ORDER BY id) = ARRAY['+919876543210', '+919812345678', '+447400123456']::text[] AS ok,
       array_agg(phone::text ORDER BY id) AS detail
FROM prospects;

-- client mobiles gain +91 too
SELECT array_agg(phone::text ORDER BY id) = ARRAY['+919898981122', '+919876543210']::text[] AS ok,
       array_agg(phone::text ORDER BY id) AS detail
FROM clients;

-- PAN is trimmed and upper-cased
SELECT pan::text = 'ABCDE1234F' AS ok, pan AS detail FROM clients WHERE id = 'c1';

-- every row survives the whole chain, still linked to its advisor
SELECT (SELECT count(*) FROM prospects WHERE "assignedToId" = 'u1') = 3
   AND (SELECT count(*) FROM clients WHERE "assignedToId" = 'u1') = 2 AS ok;
