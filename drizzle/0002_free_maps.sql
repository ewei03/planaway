-- Places now come from OpenStreetMap and Wikimedia instead of Google, with a
-- different shape. Drop cached Google lookups; they're refetched as needed.
DELETE FROM "place_cache";
