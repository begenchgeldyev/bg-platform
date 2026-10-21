UPDATE "projects" AS p
SET "tags" = ARRAY(
      SELECT btrim(t.tag)
      FROM unnest(string_to_array(regexp_replace(s.m[1], '\.\s*$', ''), ',')) WITH ORDINALITY AS t(tag, ord)
      WHERE btrim(t.tag) <> ''
      ORDER BY t.ord
    ),
    "content" = NULLIF(btrim(regexp_replace(p."content", '<p>\s*Stack:[^<]*</p>', '', 'i')), '')
FROM (SELECT "id", regexp_match("content", '<p>\s*Stack:\s*([^<]*)</p>', 'i') AS m FROM "projects") AS s
WHERE p."id" = s."id" AND s.m IS NOT NULL AND cardinality(p."tags") = 0;
