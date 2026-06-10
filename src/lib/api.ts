import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || ''
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

if (!supabaseUrl || !supabaseKey) {
  console.error('[MJ Assist] Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY en las variables de entorno de Vercel.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// ---------- Tipos ----------
export interface Usuario { id: string; nombre: string; rol: string }
export interface Cliente {
  id: string; nombre: string; alias: string | null; telefono: string | null
  instagram: string | null; tipo: 'FINAL' | 'REVENDEDOR' | 'MAYORISTA'
  notas: string | null; activo: boolean
}
export interface SaldoCliente extends Cliente {
  total_ventas: number; total_pagos: number; saldo: number
}
export interface Producto {
  id: string; nombre: string; marca: string | null; sku: string | null
  stock_minimo: number; activo: boolean
}
export interface PrecioVigente { producto_id: string; canal: string; precio_ars: number }
export interface StockRow {
  ubicacion_id: string; ubicacion: string; es_central: boolean
  revendedor_id: string | null; producto_id: string; producto: string
  stock_minimo: number; cantidad: number
}
export interface Venta {
  id: string; fecha: string; usuario_id: string | null; cliente_id: string
  canal: string; estado_entrega: string; total_ars: number
  canal_origen: string; notas: string | null
  clientes?: { nombre: string }
  usuarios?: { nombre: string } | null
  venta_detalles?: { cantidad: number; precio_unitario: number; productos: { nombre: string } }[]
  pagos?: { monto: number }[]
}
export interface Pago {
  id: string; fecha: string; cliente_id: string; venta_id: string | null
  monto: number; medio_pago: string; tipo: string
}

export interface ItemVenta { producto_id: string; cantidad: number; precio_unitario: number | null }

// ---------- Services ----------
export async function getUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase.from('usuarios').select('id,nombre,rol').eq('activo', true).order('nombre')
  if (error) throw error
  return data
}

export async function getClientes(): Promise<SaldoCliente[]> {
  const { data, error } = await supabase.from('v_saldo_clientes').select('*').eq('activo', true).order('nombre')
  if (error) throw error
  return data
}

export async function crearCliente(c: Partial<Cliente>): Promise<Cliente> {
  const { data, error } = await supabase.from('clientes').insert(c).select().single()
  if (error) throw error
  return data
}

export async function getProductos(): Promise<Producto[]> {
  const { data, error } = await supabase.from('productos').select('*').eq('activo', true).order('nombre')
  if (error) throw error
  return data
}

export async function getPreciosVigentes(): Promise<PrecioVigente[]> {
  const { data, error } = await supabase.from('v_precio_vigente').select('*')
  if (error) throw error
  return data
}

export async function getStock(): Promise<StockRow[]> {
  const { data, error } = await supabase.from('v_stock').select('*').order('producto')
  if (error) throw error
  return data
}

export async function getReservado(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('v_stock_reservado').select('*')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r: any) => [r.producto_id, r.reservado]))
}

export interface FiltroVentas {
  desde?: string; hasta?: string; cliente_id?: string; texto?: string
}
export async function getVentas(f: FiltroVentas = {}): Promise<Venta[]> {
  let q = supabase
    .from('ventas')
    .select('*, clientes(nombre), usuarios(nombre), venta_detalles(cantidad, precio_unitario, productos(nombre)), pagos(monto)')
    .order('fecha', { ascending: false })
    .limit(200)
  if (f.desde) q = q.gte('fecha', f.desde)
  if (f.hasta) q = q.lte('fecha', f.hasta + 'T23:59:59')
  if (f.cliente_id) q = q.eq('cliente_id', f.cliente_id)
  const { data, error } = await q
  if (error) throw error
  return data as unknown as Venta[]
}

