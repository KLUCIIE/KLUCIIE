const API_BASE = (() => {
  const raw = import.meta.env.VITE_API_URL || '/api'
  const trimmed = String(raw).replace(/\/+$/, '')
  return /\/api$/i.test(trimmed) ? trimmed : trimmed + '/api'
})()

interface RequestOptions extends RequestInit {
  params?: Record<string, string>
}

class ApiClient {
  private accessToken: string | null = null
  private refreshToken: string | null = null

  setTokens(access: string, refresh: string) {
    this.accessToken = access
    this.refreshToken = refresh
    localStorage.setItem('ciie_access_token', access)
    localStorage.setItem('ciie_refresh_token', refresh)
  }

  clearTokens() {
    this.accessToken = null
    this.refreshToken = null
    localStorage.removeItem('ciie_access_token')
    localStorage.removeItem('ciie_refresh_token')
  }

  loadTokens() {
    this.accessToken = localStorage.getItem('ciie_access_token')
    this.refreshToken = localStorage.getItem('ciie_refresh_token')
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }
    return headers
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    let url = `${API_BASE}${path}`
    if (params) {
      const searchParams = new URLSearchParams(params)
      url += `?${searchParams.toString()}`
    }
    return url
  }

  async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options
    const url = this.buildUrl(path, params)

    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...this.getAuthHeaders(),
        ...fetchOptions.headers,
      },
    })

    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken()
      if (refreshed) {
        const retryResponse = await fetch(url, {
          ...fetchOptions,
          headers: {
            ...this.getAuthHeaders(),
            ...fetchOptions.headers,
          },
        })
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ message: 'Request failed' }))
          throw new Error(error.message || `HTTP ${retryResponse.status}`)
        }
        return retryResponse.json()
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async get<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params })
  }

  async post<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async put<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async delete<T = any>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' })
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      })
      if (!response.ok) {
        this.clearTokens()
        return false
      }
      const data = await response.json()
      this.accessToken = data.accessToken
      localStorage.setItem('ciie_access_token', data.accessToken)
      return true
    } catch {
      this.clearTokens()
      return false
    }
  }

  get isAuthenticated(): boolean {
    return !!this.accessToken
  }
}

export const api = new ApiClient()
api.loadTokens()

export default api
