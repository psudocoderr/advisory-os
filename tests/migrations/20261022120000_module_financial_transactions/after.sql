-- Financial Transactions follows the last module of the Operational Excellence track, once
SELECT array_agg(slug || ':' || "order" ORDER BY "order")
     = ARRAY['operational-excellence:1', 'extra:5', 'financial-transactions:6'] AS ok,
       array_agg(slug || ':' || "order" ORDER BY "order") AS detail
FROM modules WHERE "trackId" = 'track_operational_excellence';

-- its title, and no description
SELECT count(*) = 1 AS ok, count(*) AS detail
FROM modules WHERE slug = 'financial-transactions' AND title = 'Financial Transactions' AND description = '';

-- the other track is untouched
SELECT array_agg(slug) = ARRAY['other'] AS ok, array_agg(slug) AS detail
FROM modules WHERE "trackId" = 't_other';
