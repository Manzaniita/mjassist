import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getClientes, getProductos, getPreciosVigentes, getStock, registrarVenta, crearCliente, getCanalesPrecio,
  fmtARS, MEDIOS_PAGO, SaldoCliente, Producto, StockRow, CanalPrecio,
} from '../lib/api'
import { useApp } from '../main'

interface Linea { producto: Producto; cantidad: number; precio: number }

export default function NuevaVenta() {
  const { operador, toast } = useApp()
  const nav = useNavigate()
  const [clientes, setClientes] = useState<SaldoCliente[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [precios, setPrecios] = useState<Record<string, Record<string, number>>>({})
  const [stockCentral, setStockCentral] = useState<Record<string, number>>({})

  const [busCliente, setBusCliente] = useState('')
  const [cliente, setCliente] = useState<SaldoCliente | null>(null)
  const [busProd, setBusProd] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [canales, setCanales] = useState<CanalPrecio[]>([])
  const [canal, setCanal] = useState<string>('')
  const [entrega, setEntrega] = useState('ENTREGADO')
  const [fechaEstimada, setFechaEstimada] = useState('')
  const [pagoInicial, setPagoInicial] = useState('')
  const [medioPago, setMedioPago] = useState(MEDIOS_PAGO[0])
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    Promise.all([getClientes(), getProductos(), getPreciosVigentes(), getStock(), getCanalesPrecio()]).then(
      ([cs, ps, pv, st, cn]) => {
        setClientes(cs)
        setProductos(ps)
        setCanales(cn)
        if (cn.length) setCanal(cn[0].nombre)
        const map: Record<string, Record<string, number>> = {}
        pv.forEach((p) => {
          map[p.producto_id] = map[p.producto_id] ?? {}
          map[p.producto_id][p.canal] = Number(p.precio_ars)
        })
        setPrecios(map)
        setStockCentral(Object.fromEntries(
          st.filter((s: StockRow) => s.es_central).map((s) => [s.producto_id, s.cantidad])
        ))
      }
    )
  }, [])

  const precioDe = (prodId: string) => {
    const first = canales[0]?.nombre ?? ''
    return precios[prodId]?.[canal] ?? precios[prodId]?.[first] ?? 0
  }

  // Al cambiar canal, repreciar líneas que usaban precio de lista
  useEffect(() => {
    setLineas((ls) => ls.map((l) => ({ ...l, precio: precioDe(l.producto.id) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, precios])

  const clientesFiltrados = useMemo(() => {
    const t = busCliente.toLowerCase()
    if (!t) return clientes.slice(0, 6)
    return clientes.filter((c) =>
      [c.nombre, c.alias, c.instagram].join(' ').toLowerCase().includes(t)
    ).slice(0, 8)
  }, [clientes, busCliente])

  const prodsFiltrados = useMemo(() => {
    const t = busProd.toLowerCase()
    const enCarrito = new Set(lineas.map((l) => l.producto.id))
    return productos
      .filter((p) => !enCarrito.has(p.id) && p.nombre.toLowerCase().includes(t))
      .slice(0, 8)
  }, [productos, busProd, lineas])

  const agregar = (p: Producto) => {
    setLineas([...lineas, { producto: p, cantidad: 1, precio: precioDe(p.id) }])
    setBusProd('')
  }
  const setCant = (i: number, d: number) => {
    setLineas((ls) =>
      ls.map((l, j) => (j === i ? { ...l, cantidad: Math.max(1, l.cantidad + d) } : l))
    )
  }
  const setPrecio = (i: number, v: string) => {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, precio: Number(v) || 0 } : l)))
  }
  const quitar = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i))

  const total = lineas.reduce((a, l) => a + l.cantidad * l.precio, 0)

  const guardar = async () => {
    if (!cliente || lineas.length === 0 || !operador) return
    setGuardando(true)
    try {
      await registrarVenta({
        cliente_id: cliente.id,
        usuario_id: operador.id,
        canal,
        estado_entrega: entrega,
        items: lineas.map((l) => ({
          producto_id: l.producto.id, cantidad: l.cantidad, precio_unitario: l.precio,
        })),
        pago_inicial: Number(pagoInicial) || 0,
        medio_pago: Number(pagoInicial) > 0 ? medioPago : null,
        fecha_estimada: entrega !== 'ENTREGADO' ? fechaEstimada || null : null,
      })
      toast('Venta registrada ✔')
      nav('/ventas')
    } catch (e: any) {
      toast('Error al guardar: ' + (e.message ?? e), true)
    } finally {
      setGuardando(false)
    }
  }

  const crearRapido = async () => {
    const nombre = busCliente.trim()
    if (!nombre) return
    try {
      const c = await crearCliente({ nombre })
      const sc = { ...c, total_ventas: 0, total_pagos: 0, saldo: 0 } as SaldoCliente
      setClientes([sc, ...clientes])
      setCliente(sc)
      setBusCliente('')
      toast(`Cliente "${nombre}" creado`)
    } catch (e: any) {
      toast('No se pudo crear el cliente', true)
    }
  }

  return (
    <>
      <h2 style={{ marginBottom: 10 }}>Nueva venta</h2>

      {/* PASO 1: cliente */}
      {!cliente ? (
        <div className="card">
          <label>Cliente</label>
          <input
            autoFocus
            placeholder="Tipeá 3 letras…"
            value={busCliente}
            onChange={(e) => setBusCliente(e.target.value)}
          />
          {clientesFiltrados.map((c) => (
            <div key={c.id} className="row list-tap" style={{ padding: '10px 2px', borderBottom: '1px solid var(--line)' }}
              onClick={() => setCliente(c)}>
              <div className="col">
                <span>{c.nombre}{c.alias ? ` (${c.alias})` : ''}</span>
                <span className="muted">{c.tipo}</span>
              </div>
              {c.saldo > 0 && <span className="badge warn">Debe {fmtARS(c.saldo)}</span>}
            </div>
          ))}
          {busCliente.trim() && clientesFiltrados.length === 0 && (
            <button className="btn block" style={{ marginTop: 10 }} onClick={crearRapido}>
              + Crear cliente "{busCliente.trim()}"
            </button>
          )}
        </div>
      ) : (
        <div className="card neon row">
          <div className="col">
            <strong>{cliente.nombre}</strong>
            {cliente.saldo > 0 && <span className="muted">Saldo previo: {fmtARS(cliente.saldo)}</span>}
          </div>
          <button className="btn sm" onClick={() => setCliente(null)}>Cambiar</button>
        </div>
      )}

      {/* PASO 2: productos */}
      {cliente && (
        <div className="card">
          <div className="row">
            <label style={{ margin: 0 }}>Productos</label>
            <select value={canal} onChange={(e) => setCanal(e.target.value)}
              style={{ width: 'auto', padding: '6px 8px', fontSize: '0.8rem' }}>
              {canales.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
            </select>
          </div>
          <input placeholder="Buscar sabor…" value={busProd} onChange={(e) => setBusProd(e.target.value)} style={{ margin: '8px 0' }} />
          <div className="chips">
            {prodsFiltrados.map((p) => (
              <button key={p.id} className="chip" onClick={() => agregar(p)}>
                + {p.nombre} {stockCentral[p.id] !== undefined && <span style={{ opacity: 0.6 }}>({stockCentral[p.id]})</span>}
              </button>
            ))}
          </div>

          {lineas.map((l, i) => (
            <div key={l.producto.id} style={{ borderTop: '1px solid var(--line)', padding: '9px 0' }}>
              <div className="row">
                <strong>{l.producto.nombre}</strong>
                <button className="btn sm ghost" style={{ color: 'var(--neon)' }} onClick={() => quitar(i)}>✕</button>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <div className="row" style={{ gap: 6 }}>
                  <button className="qty-btn" onClick={() => setCant(i, -1)}>−</button>
                  <span className="big" style={{ minWidth: 26, textAlign: 'center' }}>{l.cantidad}</span>
                  <button className="qty-btn" onClick={() => setCant(i, 1)}>+</button>
                </div>
                <input type="number" inputMode="numeric" value={l.precio}
                  onChange={(e) => setPrecio(i, e.target.value)} style={{ width: 110, textAlign: 'right' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PASO 3: entrega + pago */}
      {cliente && lineas.length > 0 && (
        <>
          <div className="card">
            <label>Entrega</label>
            <div className="grid3">
              {[['ENTREGADO', 'Entregado'], ['PUNTO_ENCUENTRO', 'P. Encuentro'], ['ENVIO', 'Envío']].map(([v, l]) => (
                <button key={v} className={'btn sm' + (entrega === v ? ' primary' : '')} onClick={() => setEntrega(v)}>{l}</button>
              ))}
            </div>
            {entrega !== 'ENTREGADO' && (
              <div style={{ marginTop: 10 }}>
                <label>Fecha de entrega acordada</label>
                <input type="date" value={fechaEstimada} onChange={(e) => setFechaEstimada(e.target.value)} />
              </div>
            )}
            <label>Pago inicial (vacío = todo a cuenta)</label>
            <div className="row">
              <input type="number" inputMode="numeric" placeholder="0" value={pagoInicial}
                onChange={(e) => setPagoInicial(e.target.value)} />
              <button className="btn sm" onClick={() => setPagoInicial(String(total))}>Total</button>
            </div>
            {Number(pagoInicial) > 0 && (
              <>
                <label>Medio de pago</label>
                <select value={medioPago} onChange={(e) => setMedioPago(e.target.value)}>
                  {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
                </select>
              </>
            )}
          </div>

          <button className="btn primary block" disabled={guardando} onClick={guardar}
            style={{ padding: 15, fontSize: '1.05rem' }}>
            {guardando ? 'Guardando…' : `Confirmar venta · ${fmtARS(total)}`}
          </button>
        </>
      )}
    </>
  )
}
