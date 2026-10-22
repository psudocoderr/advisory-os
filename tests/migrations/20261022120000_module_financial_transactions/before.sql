-- Production's shape: the track renamed to "foundations" and a third module
-- added after Operational Excellence, so Module 2 must go after the last one.
-- A second track without Operational Excellence must be left alone.
UPDATE tracks SET slug = 'foundations', title = 'Foundations' WHERE id = 'track_operational_excellence';

INSERT INTO modules (id, "trackId", slug, title, "order", "updatedAt")
VALUES ('m_extra', 'track_operational_excellence', 'extra', 'Extra', 5, now());

INSERT INTO tracks (id, slug, title, "order", "updatedAt") VALUES ('t_other', 'other', 'Other', 2, now());
INSERT INTO modules (id, "trackId", slug, title, "order", "updatedAt")
VALUES ('m_other', 't_other', 'other', 'Other', 1, now());
