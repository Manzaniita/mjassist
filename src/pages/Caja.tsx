import { useEffect, useMemo, useState } from 'react'
import { getPagosRango, fmtARS, fmtFecha, Pago } from '../lib/api'

const hoyISO = () => new Date().toISOString().slice(0, 10)

export default function Caja() {
  const [desde, setDesde] = useState(hoyISO())
  const [hasta, setHasta] = useState(hoyISO())
  const [pagos, setPagos] = useState<Pago[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    setCargando(true)
    getPagosRango(desde, hasta).then(setPagos).finally(() => setCargando(false))
  }, [desde, hasta])

  const porMedio = useMemo(() => {
    const m = new Map<string, number>()
    pagos.forEach((p) => m.set(p.medio_pago, (m.get(p.medio_pago) ?? 0) + Number(p.monto)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [pagos])

  const total = pagos.reduce((a, p) => a + Number(p.monto), 0)

  const rapido = (dias: number) => {
    setDesde(new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10))
    setHasta(hoyISO())
  }

  return (
    <>
      <div className="chips">
        <button className="chip" onClick={() => { setDesde(hoyISO()); setHasta(hoyISO()) }}>Hoy</button>
        <button className="chip" onClick={() => rapido(7)}>7 días</button>
        <button className="chip" onClick={() => rapido(30)}>30 días</button>
      </div>
      <div className="grid2">
        <div><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>

      <div className="card neon col" style={{ marginTop: 12 }}>
        <span className="muted">Total cobrado en el período</span>
        <span className="big">{fmtARS(total)}</span>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Debería haber, por medio de pago</h2>
        {porMedio.map(([medio, monto]) => (
          <div className="row" key={medio} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{medio}</span>
            <strong>{fmtARS(monto)}</strong>
          </div>
        ))}
        {porMedio.length === 0 && !cargando && <div className="empty">Sin cobros en este período.</div>}
        <p className="muted" style={{ marginTop: 10 }}>
          Compará estos números con lo que contaste en efectivo y lo que entró en cada cuenta. Si no coincide, falta registrar algún pago.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Detalle de cobros</h2>
        {pagos.map((p) => (
          <div className="row" key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="col">
              <span className="muted">{fmtFecha(p.fecha)} · {p.tipo === 'SENA' ? 'Seña' : p.tipo === 'RENDICION_REVENDEDOR' ? 'Rendición' : 'Pago'}</span>
              <span>{p.medio_pago}</span>
            </div>
            <strong>{fmtARS(Number(p.monto))}</strong>
          </div>
        ))}
      </div>
    </>
  )
}
