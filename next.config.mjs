/** @type {import('next').NextConfig} */
const nextConfig = {
  // @libsql/client pulls in optional native bindings for local `file:` URLs;
  // keep it (and libsql) out of the server bundle so they load at runtime.
  experimental: {
    serverComponentsExternalPackages: ['@libsql/client', 'libsql'],
  },
};

export default nextConfig;
