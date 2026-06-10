import React, { createContext, useContext, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import './styles.css'
import { getUsuarios, Usuario } from './lib/api'
import Dashboard from './pages/Dashboard'
import Ventas from './pages/Ventas'
import NuevaVenta from './pages/NuevaVenta'
import Clientes from './pages/Clientes'
import Stock from './pages/Stock'
import Revendedores from './pages/Revendedores'
import Caja from './pages/Caja'

// ---- Contexto global: operador activo + toasts ----
interface AppCtx {
  usuarios: Usuario[]
  operador: Usuario | null
  setOperador: (u: Usuario) => void
  toast: (msg: string, err?: boolean) => void
}
const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)

function Shell() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [operador, setOperadorState] = useState<Usuario | null>(null)
  const [toastMsg, setToastMsg] = useState<{ msg: string; err: boolean } | null>(null)

  useEffect(() => {
    getUsuarios()
      .then((us) => {
        setUsuarios(us)
        const saved = localStorage.getItem('mj_operador')
        const found = us.find((u) => u.id === saved)
        setOperadorState(found ?? us[0] ?? null)
      })
      .catch(() => toast('No se pudo conectar a la base. Revisá las variables de entorno.', true))
  }, [])

  const setOperador = (u: Usuario) => {
    setOperadorState(u)
    localStorage.setItem('mj_operador', u.id)
  }
  const toast = (msg: string, err = false) => {
    setToastMsg({ msg, err })
    setTimeout(() => setToastMsg(null), 2600)
  }

  return (
    <Ctx.Provider value={{ usuarios, operador, setOperador, toast }}>
      <header className="topbar">
        <h1>MJ <span>Assist</span></h1>
        <select
          style={{ width: 'auto', padding: '7px 10px', fontSize: '0.85rem' }}
          value={operador?.id ?? ''}
          onChange={(e) => {
            const u = usuarios.find((x) => x.id === e.target.value)
            if (u) setOperador(u)
          }}
        >
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre}</option>
          ))}
        </select>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ventas" element={<Ventas />} />
          <Route path="/ventas/nueva" element={<NuevaVenta />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/revendedores" element={<Revendedores />} />
          <Route path="/caja" element={<Caja />} />
        </Routes>
        <div className="credit">
          Creado por <a href="https://ddr.com.ar" target="_blank" rel="noreferrer">ddr.com.ar</a>
        </div>
      </main>

      <nav className="tabbar">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">◉</span>Inicio
        </NavLink>
        <NavLink to="/ventas" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">⚡</span>Ventas
        </NavLink>
        <NavLink to="/clientes" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">☰</span>Clientes
        </NavLink>
        <NavLink to="/stock" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">▦</span>Stock
        </NavLink>
        <NavLink to="/revendedores" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">⇄</span>Revend.
        </NavLink>
        <NavLink to="/caja" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">$</span>Caja
        </NavLink>
      </nav>

      {toastMsg && <div className={'toast' + (toastMsg.err ? ' err' : '')}>{toastMsg.msg}</div>}
    </Ctx.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </React.StrictMode>
)
