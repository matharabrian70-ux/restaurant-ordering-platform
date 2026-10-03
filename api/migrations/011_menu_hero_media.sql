-- Hero media for the customer-facing Today's Special carousel.
-- Kept on the product so the manager can use a dedicated high-resolution
-- 16:9 image without replacing the square/card image.
alter table products add column if not exists hero_image_url text;