export async function registrarVenta(params: {
  cliente_id: string; usuario_id: string; canal: string; estado_entrega: string
  items: ItemVenta[]; pago_inicial: number; medio_pago: string | null; notas?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_venta', {
    p_cliente: params.cliente_id,
    p_usuario: params.usuario_id,
    p_canal: params.canal,
    p_estado_entrega: params.estado_entrega,
    p_canal_origen: 'PWA',
    p_items: params.items,
    p_pago_inicial: params.pago_inicial,
    p_medio_pago: params.medio_pago,
    p_notas: params.notas ?? null,
  })
  if (error) throw error
  return data
}

export async function registrarPago(params: {
  cliente_id: string; monto: number; medio_pago: string; usuario_id: string
  tipo?: string; venta_id?: string | null; notas?: string
}): Promise<void> {
  const { error } = await supabase.from('pagos').insert({
    cliente_id: params.cliente_id,
    monto: params.monto,
    medio_pago: params.medio_pago,
    usuario_id: params.usuario_id,
    tipo: params.tipo ?? 'PAGO',
    venta_id: params.venta_id ?? null,
    canal_origen: 'PWA',
    notas: params.notas ?? null,
  })
  if (error) throw error
}

export async function getMovimientosCliente(cliente_id: string): Promise<{ ventas: Venta[]; pagos: Pago[] }> {
  const [v, p] = await Promise.all([
    supabase
      .from('ventas')
      .select('*, venta_detalles(cantidad, precio_unitario, productos(nombre))')
      .eq('cliente_id', cliente_id)
      .order('fecha', { ascending: false }),
    supabase.from('pagos').select('*').eq('cliente_id', cliente_id).order('fecha', { ascending: false }),
  ])
  if (v.error) throw v.error
  if (p.error) throw p.error
  return { ventas: v.data as unknown as Venta[], pagos: p.data as Pago[] }
}

export async function registrarConsignacion(params: {
  revendedor_id: string; usuario_id: string
  items: { producto_id: string; cantidad: number; precio_unitario: number | null }[]
  notas?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_consignacion', {
    p_revendedor: params.revendedor_id,
    p_usuario: params.usuario_id,
    p_canal_origen: 'PWA',
    p_items: params.items,
    p_notas: params.notas ?? null,
  })
  if (error) throw error
  return data
}

export async function registrarRendicion(params: {
  revendedor_id: string; usuario_id: string
  items: { producto_id: string; vendidas: number; devueltas: number }[]
  monto_pago: number; medio_pago: string | null; notas?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_rendicion', {
    p_revendedor: params.revendedor_id,
    p_usuario: params.usuario_id,
    p_canal_origen: 'PWA',
    p_items: params.items,
    p_monto_pago: params.monto_pago,
    p_medio_pago: params.medio_pago,
    p_notas: params.notas ?? null,
  })
  if (error) throw error
  return data
}

export async function registrarAjuste(producto_id: string, cantidad: number, usuario_id: string, motivo: string) {
  const { error } = await supabase.rpc('registrar_ajuste', {
    p_producto: producto_id, p_cantidad: cantidad, p_usuario: usuario_id, p_motivo: motivo,
  })
  if (error) throw error
}

export async function getPagosRango(desde: string, hasta: string): Promise<Pago[]> {
  const { data, error } = await supabase
    .from('pagos').select('*')
    .gte('fecha', desde).lte('fecha', hasta + 'T23:59:59')
    .order('fecha', { ascending: false })
  if (error) throw error
  return data
}

export async function getTemplateWhatsapp(): Promise<string> {
  const { data } = await supabase.from('configuracion').select('valor').eq('clave', 'whatsapp_template').single()
  return data?.valor ?? '🔥 *STOCK ACTUALIZADO MJ* 🔥\n\n{{lineas}}'
}
export async function setTemplateWhatsapp(valor: string) {
  await supabase.from('configuracion').upsert({ clave: 'whatsapp_template', valor })
}

// ---------- Helpers ----------
export const fmtARS = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

export const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export const MEDIOS_PAGO = ['Efectivo', 'Transferencia Joaco', 'Transferencia Meli', 'USDT', 'Otro']
