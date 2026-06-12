import { useState } from 'react'
import { useApp } from '../main'

const API = '/api'

export default function Admin() {
  const { operador, toast } = useApp()
  const esAdmin = operador?.rol === 'ADMIN'
  const [confirmReset, setConfirmReset] = useState('')
  const [confirmCierre, setConfirmCierre] = useState('')
  const [loading, setLoading] = useState(false)

  const descargarExcel = (buffer: ArrayBuffer, filename: string) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const cerrarCiclo = async () => {
    if (!operador) return
    if (confirmCierre !== 'CERRAR CICLO') {
      toast('Escribí "CERRAR CICLO" para confirmar', true)
      return
    }
    setLoading(true)
    try {
      const r = await fetch(`${API}/cierre-ciclo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: operador.id }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || 'Error al cerrar ciclo')
      }
      const blob = await r.blob()
      const filename = r.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'cierre-ciclo.xlsx'
      descargarExcel(await blob.arrayBuffer(), filename)
      toast('Ciclo cerrado ✔ Excel descargado')
      setConfirmCierre('')
    } catch (e: any) {
      toast(e.message || 'Error al cerrar ciclo', true)
    } finally {
      setLoading(false)
    }
  }

  const reset = async (modo: 'completa' | 'operaciones') => {
    if (!operador) return
    const texto = modo === 'completa' ? 'RESET COMPLETO' : 'RESET OPERACIONES'
    if (confirmReset !== texto) {
      toast(`Escribí "${texto}" para confirmar`, true)
      return
    }
    setLoading(true)
    try {
      const r = await fetch(`${API}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: operador.id, modo }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Error al resetear')
      toast(modo === 'completa' ? 'Base de datos reseteada ✔' : 'Operaciones reseteadas ✔')
      setConfirmReset('')
    } catch (e: any) {
      toast(e.message || 'Error al resetear', true)
    } finally {
      setLoading(false)
    }
  }

  if (!esAdmin) {
    return (
      <div className="card">
        <h2>Administración</h2>
        <p className="muted">Solo los administradores pueden acceder a esta sección.</p>
      </div>
    )
  }

  return (
    <>
      <div className="card neon">
        <h2>Administración</h2>
        <p className="muted">Acciones destructivas. Requerís confirmación explícita para cada una.</p>
      </div>

      <div className="card">
        <h3>🔒 Cerrar ciclo</h3>
        <p className="muted">
          Descarga un Excel con todos los datos (ventas, clientes, productos, stock, consignaciones, compras, reservas, pagos, etc.) y luego borra las operaciones.
          El catálogo de productos y clientes se conserva.
        </p>
        <label style={{ fontSize: 13, marginTop: 10, display: 'block' }}>
          Escribí <strong>CERRAR CICLO</strong> para confirmar
        </label>
        <input
          value={confirmCierre}
          onChange={(e) => setConfirmCierre(e.target.value)}
          placeholder="CERRAR CICLO"
          disabled={loading}
        />
        <button
          type="button"
          className="btn primary block"
          style={{ marginTop: 12 }}
          onClick={cerrarCiclo}
          disabled={loading}
        >
          {loading ? 'Procesando…' : 'Cerrar ciclo y descargar Excel'}
        </button>
      </div>

      <div className="card" style={{ borderColor: 'var(--neon)' }}>
        <h3>⚠️ Resetear operaciones</h3>
        <p className="muted">
          Borra ventas, pagos, consignaciones, compras, reservas y movimientos de stock. Conserva productos, clientes, precios y usuarios.
        </p>
        <label style={{ fontSize: 13, marginTop: 10, display: 'block' }}>
          Escribí <strong>RESET OPERACIONES</strong> para confirmar
        </label>
        <input
          value={confirmReset}
          onChange={(e) => setConfirmReset(e.target.value)}
          placeholder="RESET OPERACIONES"
          disabled={loading}
        />
        <button
          type="button"
          className="btn block"
          style={{ marginTop: 12, color: 'var(--neon)' }}
          onClick={() => reset('operaciones')}
          disabled={loading}
        >
          {loading ? 'Procesando…' : 'Resetear operaciones'}
        </button>
      </div>

      <div className="card" style={{ borderColor: 'var(--neon)' }}>
        <h3>🗑️ Resetear base completa</h3>
        <p className="muted">
          Borra TODO: operaciones, productos, clientes, precios y ubicaciones. Solo conserva usuarios, configuración, canales y tipos de cliente.
        </p>
        <label style={{ fontSize: 13, marginTop: 10, display: 'block' }}>
          Escribí <strong>RESET COMPLETO</strong> para confirmar
        </label>
        <input
          value={confirmReset}
          onChange={(e) => setConfirmReset(e.target.value)}
          placeholder="RESET COMPLETO"
          disabled={loading}
        />
        <button
          type="button"
          className="btn block"
          style={{ marginTop: 12, background: 'var(--neon)', color: '#fff' }}
          onClick={() => reset('completa')}
          disabled={loading}
        >
          {loading ? 'Procesando…' : 'Resetear base completa'}
        </button>
      </div>
    </>
  )
}
