import { useEffect, useMemo, useState } from 'react'
import {
  getClientes, getStock, getProductos, getPreciosVigentes,
  registrarConsignacion, registrarRendicion, registrarPago,
  getPreciosConsignacionRevendedor,
  fmtARS, MEDIOS_PAGO, SaldoCliente, StockRow, Producto,
} from '../lib/api'
import { useApp } from '../main'

type TipoModo = 'ENTREGA' | 'REGISTRAR_VENTA' | 'REGISTRAR_PAGO'
type Modo =
  | null
  | { tipo: 'ENTREGA'; rev: SaldoCliente }
  | { tipo: 'REGISTRAR_VENTA'; rev: SaldoCliente }
  | { tipo: 'REGISTRAR_PAGO'; rev: SaldoCliente }

export default function Revendedores() {
  const { operador, toast } = useApp()
  const [clientes, setClientes] = useState<SaldoCliente[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [precioRev, setPrecioRev] = useState<Record<string, number>>({})
  const [modo, setModo] = useState<Modo>(null)
  const [guardando, setGuardando] = useState(false)

  // ENTREGA
  const [entrega, setEntrega] = useState<Record<string, number>>({})
  const [precioEntrega, setPrecioEntrega] = useState<Record<string, number>>({})

  // REGISTRAR VENTA (ex-rendición)
  const [regVenta, setRegVenta] = useState<Record<string, { vendidas: number; devueltas: number }>>({})
  const [rvPago, setRvPago] = useState<{ activo: boolean; monto: string; medio: string }>({
    activo: false, monto: '', medio: MEDIOS_PAGO[0],
  })

  // REGISTRAR PAGO
  const [preciosCongelados, setPreciosCongelados] = useState<Record<string, number>>({})
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoMedio, setPagoMedio] = useState(MEDIOS_PAGO[0])
  const [pagoProducto, setPagoProducto] = useState('')
  const [pagoNotas, setPagoNotas] = useState('')

  const cargar = () =>
    Promise.all([getClientes(), getStock(), getProductos(), getPreciosVigentes()]).then(
      ([c, s, p, pv]) => {
        setClientes(c); setStock(s); setProductos(p)
        const revMap = Object.fromEntries(
          pv.filter((x) => x.canal?.toUpperCase() === 'REVENDEDOR').map((x) => [x.producto_id, Number(x.precio_ars)])
        )
        setPrecioRev(revMap)
      }
    )
  useEffect(() => { cargar() }, [])

  const revendedores = clientes.filter((c) => c.tipo?.toUpperCase() === 'REVENDEDOR')
  const stockDe = (revId: string) => stock.filter((s) => s.revendedor_id === revId && s.cantidad > 0)
  const stockCentral = useMemo(() =>
    Object.fromEntries(stock.filter((s) => s.es_central).map((s) => [s.producto_id, s.cantidad])), [stock])

  const abrir = async (tipo: TipoModo, rev: SaldoCliente) => {
    setModo({ tipo, rev } as Modo)
    setEntrega({})
    setPrecioEntrega({})
    setRegVenta({})
    setRvPago({ activo: false, monto: '', medio: MEDIOS_PAGO[0] })
    setPagoMonto('')
    setPagoMedio(MEDIOS_PAGO[0])
    setPagoProducto('')
    setPagoNotas('')

    if (tipo === 'REGISTRAR_PAGO') {
      try {
        const map = await getPreciosConsignacionRevendedor(rev.id)
        setPreciosCongelados(map)
      } catch {
        setPreciosCongelados({})
      }
    }
  }

  const confirmar = async () => {
    if (!modo || !operador) return
    setGuardando(true)
    try {
      if (modo.tipo === 'ENTREGA') {
        const items = Object.entries(entrega)
          .filter(([, c]) => c > 0)
          .map(([producto_id, cantidad]) => ({
            producto_id,
            cantidad,
            precio_unitario: precioEntrega[producto_id] ?? precioRev[producto_id] ?? null,
          }))
        if (items.length === 0) {
          setGuardando(false)
          return
        }
        await registrarConsignacion({ revendedor_id: modo.rev.id, usuario_id: operador.id, items })
        toast('Entrega registrada ✔')
      } else if (modo.tipo === 'REGISTRAR_VENTA') {
        const items = Object.entries(regVenta)
          .filter(([, v]) => v.vendidas > 0 || v.devueltas > 0)
          .map(([producto_id, v]) => ({ producto_id, ...v }))
        const hayItems = items.length > 0
        const hayPago = rvPago.activo && Number(rvPago.monto) > 0
        if (!hayItems && !hayPago) {
          setGuardando(false)
          return
        }
        await registrarRendicion({
          revendedor_id: modo.rev.id,
          usuario_id: operador.id,
          items,
          monto_pago: hayPago ? Number(rvPago.monto) : 0,
          medio_pago: hayPago ? rvPago.medio : null,
        })
        toast('Venta de revendedor registrada ✔')
      } else if (modo.tipo === 'REGISTRAR_PAGO') {
        const m = Number(pagoMonto)
        if (!m || m <= 0) {
          setGuardando(false)
          return
        }
        const notas = pagoProducto
          ? `Pago por: ${productos.find((p) => p.id === pagoProducto)?.nombre ?? pagoProducto}${pagoNotas ? ' — ' + pagoNotas : ''}`
          : pagoNotas || null
        await registrarPago({
          cliente_id: modo.rev.id,
          monto: m,
          medio_pago: pagoMedio,
          usuario_id: operador.id,
          tipo: 'PAGO',
          notas: notas ?? undefined,
        })
        toast('Pago registrado ✔')
      }
      setModo(null)
      cargar()
    } catch (e: any) {
      toast('Error: ' + (e.message ?? e), true)
    } finally { setGuardando(false) }
  }

  const enCalleDeModal = modo && modo.tipo !== 'ENTREGA' ? stockDe(modo.rev.id) : []

  return (
    <>
      {revendedores.length === 0 && (
        <div className="empty">
          No hay revendedores. Crealos en Clientes con tipo "Revendedor".
        </div>
      )}

      {revendedores.map((r) => {
        const enCalle = stockDe(r.id)
        const valorizado = enCalle.reduce((a, s) => a + s.cantidad * (precioRev[s.producto_id] ?? 0), 0)
        return (
          <div className="card" key={r.id}>
            <div className="row">
              <strong>{r.nombre}</strong>
              {r.saldo > 0
                ? <span className="badge warn">Debe {fmtARS(r.saldo)}</span>
                : <span className="badge ok">Al día</span>}
            </div>
            <div className="muted" style={{ margin: '7px 0' }}>
              {enCalle.length === 0
                ? 'Sin mercadería en su poder'
                : enCalle.map((s) => `${s.cantidad}× ${s.producto}`).join(' · ')}
            </div>
            {enCalle.length > 0 && (
              <div className="muted" style={{ marginBottom: 8 }}>
                Mercadería en calle valorizada: <strong style={{ color: 'var(--txt)' }}>{fmtARS(valorizado)}</strong>
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm block" onClick={() => abrir('ENTREGA', r)}>+ Entregar mercadería</button>
              <button className="btn sm block primary" onClick={() => abrir('REGISTRAR_VENTA', r)}
                disabled={enCalle.length === 0 && r.saldo <= 0}>
                Registrar venta
              </button>
              {r.saldo > 0 && (
                <button className="btn sm block" style={{ color: '#2dd4a7', borderColor: '#2dd4a7' }} onClick={() => abrir('REGISTRAR_PAGO', r)}>
                  Registrar pago
                </button>
              )}
            </div>
          </div>
        )
      })}

      {modo && (
        <div className="modal-back" onClick={() => setModo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {modo.tipo === 'ENTREGA' && 'Entregar a '}
              {modo.tipo === 'REGISTRAR_VENTA' && 'Registrar venta de '}
              {modo.tipo === 'REGISTRAR_PAGO' && 'Registrar pago de '}
              {modo.rev.nombre}
            </h2>

            {/* ---------- ENTREGA ---------- */}
            {modo.tipo === 'ENTREGA' && (
              <>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  Editá el precio si acordaste algo distinto al vigente.
                </p>
                {productos.filter((p) => (stockCentral[p.id] ?? 0) > 0).map((p) => (
                  <div className="row" key={p.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                    <div className="col" style={{ flex: 1, minWidth: 140 }}>
                      <span>{p.nombre}</span>
                      <span className="muted">Central: {stockCentral[p.id]}</span>
                    </div>
                    <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>$</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          style={{ width: 90, textAlign: 'right' }}
                          value={precioEntrega[p.id] ?? precioRev[p.id] ?? 0}
                          onChange={(e) => setPrecioEntrega({ ...precioEntrega, [p.id]: Number(e.target.value) })}
                        />
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="qty-btn" onClick={() =>
                          setEntrega({ ...entrega, [p.id]: Math.max(0, (entrega[p.id] ?? 0) - 1) })}>−</button>
                        <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{entrega[p.id] ?? 0}</span>
                        <button className="qty-btn" onClick={() =>
                          setEntrega({ ...entrega, [p.id]: Math.min(stockCentral[p.id], (entrega[p.id] ?? 0) + 1) })}>+</button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* ---------- REGISTRAR VENTA ---------- */}
            {modo.tipo === 'REGISTRAR_VENTA' && (
              <>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  Marcá cuántas vendió y cuántas devuelve. Las vendidas generan deuda al precio congelado.
                </p>
                {enCalleDeModal.map((s) => {
                  const v = regVenta[s.producto_id] ?? { vendidas: 0, devueltas: 0 }
                  const tope = s.cantidad - v.vendidas - v.devueltas
                  const set = (k: 'vendidas' | 'devueltas', d: number) =>
                    setRegVenta({ ...regVenta, [s.producto_id]: { ...v, [k]: Math.max(0, Math.min(v[k] + d, v[k] + (d > 0 ? tope : 0))) } })
                  return (
                    <div key={s.producto_id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="row">
                        <strong>{s.producto}</strong>
                        <span className="muted">Tiene {s.cantidad}</span>
                      </div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <span className="muted">Vendió</span>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="qty-btn" onClick={() => set('vendidas', -1)}>−</button>
                          <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{v.vendidas}</span>
                          <button className="qty-btn" onClick={() => set('vendidas', 1)}>+</button>
                        </div>
                      </div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <span className="muted">Devuelve</span>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="qty-btn" onClick={() => set('devueltas', -1)}>−</button>
                          <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{v.devueltas}</span>
                          <button className="qty-btn" onClick={() => set('devueltas', 1)}>+</button>
                        </div>
                      </div>
                    </div>
                  )
                })}

                <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                  <label>¿El revendedor te pagó?</label>
                  <div className="chips" style={{ margin: '6px 0 10px' }}>
                    <button
                      className={'chip' + (!rvPago.activo ? ' active' : '')}
                      onClick={() => setRvPago({ ...rvPago, activo: false })}
                    >
                      Todavía no pagó
                    </button>
                    <button
                      className={'chip' + (rvPago.activo ? ' active' : '')}
                      onClick={() => setRvPago({ ...rvPago, activo: true })}
                    >
                      Me pagó
                    </button>
                  </div>

                  {rvPago.activo && (
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="Monto"
                        value={rvPago.monto}
                        onChange={(e) => setRvPago({ ...rvPago, monto: e.target.value })}
                        style={{ flex: 1 }}
                      />
                      <select
                        value={rvPago.medio}
                        onChange={(e) => setRvPago({ ...rvPago, medio: e.target.value })}
                        style={{ width: 150 }}
                      >
                        {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- REGISTRAR PAGO ---------- */}
            {modo.tipo === 'REGISTRAR_PAGO' && (
              <>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  Deuda actual: <strong>{fmtARS(modo.rev.saldo)}</strong>
                </p>
                {enCalleDeModal.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 6 }}>Mercadería en su poder:</p>
                    {enCalleDeModal.map((s) => {
                      const precio = preciosCongelados[s.producto_id] ?? precioRev[s.producto_id] ?? 0
                      return (
                        <div key={s.producto_id} className="row" style={{ padding: '4px 0', fontSize: '0.85rem' }}>
                          <span>{s.cantidad}× {s.producto}</span>
                          <span className="muted">{fmtARS(precio)} c/u · {fmtARS(s.cantidad * precio)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <label>Monto del pago</label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={pagoMonto}
                  onChange={(e) => setPagoMonto(e.target.value)}
                  autoFocus
                />
                <label>Medio de pago</label>
                <select value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)}>
                  {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
                </select>
                <label>Asociar a producto (opcional)</label>
                <select value={pagoProducto} onChange={(e) => setPagoProducto(e.target.value)}>
                  <option value="">Pago general</option>
                  {enCalleDeModal.map((s) => (
                    <option key={s.producto_id} value={s.producto_id}>
                      {s.producto} ({s.cantidad} en calle)
                    </option>
                  ))}
                </select>
                <label>Notas (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: pago de 2 Baja Splash"
                  value={pagoNotas}
                  onChange={(e) => setPagoNotas(e.target.value)}
                />
              </>
            )}

            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <button className="btn block" onClick={() => setModo(null)}>Cancelar</button>
              <button className="btn primary block" disabled={guardando} onClick={confirmar}>
                {guardando ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
