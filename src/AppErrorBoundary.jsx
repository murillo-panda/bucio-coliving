import { Component } from 'react'
import brandMark from './assets/brand-mark.png'
import styles from './AppErrorBoundary.module.css'

export default class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error inesperado en la aplicación', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className={styles.page}>
          <section className={styles.card} role="alert">
            <img className={styles.logo} src={brandMark} alt="" />
            <h1>Ocurrió un error inesperado</h1>
            <p>Recarga la aplicación para continuar. Si estabas guardando información, comprueba el resultado antes de repetir la operación.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Recargar aplicación
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
