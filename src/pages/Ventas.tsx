import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getVentas, fmtARS, fmtFecha, Venta,
  marcarEntregado, cancelarVenta, registrarPago,
  MEDIOS_PAGO,
} from '../lib/api'
import { useApp } from '../main'

const ESTADOS: Record<string, { label: string; cls: string }> = {
  ENTREGADO: { label: 'Entregado', cls: 'ok' },
  PUNTO_ENCUENTRO: { label: 'Punto de encuentro', cls: 'info' },
  ENVIO: { label: 'Envío', cls: 'violet' },
  PENDIENTE: { label: 'Pendiente', cls: 'warn' },
}

type ModalPago = null | { venta: Venta; monto: string; medio: string; tipo: 'PAGO' | 'SENA' }

export default function Ventas() {
  const { operador, toast } = useApp()
  const [ventas, setVentas] = useState<Venta[]>([])
  const [texto, setTexto] = useState('')
  const [filtroPago, setFiltroPago] = useState<'TODAS' | 'DEBE' | 'PAGAS'>('TODAS')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [verFiltros, setVerFiltros] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [modalPago, setModalPago] = useState<ModalPago>(null)

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
      if (v.cancelada) {
        // Las canceladas se muestran siempre a menos que el filtro de texto las excluya
        if (!t) return true
        const blob = [
          v.clientes?.nombre, v.usuarios?.nombre,
          ...(v.venta_detalles ?? []).map((d) => d.productos.nombre),
        ].join(' ').toLowerCase()
        return blob.includes(t)
      }
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

  const handleCancelar = async (v: Venta) => {
    if (!operador) return
    if (!confirm(`¿Cancelar la venta de ${v.clientes?.nombre ?? ''} por ${fmtARS(Number(v.total_ars))}?\n\nEl stock volverá a Central.`)) return
    try {
      await cancelarVenta(v.id, operador.id)
      toast('Venta cancelada ✔')
      cargar()
    } catch (e: any) {
      toast('Error: ' + (e.message ?? e), true)
    }
  }

  const abrirPago = (venta: Venta) => {
    const saldo = Number(venta.total_ars) - (venta.pagos ?? []).reduce((a, p) => a + Number(p.monto), 0)
    setModalPago({ venta, monto: String(Math.round(saldo)), medio: MEDIOS_PAGO[0], tipo: 'PAGO' })
  }

  const confirmarPago = async () => {
    if (!modalPago || !operador) return
    const m = Number(modalPago.monto)
    if (!m || m <= 0) return
    try {
      await registrarPago({
        cliente_id: modalPago.venta.cliente_id,
        venta_id: modalPago.venta.id,
        monto: m,
        medio_pago: modalPago.medio,
        usuario_id: operador.id,
        tipo: modalPago.tipo,
      })
      toast('Pago registrado ✔')
      setModalPago(null)
      cargar()
    } catch (e: any) {
      toast('Error: ' + (e.message ?? e), true)
    }
  }

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
          <div className="card" key={v.id} style={v.cancelada ? { opacity: 0.7 } : undefined}>
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
              <div className="col" style={{ gap: 4 }}>
                {v.cancelada ? (
                  <span className="badge" style={{ background: '#ef4444', color: '#fff' }}>Cancelada</span>
                ) : (
                  <>
                    <span className={'badge ' + est.cls}>{est.label}</span>
                    {v.fecha_estimada && (
                      <span className="muted" style={{ fontSize: '0.75rem' }}>
                        Entrega acordada: {new Date(v.fecha_estimada).toLocaleDateString('es-AR')}
                        {v.fecha_entrega ? ` · Entregado: ${new Date(v.fecha_entrega).toLocaleDateString('es-AR')}` : ''}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {!v.cancelada && v.estado_entrega !== 'ENTREGADO' && (
                  <button className="btn sm primary" onClick={async () => { await marcarEntregado(v.id); cargar(); }}>
                    Marcar entregado
                  </button>
                )}
                {!v.cancelada && saldo > 0.5 && (
                  <button className="btn sm" style={{ color: '#2dd4a7', borderColor: '#2dd4a7' }} onClick={() => abrirPago(v)}>
                    + Pago
                  </button>
                )}
                {!v.cancelada && (
                  <button className="btn sm" style={{ color: '#ef4444' }} onClick={() => handleCancelar(v)}>
                    Cancelar
                  </button>
                )}
                {v.cancelada
                  ? <span className="badge" style={{ background: '#444', color: '#aaa' }}>Anulada</span>
                  : saldo > 0.5
                    ? <span className="badge warn">Debe {fmtARS(saldo)}</span>
                    : <span className="badge ok">Paga</span>}
              </div>
            </div>
          </div>
        )
      })}

      <Link to="/ventas/nueva" className="fab" aria-label="Nueva venta">+</Link>

      {modalPago && (
        <div className="modal-back" onClick={() => setModalPago(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Registrar pago</h3>
            <p className="muted" style={{ margin: '6px 0 12px' }}>
              {modalPago.venta.clientes?.nombre} — Venta {fmtARS(Number(modalPago.venta.total_ars))}
            </p>
            <label>Monto</label>
            <input
              type="number"
              inputMode="numeric"
              value={modalPago.monto}
              onChange={(e) => setModalPago({ ...modalPago, monto: e.target.value })}
              autoFocus
            />
            <label>Medio de pago</label>
            <select
              value={modalPago.medio}
              onChange={(e) => setModalPago({ ...modalPago, medio: e.target.value })}
            >
              {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
            </select>
            <label>Tipo</label>
            <div className="chips" style={{ marginBottom: 8 }}>
              {(['PAGO', 'SENA'] as const).map((t) => (
                <button
                  key={t}
                  className={'chip' + (modalPago.tipo === t ? ' active' : '')}
                  onClick={() => setModalPago({ ...modalPago, tipo: t })}
                >
                  {t === 'PAGO' ? 'Pago / Anticipo' : 'Seña'}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn block" onClick={() => setModalPago(null)}>Cerrar</button>
              <button className="btn primary block" onClick={confirmarPago}>Confirmar pago</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
