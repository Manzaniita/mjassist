-- Migración: agregar columnas de fecha de entrega a ventas
-- Ejecutar en Supabase > SQL Editor si ya tenés la base creada

alter table ventas add column if not exists fecha_estimada date;
alter table ventas add column if not exists fecha_entrega timestamptz;
