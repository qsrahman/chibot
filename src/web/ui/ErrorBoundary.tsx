import { Component, type ReactNode } from 'react'

interface Props {
  /** Shown instead of `children` once one of them fails to render; `retry` tries them again. */
  fallback: ReactNode | ((retry: () => void) => ReactNode)
  children: ReactNode
}

/**
 * Keeps one part of the page that fails to render (a message with markup the
 * renderer chokes on) from taking the whole page with it.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const { fallback } = this.props
    return typeof fallback === 'function'
      ? fallback(() => this.setState({ failed: false }))
      : fallback
  }
}
