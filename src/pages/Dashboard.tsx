import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getVentas, getClientes, getStock, fmtARS, Venta, SaldoCliente, StockRow } from '../lib/api'

export default function Dashboard() {
  const [ventas, setVentas] = useState<Venta[]>([])
  const [clientes, setClientes] = useState<SaldoCliente[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const desde = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
    Promise.all([getVentas({ desde }), getClientes(), getStock()])
      .then(([v, c, s]) => { setVentas(v); setClientes(c); setStock(s) })
      .finally(() => setCargando(false))
  }, [])

  const hoy = new Date().toDateString()
  const ventasHoy = ventas.filter((v) => new Date(v.fecha).toDateString() === hoy)
  const totalHoy = ventasHoy.reduce((a, v) => a + Number(v.total_ars), 0)
  const totalSemana = ventas.reduce((a, v) => a + Number(v.total_ars), 0)
  const porCobrar = clientes.filter((c) => c.saldo > 0).reduce((a, c) => a + Number(c.saldo), 0)
  const deudaRevs = clientes
    .filter((c) => c.tipo?.toUpperCase() === 'REVENDEDOR' && c.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo)

  const central = stock.filter((s) => s.es_central)
  const criticos = central.filter((s) => s.cantidad <= s.stock_minimo).sort((a, b) => a.cantidad - b.cantidad)

  if (cargando) return <div className="empty">Cargando panel…</div>

  return (
    <>
      <div className="grid2">
        <div className="card neon col">
          <span className="muted">Vendido hoy ({ventasHoy.length})</span>
          <span className="big">{fmtARS(totalHoy)}</span>
        </div>
        <div className="card col">
          <span className="muted">Últimos 7 días</span>
          <span className="big">{fmtARS(totalSemana)}</span>
        </div>
        <div className="card col">
          <span className="muted">Por cobrar</span>
          <span className="big" style={{ color: porCobrar > 0 ? 'var(--warn)' : 'var(--ok)' }}>
            {fmtARS(porCobrar)}
          </span>
        </div>
        <div className="card col">
          <span className="muted">Stock crítico</span>
          <span className="big" style={{ color: criticos.length ? 'var(--neon)' : 'var(--ok)' }}>
            {criticos.length} ítems
          </span>
        </div>
      </div>

      {criticos.length > 0 && (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2>⚠ Stock crítico (Central)</h2>
            <Link to="/stock" className="muted">Ver todo</Link>
          </div>
          {criticos.slice(0, 5).map((s) => (
            <div className="row" key={s.producto_id} style={{ padding: '5px 0' }}>
              <span>{s.producto}</span>
              <span className={'badge ' + (s.cantidad === 0 ? 'neon' : 'warn')}>
                {s.cantidad === 0 ? 'AGOTADO' : `Quedan ${s.cantidad}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {deudaRevs.length > 0 && (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2>Deuda de revendedores</h2>
            <Link to="/revendedores" className="muted">Gestionar</Link>
          </div>
          {deudaRevs.map((r) => (
            <div className="row" key={r.id} style={{ padding: '5px 0' }}>
              <span>{r.nombre}</span>
              <span style={{ color: 'var(--warn)', fontWeight: 700 }}>{fmtARS(r.saldo)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2>Últimas ventas</h2>
          <Link to="/ventas" className="muted">Historial</Link>
        </div>
        {ventas.slice(0, 6).map((v) => (
          <div className="row" key={v.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="col">
              <span>{v.clientes?.nombre ?? '—'}</span>
              <span className="muted">
                {v.venta_detalles?.map((d) => `${d.cantidad}× ${d.productos.nombre}`).join(', ')}
              </span>
            </div>
            <span style={{ fontWeight: 700 }}>{fmtARS(Number(v.total_ars))}</span>
          </div>
        ))}
        {ventas.length === 0 && <div className="empty">Todavía no hay ventas registradas. Tocá ⚡ para cargar la primera.</div>}
      </div>

      <Link to="/ventas/nueva" className="fab" aria-label="Nueva venta">+</Link>
    </>
  )
}
