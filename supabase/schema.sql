-- ============================================================
-- MJASSIST — Sistema de gestión MJ Importaciones
-- Schema completo para Supabase (PostgreSQL 15+)
-- Pegar entero en: Supabase > SQL Editor > New query > Run
-- Creado por mjimportaciones
-- ============================================================

-- ---------- ENUMS ----------
create type tipo_cliente as enum ('FINAL', 'REVENDEDOR', 'MAYORISTA');
create type canal_precio as enum ('MINORISTA', 'REVENDEDOR', 'MAYORISTA');
create type tipo_movimiento as enum (
  'VENTA', 'COMPRA', 'TRASLADO_CONSIGNACION',
  'DEVOLUCION_CONSIGNACION', 'AJUSTE', 'RESERVA', 'LIBERACION_RESERVA'
);
create type estado_entrega as enum ('PENDIENTE', 'ENTREGADO', 'PUNTO_ENCUENTRO', 'ENVIO');
create type tipo_pago as enum ('PAGO', 'SENA', 'RENDICION_REVENDEDOR');
create type canal_origen as enum ('PWA', 'TELEGRAM');
create type estado_reserva as enum ('PENDIENTE', 'ENTREGADA', 'CANCELADA');

-- ---------- TABLAS ----------
create table usuarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rol text not null default 'OPERADOR', -- ADMIN | OPERADOR
  telegram_chat_id bigint unique,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  alias text,
  telefono text,
  instagram text,
  tipo tipo_cliente not null default 'FINAL',
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_clientes_tipo on clientes(tipo);

create table productos (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  nombre text not null,
  marca text,
  stock_minimo integer not null default 3,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Histórico de precios: el precio vigente es el de mayor vigente_desde <= now()
create table precios (
  id bigint generated always as identity primary key,
  producto_id uuid not null references productos(id) on delete cascade,
  canal canal_precio not null,
  precio_ars numeric(12,2) not null check (precio_ars >= 0),
  vigente_desde timestamptz not null default now()
);
create index idx_precios_lookup on precios(producto_id, canal, vigente_desde desc);

-- Ubicaciones de stock: Central + una por revendedor
create table ubicaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cliente_id uuid unique references clientes(id) on delete restrict, -- null = depósito propio
  es_central boolean not null default false
);

