import { useEffect, useMemo, useState } from 'react'
import {
  getClientes, getStock, getProductos, getPreciosVigentes,
  registrarConsignacion, registrarRendicion,
  fmtARS, MEDIOS_PAGO, SaldoCliente, StockRow, Producto,
} from '../lib/api'
import { useApp } from '../main'

type Modo = null | { tipo: 'ENTREGA' | 'RENDICION'; rev: SaldoCliente }

export default function Revendedores() {
  const { operador, toast } = useApp()
  const [clientes, setClientes] = useState<SaldoCliente[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [precioRev, setPrecioRev] = useState<Record<string, number>>({})
  const [modo, setModo] = useState<Modo>(null)
  // ENTREGA: producto_id -> cantidad | RENDICION: producto_id -> {vendidas, devueltas}
  const [entrega, setEntrega] = useState<Record<string, number>>({})
  const [rend, setRend] = useState<Record<string, { vendidas: number; devueltas: number }>>({})
  const [monto, setMonto] = useState('')
  const [medio, setMedio] = useState(MEDIOS_PAGO[0])
  const [guardando, setGuardando] = useState(false)

  const cargar = () =>
    Promise.all([getClientes(), getStock(), getProductos(), getPreciosVigentes()]).then(
      ([c, s, p, pv]) => {
        setClientes(c); setStock(s); setProductos(p)
        setPrecioRev(Object.fromEntries(
          pv.filter((x) => x.canal === 'REVENDEDOR').map((x) => [x.producto_id, Number(x.precio_ars)])
        ))
      }
    )
  useEffect(() => { cargar() }, [])

  const revendedores = clientes.filter((c) => c.tipo === 'REVENDEDOR')
  const stockDe = (revId: string) => stock.filter((s) => s.revendedor_id === revId && s.cantidad > 0)
  const stockCentral = useMemo(() =>
    Object.fromEntries(stock.filter((s) => s.es_central).map((s) => [s.producto_id, s.cantidad])), [stock])

  const abrir = (tipo: 'ENTREGA' | 'RENDICION', rev: SaldoCliente) => {
    setModo({ tipo, rev }); setEntrega({}); setRend({}); setMonto('')
  }

  const confirmar = async () => {
    if (!modo || !operador) return
    setGuardando(true)
    try {
      if (modo.tipo === 'ENTREGA') {
        const items = Object.entries(entrega)
          .filter(([, c]) => c > 0)
          .map(([producto_id, cantidad]) => ({ producto_id, cantidad, precio_unitario: precioRev[producto_id] ?? null }))
        if (items.length === 0) return
        await registrarConsignacion({ revendedor_id: modo.rev.id, usuario_id: operador.id, items })
        toast('Entrega registrada ✔')
      } else {
        const items = Object.entries(rend)
          .filter(([, v]) => v.vendidas > 0 || v.devueltas > 0)
          .map(([producto_id, v]) => ({ producto_id, ...v }))
        if (items.length === 0 && !Number(monto)) return
        await registrarRendicion({
          revendedor_id: modo.rev.id, usuario_id: operador.id, items,
          monto_pago: Number(monto) || 0, medio_pago: Number(monto) > 0 ? medio : null,
        })
        toast('Rendición registrada ✔')
      }
      setModo(null)
      cargar()
    } catch (e: any) {
      toast('Error: ' + (e.message ?? e), true)
    } finally { setGuardando(false) }
  }

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
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm block" onClick={() => abrir('ENTREGA', r)}>+ Entregar mercadería</button>
              <button className="btn sm block primary" onClick={() => abrir('RENDICION', r)}
                disabled={enCalle.length === 0 && r.saldo <= 0}>
                Rendición
              </button>
            </div>
          </div>
        )
      })}

      {modo && (
        <div className="modal-back" onClick={() => setModo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{modo.tipo === 'ENTREGA' ? 'Entregar a' : 'Rendición de'} {modo.rev.nombre}</h2>

            {modo.tipo === 'ENTREGA' && (
              <>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  Sale de Central al precio revendedor vigente (queda congelado en el remito).
                </p>
                {productos.filter((p) => (stockCentral[p.id] ?? 0) > 0).map((p) => (
                  <div className="row" key={p.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="col">
                      <span>{p.nombre}</span>
                      <span className="muted">Central: {stockCentral[p.id]} · {fmtARS(precioRev[p.id] ?? 0)}</span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="qty-btn" onClick={() =>
                        setEntrega({ ...entrega, [p.id]: Math.max(0, (entrega[p.id] ?? 0) - 1) })}>−</button>
                      <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{entrega[p.id] ?? 0}</span>
                      <button className="qty-btn" onClick={() =>
                        setEntrega({ ...entrega, [p.id]: Math.min(stockCentral[p.id], (entrega[p.id] ?? 0) + 1) })}>+</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {modo.tipo === 'RENDICION' && (
              <>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  Marcá cuántas vendió y cuántas devuelve. Las vendidas suman a su deuda al precio congelado; el pago la baja.
                </p>
                {stockDe(modo.rev.id).map((s) => {
                  const v = rend[s.producto_id] ?? { vendidas: 0, devueltas: 0 }
                  const tope = s.cantidad - v.vendidas - v.devueltas
                  const set = (k: 'vendidas' | 'devueltas', d: number) =>
                    setRend({ ...rend, [s.producto_id]: { ...v, [k]: Math.max(0, Math.min(v[k] + d, v[k] + (d > 0 ? tope : 0))) } })
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
                <label>Pago que entrega (opcional)</label>
                <div className="row" style={{ gap: 8 }}>
                  <input type="number" inputMode="numeric" placeholder="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
                  <select value={medio} onChange={(e) => setMedio(e.target.value)} style={{ width: 150 }}>
                    {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
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
