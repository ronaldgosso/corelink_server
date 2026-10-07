import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
  // Server Configuration
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  apiPrefix: process.env.API_PREFIX || '/api',

  // Supabase Configuration
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  // Mistral AI Configuration
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || '',
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
  },

  // Security, Encryption & Tokens
  security: {
    // 32-byte hex string (64 characters) for AES-256-GCM token encryption
    encryptionKey: process.env.ENCRYPTION_KEY || '',
    jwtSecret: process.env.JWT_SECRET || 'corelink_jwt_default_secret_change_in_prod',
    cronSecret: process.env.CRON_SECRET || '',
  },

  // LinkedIn OAuth 2.0 & REST API Credentials
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || '',
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
    redirectUri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:5000/api/auth/linkedin/callback',
    apiVersion: process.env.LINKEDIN_VERSION || '202609',
  },

  // Redis Caching Configuration (Upstash REST or Standard Redis URL)
  redis: {
    url: process.env.REDIS_URL || '',
    upstashUrl: process.env.UPSTASH_REDIS_REST_URL || '',
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  },

  // DEV.to Configuration
  devto: {
    apiKey: process.env.DEVTO_API_KEY || '',
    apiUrl: process.env.DEVTO_API_URL || 'https://dev.to/api',
  },
};

/**
 * Validates essential environment variables and warns on missing configuration
 */
export const validateEnv = () => {
  const missing = [];

  if (config.nodeEnv === 'production') {
    if (!config.supabase.url) missing.push('SUPABASE_URL');
    if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!config.mistral.apiKey) missing.push('MISTRAL_API_KEY');
    if (!config.security.encryptionKey) missing.push('ENCRYPTION_KEY');
    if (!config.security.cronSecret) missing.push('CRON_SECRET');
    if (!config.linkedin.clientId) missing.push('LINKEDIN_CLIENT_ID');
    if (!config.linkedin.clientSecret) missing.push('LINKEDIN_CLIENT_SECRET');

    if (missing.length > 0) {
      console.warn(`[ENV WARNING] Missing critical production environment variables: ${missing.join(', ')}`);
    }
  }
};

// Run environment validation
validateEnv();

export default config;
