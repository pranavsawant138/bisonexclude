 import type { NextConfig } from 'next'

  const nextConfig: NextConfig = {
    // Allow streaming responses up to 5 minutes
    experimental: {
      serverActions: { bodySizeLimit: '10mb' }
    }
  }

  export default nextConfig