-- Única fuente de verdad del inventario.
-- Stock en una ubicación = SUM(entradas como destino) - SUM(salidas como origen)
create table movimientos_stock (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  producto_id uuid not null references productos(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  origen_id uuid references ubicaciones(id),
  destino_id uuid references ubicaciones(id),
  tipo tipo_movimiento not null,
  usuario_id uuid references usuarios(id),
  referencia text, -- id de venta/compra/reserva asociada
  notas text,
  check (origen_id is not null or destino_id is not null)
);
create index idx_movs_producto on movimientos_stock(producto_id);
create index idx_movs_origen on movimientos_stock(origen_id);
create index idx_movs_destino on movimientos_stock(destino_id);

create table ventas (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  usuario_id uuid references usuarios(id),
  cliente_id uuid not null references clientes(id),
  canal canal_precio not null default 'MINORISTA',
  estado_entrega estado_entrega not null default 'ENTREGADO',
  total_ars numeric(12,2) not null default 0,
  canal_origen canal_origen not null default 'PWA',
  notas text,
  fecha_estimada date,
  fecha_entrega timestamptz
);
create index idx_ventas_fecha on ventas(fecha desc);
create index idx_ventas_cliente on ventas(cliente_id);

create table venta_detalles (
  id bigint generated always as identity primary key,
  venta_id uuid not null references ventas(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null
);
create index idx_vdet_venta on venta_detalles(venta_id);

-- Cuenta corriente: saldo cliente = SUM(ventas.total_ars) - SUM(pagos.monto)
create table pagos (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  cliente_id uuid not null references clientes(id),
  venta_id uuid references ventas(id), -- opcional: para atar señas a una venta/reserva
  monto numeric(12,2) not null check (monto > 0),
  medio_pago text not null, -- 'Efectivo' | 'Transferencia Joaco' | 'Transferencia Meli' | ...
  tipo tipo_pago not null default 'PAGO',
  usuario_id uuid references usuarios(id),
  canal_origen canal_origen not null default 'PWA',
  notas text
);
create index idx_pagos_cliente on pagos(cliente_id);
create index idx_pagos_fecha on pagos(fecha desc);

-- Entregas en consignación (precio congelado al remito)
create table consignaciones (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  revendedor_id uuid not null references clientes(id),
  usuario_id uuid references usuarios(id),
  canal_origen canal_origen not null default 'PWA',
  notas text
);

create table consignacion_detalles (
  id bigint generated always as identity primary key,
  consignacion_id uuid not null references consignaciones(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null -- congelado al momento de la entrega
);
create index idx_cdet_consig on consignacion_detalles(consignacion_id);

create table compras (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  proveedor text,
  total_usd numeric(12,2) not null default 0,
  tipo_cambio numeric(12,2) not null default 0,
  total_ars numeric(14,2) not null default 0,
  usuario_id uuid references usuarios(id),
  notas text
);

create table compra_detalles (
  id bigint generated always as identity primary key,
  compra_id uuid not null references compras(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad integer not null check (cantidad > 0),
  costo_unitario_usd numeric(12,2) not null default 0
);

create table reservas (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  cliente_id uuid not null references clientes(id),
  fecha_estimada date,
  estado estado_reserva not null default 'PENDIENTE',
  usuario_id uuid references usuarios(id),
  notas text
);

create table reserva_detalles (
  id bigint generated always as identity primary key,
  reserva_id uuid not null references reservas(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null default 0
);

-- Borradores del bot de Telegram pendientes de confirmación
create table bot_drafts (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- Template configurable del mensaje de stock para WhatsApp
create table configuracion (
  clave text primary key,
  valor text not null
);
insert into configuracion (clave, valor) values
('whatsapp_template', E'🔥 *STOCK ACTUALIZADO MJ* 🔥\n\n{{lineas}}\n\n📲 Pedidos por DM o WhatsApp');

-- ---------- VISTAS ----------

-- Stock actual por producto y ubicación
create or replace view v_stock as
with movs as (
  select producto_id, destino_id as ubicacion_id, cantidad
  from movimientos_stock where destino_id is not null
  union all
  select producto_id, origen_id, -cantidad
  from movimientos_stock where origen_id is not null
)
select
  u.id  as ubicacion_id,
  u.nombre as ubicacion,
  u.es_central,
  u.cliente_id as revendedor_id,
  p.id  as producto_id,
  p.nombre as producto,
  p.stock_minimo,
  coalesce(sum(m.cantidad), 0)::int as cantidad
from ubicaciones u
cross join productos p
left join movs m on m.ubicacion_id = u.id and m.producto_id = p.id
where p.activo
group by u.id, u.nombre, u.es_central, u.cliente_id, p.id, p.nombre, p.stock_minimo;

-- Stock reservado por reservas pendientes
create or replace view v_stock_reservado as
select rd.producto_id, sum(rd.cantidad)::int as reservado
from reserva_detalles rd
join reservas r on r.id = rd.reserva_id
where r.estado = 'PENDIENTE'
group by rd.producto_id;

-- Saldo por cliente (positivo = te debe)
create or replace view v_saldo_clientes as
select
  c.id, c.nombre, c.alias, c.telefono, c.instagram, c.tipo, c.activo,
  coalesce(v.total_ventas, 0) as total_ventas,
  coalesce(p.total_pagos, 0) as total_pagos,
  coalesce(v.total_ventas, 0) - coalesce(p.total_pagos, 0) as saldo
from clientes c
left join (
  select cliente_id, sum(total_ars) as total_ventas from ventas group by cliente_id
) v on v.cliente_id = c.id
left join (
  select cliente_id, sum(monto) as total_pagos from pagos group by cliente_id
) p on p.cliente_id = c.id;

-- Precio vigente por producto y canal
create or replace view v_precio_vigente as
select distinct on (producto_id, canal)
  producto_id, canal, precio_ars, vigente_desde
from precios
where vigente_desde <= now()
order by producto_id, canal, vigente_desde desc;

-- ---------- FUNCIONES ----------

-- Precio vigente (con fallback a MINORISTA)
create or replace function fn_precio_vigente(p_producto uuid, p_canal canal_precio)
returns numeric language sql stable as $$
  select coalesce(
    (select precio_ars from v_precio_vigente where producto_id = p_producto and canal = p_canal),
    (select precio_ars from v_precio_vigente where producto_id = p_producto and canal = 'MINORISTA'),
    0
  );
$$;

-- Asegura que exista la ubicación de stock de un revendedor
create or replace function fn_ubicacion_revendedor(p_cliente uuid)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from ubicaciones where cliente_id = p_cliente;
  if v_id is null then
    insert into ubicaciones (nombre, cliente_id, es_central)
    select 'Stock ' || nombre, id, false from clientes where id = p_cliente
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- REGISTRAR VENTA (transaccional): cabecera + detalles + stock + pago inicial opcional
-- p_items: [{"producto_id":"uuid","cantidad":2,"precio_unitario":24000}]
--          (si precio_unitario es null usa el vigente del canal)
create or replace function registrar_venta(
  p_cliente uuid,
  p_usuario uuid,
  p_canal canal_precio,
  p_estado_entrega estado_entrega,
  p_canal_origen canal_origen,
  p_items jsonb,
  p_pago_inicial numeric default 0,
  p_medio_pago text default null,
  p_notas text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_venta uuid;
  v_total numeric := 0;
  v_central uuid;
  it jsonb;
  v_precio numeric;
  v_prod uuid;
  v_cant int;
begin
  select id into v_central from ubicaciones where es_central limit 1;
  if v_central is null then raise exception 'No existe ubicación Central'; end if;

  insert into ventas (usuario_id, cliente_id, canal, estado_entrega, canal_origen, notas)
  values (p_usuario, p_cliente, p_canal, p_estado_entrega, p_canal_origen, p_notas)
  returning id into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_cant := (it->>'cantidad')::int;
    v_precio := coalesce((it->>'precio_unitario')::numeric, fn_precio_vigente(v_prod, p_canal));

    insert into venta_detalles (venta_id, producto_id, cantidad, precio_unitario)
    values (v_venta, v_prod, v_cant, v_precio);

    insert into movimientos_stock (producto_id, cantidad, origen_id, tipo, usuario_id, referencia)
    values (v_prod, v_cant, v_central, 'VENTA', p_usuario, v_venta::text);

    v_total := v_total + (v_precio * v_cant);
  end loop;

  update ventas set total_ars = v_total where id = v_venta;

  if coalesce(p_pago_inicial, 0) > 0 then
    insert into pagos (cliente_id, venta_id, monto, medio_pago, tipo, usuario_id, canal_origen)
    values (p_cliente, v_venta, p_pago_inicial, coalesce(p_medio_pago, 'Efectivo'),
            case when p_pago_inicial >= v_total then 'PAGO'::tipo_pago else 'SENA'::tipo_pago end,
            p_usuario, p_canal_origen);
  end if;

  return v_venta;
end $$;

-- REGISTRAR ENTREGA EN CONSIGNACIÓN: precio congelado + traslado de stock
-- p_items: [{"producto_id":"uuid","cantidad":3,"precio_unitario":22000}]
create or replace function registrar_consignacion(
  p_revendedor uuid,
  p_usuario uuid,
  p_canal_origen canal_origen,
  p_items jsonb,
  p_notas text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_consig uuid;
  v_central uuid;
  v_ubic uuid;
  it jsonb;
  v_precio numeric;
  v_prod uuid;
  v_cant int;
begin
  select id into v_central from ubicaciones where es_central limit 1;
  v_ubic := fn_ubicacion_revendedor(p_revendedor);

  insert into consignaciones (revendedor_id, usuario_id, canal_origen, notas)
  values (p_revendedor, p_usuario, p_canal_origen, p_notas)
  returning id into v_consig;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_cant := (it->>'cantidad')::int;
    v_precio := coalesce((it->>'precio_unitario')::numeric, fn_precio_vigente(v_prod, 'REVENDEDOR'));

    insert into consignacion_detalles (consignacion_id, producto_id, cantidad, precio_unitario)
    values (v_consig, v_prod, v_cant, v_precio);

    insert into movimientos_stock (producto_id, cantidad, origen_id, destino_id, tipo, usuario_id, referencia)
    values (v_prod, v_cant, v_central, v_ubic, 'TRASLADO_CONSIGNACION', p_usuario, v_consig::text);
  end loop;

  return v_consig;
end $$;

-- REGISTRAR RENDICIÓN DE REVENDEDOR (operación única):
-- vendidas (genera venta al precio congelado + saca stock del revendedor),
-- devueltas (vuelven a Central) y pago opcional, todo junto.
-- p_items: [{"producto_id":"uuid","vendidas":2,"devueltas":1}]
create or replace function registrar_rendicion(
  p_revendedor uuid,
  p_usuario uuid,
  p_canal_origen canal_origen,
  p_items jsonb,
  p_monto_pago numeric default 0,
  p_medio_pago text default null,
  p_notas text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_venta uuid;
  v_total numeric := 0;
  v_central uuid;
  v_ubic uuid;
  it jsonb;
  v_prod uuid;
  v_vend int;
  v_dev int;
  v_precio numeric;
  v_hay_vendidas boolean := false;
begin
  select id into v_central from ubicaciones where es_central limit 1;
  v_ubic := fn_ubicacion_revendedor(p_revendedor);

  -- ¿Hay unidades vendidas? -> cabecera de venta canal REVENDEDOR
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce((it->>'vendidas')::int, 0) > 0 then v_hay_vendidas := true; end if;
  end loop;

  if v_hay_vendidas then
    insert into ventas (usuario_id, cliente_id, canal, estado_entrega, canal_origen, notas)
    values (p_usuario, p_revendedor, 'REVENDEDOR', 'ENTREGADO', p_canal_origen,
            coalesce(p_notas, 'Rendición de consignación'))
    returning id into v_venta;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_vend := coalesce((it->>'vendidas')::int, 0);
    v_dev  := coalesce((it->>'devueltas')::int, 0);

    if v_vend > 0 then
      -- precio congelado: última entrega en consignación de ese producto a ese revendedor
      select cd.precio_unitario into v_precio
      from consignacion_detalles cd
      join consignaciones c on c.id = cd.consignacion_id
      where c.revendedor_id = p_revendedor and cd.producto_id = v_prod
      order by c.fecha desc limit 1;
      v_precio := coalesce(v_precio, fn_precio_vigente(v_prod, 'REVENDEDOR'));

      insert into venta_detalles (venta_id, producto_id, cantidad, precio_unitario)
      values (v_venta, v_prod, v_vend, v_precio);

      insert into movimientos_stock (producto_id, cantidad, origen_id, tipo, usuario_id, referencia)
      values (v_prod, v_vend, v_ubic, 'VENTA', p_usuario, v_venta::text);

      v_total := v_total + (v_precio * v_vend);
    end if;

    if v_dev > 0 then
      insert into movimientos_stock (producto_id, cantidad, origen_id, destino_id, tipo, usuario_id, notas)
      values (v_prod, v_dev, v_ubic, v_central, 'DEVOLUCION_CONSIGNACION', p_usuario, p_notas);
    end if;
  end loop;

  if v_hay_vendidas then
    update ventas set total_ars = v_total where id = v_venta;
  end if;

  if coalesce(p_monto_pago, 0) > 0 then
    insert into pagos (cliente_id, venta_id, monto, medio_pago, tipo, usuario_id, canal_origen)
    values (p_revendedor, v_venta, p_monto_pago, coalesce(p_medio_pago, 'Efectivo'),
            'RENDICION_REVENDEDOR', p_usuario, p_canal_origen);
  end if;

  return coalesce(v_venta, gen_random_uuid());
end $$;

-- AJUSTE MANUAL DE STOCK (reemplaza las filas "stock viejo" del Sheets)
create or replace function registrar_ajuste(
  p_producto uuid,
  p_cantidad int,           -- positivo suma, negativo resta
  p_usuario uuid,
  p_motivo text
) returns void language plpgsql security definer set search_path = public as $$
declare v_central uuid;
begin
  select id into v_central from ubicaciones where es_central limit 1;
  if p_cantidad > 0 then
    insert into movimientos_stock (producto_id, cantidad, destino_id, tipo, usuario_id, notas)
    values (p_producto, p_cantidad, v_central, 'AJUSTE', p_usuario, p_motivo);
  elsif p_cantidad < 0 then
    insert into movimientos_stock (producto_id, cantidad, origen_id, tipo, usuario_id, notas)
    values (p_producto, abs(p_cantidad), v_central, 'AJUSTE', p_usuario, p_motivo);
  end if;
end $$;

-- REGISTRAR COMPRA EN USD: cabecera + detalles + entrada de stock a Central
-- p_items: [{"producto_id":"uuid","cantidad":60,"costo_unitario_usd":10.04}]
create or replace function registrar_compra(
  p_proveedor text,
  p_tipo_cambio numeric,
  p_usuario uuid,
  p_items jsonb,
  p_notas text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_compra uuid;
  v_central uuid;
  it jsonb;
  v_total_usd numeric := 0;
begin
  select id into v_central from ubicaciones where es_central limit 1;

  insert into compras (proveedor, tipo_cambio, usuario_id, notas)
  values (p_proveedor, p_tipo_cambio, p_usuario, p_notas)
  returning id into v_compra;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into compra_detalles (compra_id, producto_id, cantidad, costo_unitario_usd)
    values (v_compra, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
            coalesce((it->>'costo_unitario_usd')::numeric, 0));

    insert into movimientos_stock (producto_id, cantidad, destino_id, tipo, usuario_id, referencia)
    values ((it->>'producto_id')::uuid, (it->>'cantidad')::int, v_central, 'COMPRA', p_usuario, v_compra::text);

    v_total_usd := v_total_usd + coalesce((it->>'costo_unitario_usd')::numeric, 0) * (it->>'cantidad')::int;
  end loop;

  update compras set total_usd = v_total_usd, total_ars = v_total_usd * p_tipo_cambio
  where id = v_compra;

  return v_compra;
end $$;

-- ---------- RLS ----------
-- ⚠️ Política permisiva para herramienta interna (la PWA usa la anon key).
-- Cuando sumes Supabase Auth, reemplazá estas políticas por unas por usuario.
do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','clientes','productos','precios','ubicaciones','movimientos_stock',
    'ventas','venta_detalles','pagos','consignaciones','consignacion_detalles',
    'compras','compra_detalles','reservas','reserva_detalles','bot_drafts','configuracion'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy acceso_interno on %I for all to anon, authenticated using (true) with check (true)', t
    );
  end loop;
end $$;

-- ---------- SEEDS ----------
insert into usuarios (nombre, rol) values
  ('Fernando', 'ADMIN'),
  ('Joaco', 'OPERADOR'),
  ('Meli', 'OPERADOR');

insert into ubicaciones (nombre, es_central) values ('Central', true);

-- Catálogo inicial (tomado de tu Sheets; editá/sumá desde la PWA)
insert into productos (nombre, marca) values
  ('Grape Ice', 'Elfbar'),
  ('Cherry Fuse', 'Elfbar'),
  ('Miami Mint', 'Elfbar'),
  ('Strawberry Watermelon', 'Elfbar'),
  ('Watermelon Ice', 'Elfbar'),
  ('Strawberry Ice', 'Elfbar'),
  ('Green Apple Ice', 'Elfbar'),
  ('Baja Splash', 'Elfbar'),
  ('Dragon Strawnana', 'Elfbar'),
  ('Summer Splash', 'Elfbar'),
  ('Double Apple Ice', 'Elfbar'),
  ('Mighty Melon + Menthol', 'Elfbar'),
  ('Grape Ice + Strawberry', 'Elfbar'),
  ('Watermelon Ice + Cherry Ice', 'Elfbar'),
  ('Peach Watermelon Ice + Mango Ice', 'Elfbar'),
  ('Ignite V-Mix 40K', 'Ignite');

-- Precios iniciales por canal para todo el catálogo
insert into precios (producto_id, canal, precio_ars)
select id, 'MINORISTA'::canal_precio, 25000 from productos;
insert into precios (producto_id, canal, precio_ars)
select id, 'REVENDEDOR'::canal_precio, 22000 from productos;
insert into precios (producto_id, canal, precio_ars)
select id, 'MAYORISTA'::canal_precio, 21000 from productos;

-- ============================================================
-- FIN DEL SCHEMA
-- ============================================================
