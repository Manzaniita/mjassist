-- ============================================================
-- MIGRACIÓN: soporte para importación CSV de productos
-- Agrega campo costo a productos para guardar el costo de compra.
-- ============================================================

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS costo NUMERIC DEFAULT NULL;
