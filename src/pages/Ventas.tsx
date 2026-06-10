import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getVentas, fmtARS, fmtFecha, Venta } from '../lib/api'

const ESTADOS: Record<string, { label: string; cls: string }> = {
  ENTREGADO: { label: 'Entregado', cls: 'ok' },
  PUNTO_ENCUENTRO: { label: 'Punto de encuentro', cls: 'info' },
  ENVIO: { label: 'Envío', cls: 'violet' },
  PENDIENTE: { label: 'Pendiente', cls: 'warn' },
}

export default function Ventas() {
  const [ventas, setVentas] = useState<Venta[]>([])
  const [texto, setTexto] = useState('')
  const [filtroPago, setFiltroPago] = useState<'TODAS' | 'DEBE' | 'PAGAS'>('TODAS')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [verFiltros, setVerFiltros] = useState(false)
  const [cargando, setCargando] = useState(true)

  const cargar = () => {
    setCargando(true)
    getVentas({ desde: desde || undefined, hasta: hasta || undefined })
      .then(setVentas)
      .finally(() => setCargando(false))
  }
  useEffect(cargar, [desde, hasta])

  const lista = useMemo(() => {
    const t = texto.toLowerCase()
    return ventas.filter((v) => {
      const pagado = (v.pagos ?? []).reduce((a, p) => a + Number(p.monto), 0)
      const debe = Number(v.total_ars) - pagado > 0.5
      if (filtroPago === 'DEBE' && !debe) return false
      if (filtroPago === 'PAGAS' && debe) return false
      if (!t) return true
      const blob = [
        v.clientes?.nombre, v.usuarios?.nombre,
        ...(v.venta_detalles ?? []).map((d) => d.productos.nombre),
      ].join(' ').toLowerCase()
      return blob.includes(t)
    })
  }, [ventas, texto, filtroPago])

  return (
    <>
      <input
        placeholder="Buscar cliente, producto o vendedor…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div className="chips">
        {(['TODAS', 'DEBE', 'PAGAS'] as const).map((f) => (
          <button key={f} className={'chip' + (filtroPago === f ? ' active' : '')} onClick={() => setFiltroPago(f)}>
            {f === 'TODAS' ? 'Todas' : f === 'DEBE' ? 'Con saldo' : 'Pagas'}
          </button>
        ))}
        <button className={'chip' + (verFiltros ? ' active' : '')} onClick={() => setVerFiltros(!verFiltros)}>
          Fechas {verFiltros ? '▲' : '▼'}
        </button>
      </div>
      {verFiltros && (
        <div className="grid2" style={{ marginBottom: 10 }}>
          <div><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </div>
      )}

      {cargando && <div className="empty">Cargando ventas…</div>}
      {!cargando && lista.length === 0 && <div className="empty">No hay ventas que coincidan con el filtro.</div>}

      {lista.map((v) => {
        const pagado = (v.pagos ?? []).reduce((a, p) => a + Number(p.monto), 0)
        const saldo = Number(v.total_ars) - pagado
        const est = ESTADOS[v.estado_entrega] ?? ESTADOS.ENTREGADO
        return (
          <div className="card" key={v.id}>
            <div className="row">
              <div className="col">
                <strong>{v.clientes?.nombre ?? '—'}</strong>
                <span className="muted">{fmtFecha(v.fecha)} · {v.usuarios?.nombre ?? '—'} · {v.canal_origen === 'TELEGRAM' ? '🤖' : '📱'}</span>
              </div>
              <span className="big">{fmtARS(Number(v.total_ars))}</span>
            </div>
            <div className="muted" style={{ margin: '6px 0' }}>
              {(v.venta_detalles ?? []).map((d) => `${d.cantidad}× ${d.productos.nombre}`).join(' · ')}
            </div>
            <div className="row">
              <span className={'badge ' + est.cls}>{est.label}</span>
              {saldo > 0.5
                ? <span className="badge warn">Debe {fmtARS(saldo)}</span>
                : <span className="badge ok">Paga</span>}
            </div>
          </div>
        )
      })}

      <Link to="/ventas/nueva" className="fab" aria-label="Nueva venta">+</Link>
    </>
  )
}
