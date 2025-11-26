import { getDatabasePool } from '@infra/database';

export const migrationId = '002_tokenized_assets';

export const up = async (): Promise<void> => {
  const pool = getDatabasePool();

  await pool.query(`
    -- Token definitions table (RWAs + Crypto)
    CREATE TABLE IF NOT EXISTS tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_symbol TEXT NOT NULL UNIQUE,
      token_name TEXT NOT NULL,
      token_type TEXT NOT NULL CHECK (token_type IN ('RWA', 'CRYPTO', 'STABLE')),
      contract_address TEXT,
      blockchain TEXT NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 18,
      total_supply NUMERIC(78, 0),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- User token balances
    CREATE TABLE IF NOT EXISTS user_balances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      available_balance NUMERIC(78, 0) NOT NULL DEFAULT 0,
      locked_balance NUMERIC(78, 0) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, token_id),
      CONSTRAINT positive_balance CHECK (available_balance >= 0 AND locked_balance >= 0)
    );

    -- Trading pairs (e.g., BTC-USDC, PROPERTY-TOKEN-001-USDC)
    CREATE TABLE IF NOT EXISTS trading_pairs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      quote_token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      pair_symbol TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      min_order_size NUMERIC(78, 0),
      max_order_size NUMERIC(78, 0),
      price_precision INTEGER NOT NULL DEFAULT 8,
      quantity_precision INTEGER NOT NULL DEFAULT 8,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (base_token_id, quote_token_id)
    );

    -- Orders table
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_number BIGSERIAL UNIQUE,
      user_id UUID NOT NULL,
      trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id) ON DELETE CASCADE,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
      order_type TEXT NOT NULL CHECK (order_type IN ('LIMIT', 'MARKET', 'STOP_LIMIT')),
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'PARTIAL', 'FILLED', 'CANCELLED', 'REJECTED')) DEFAULT 'OPEN',
      price NUMERIC(78, 0),
      quantity NUMERIC(78, 0) NOT NULL,
      filled_quantity NUMERIC(78, 0) NOT NULL DEFAULT 0,
      average_fill_price NUMERIC(78, 0),
      time_in_force TEXT NOT NULL DEFAULT 'GTC',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT valid_quantities CHECK (quantity > 0 AND filled_quantity >= 0 AND filled_quantity <= quantity)
    );

    -- Trades table (completed matches)
    CREATE TABLE IF NOT EXISTS trades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_number BIGSERIAL UNIQUE,
      trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id) ON DELETE CASCADE,
      buyer_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      seller_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      buyer_id UUID NOT NULL,
      seller_id UUID NOT NULL,
      price NUMERIC(78, 0) NOT NULL,
      quantity NUMERIC(78, 0) NOT NULL,
      buyer_fee NUMERIC(78, 0) NOT NULL DEFAULT 0,
      seller_fee NUMERIC(78, 0) NOT NULL DEFAULT 0,
      settlement_status TEXT NOT NULL CHECK (settlement_status IN ('PENDING', 'SETTLED', 'FAILED')) DEFAULT 'PENDING',
      blockchain_tx_hash TEXT,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT positive_values CHECK (price > 0 AND quantity > 0)
    );

    -- Blockchain events tracking
    CREATE TABLE IF NOT EXISTS blockchain_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      blockchain TEXT NOT NULL,
      block_number BIGINT NOT NULL,
      transaction_hash TEXT NOT NULL,
      token_id UUID REFERENCES tokens(id) ON DELETE SET NULL,
      parsed_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed BOOLEAN NOT NULL DEFAULT false,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (blockchain, transaction_hash, event_type)
    );

    -- Compliance records (for RWA tokens)
    CREATE TABLE IF NOT EXISTS compliance_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      token_id UUID REFERENCES tokens(id) ON DELETE CASCADE,
      kyc_status TEXT NOT NULL CHECK (kyc_status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
      kyc_level TEXT,
      accreditation_status TEXT CHECK (accreditation_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
      whitelist_status BOOLEAN NOT NULL DEFAULT false,
      jurisdiction TEXT,
      expiry_date TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, token_id)
    );

    -- Audit log for all critical actions
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id UUID,
      order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
      trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address INET,
      user_agent TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Historical price data (OHLCV)
    CREATE TABLE IF NOT EXISTS price_candles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id) ON DELETE CASCADE,
      interval TEXT NOT NULL CHECK (interval IN ('1m', '5m', '15m', '1h', '4h', '1d', '1w')),
      open_price NUMERIC(78, 0) NOT NULL,
      high_price NUMERIC(78, 0) NOT NULL,
      low_price NUMERIC(78, 0) NOT NULL,
      close_price NUMERIC(78, 0) NOT NULL,
      volume NUMERIC(78, 0) NOT NULL,
      quote_volume NUMERIC(78, 0) NOT NULL,
      trades_count INTEGER NOT NULL DEFAULT 0,
      timestamp TIMESTAMPTZ NOT NULL,
      UNIQUE (trading_pair_id, interval, timestamp)
    );

    -- Market statistics
    CREATE TABLE IF NOT EXISTS market_stats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id) ON DELETE CASCADE,
      last_price NUMERIC(78, 0),
      price_change_24h NUMERIC(78, 0),
      price_change_percent_24h NUMERIC(10, 4),
      high_24h NUMERIC(78, 0),
      low_24h NUMERIC(78, 0),
      volume_24h NUMERIC(78, 0),
      quote_volume_24h NUMERIC(78, 0),
      trades_count_24h INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (trading_pair_id)
    );

    -- Withdrawal requests
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      amount NUMERIC(78, 0) NOT NULL,
      destination_address TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')) DEFAULT 'PENDING',
      blockchain_tx_hash TEXT,
      failure_reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT positive_amount CHECK (amount > 0)
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_user_balances_user ON user_balances(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_balances_token ON user_balances(token_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_pair_status ON orders(trading_pair_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status) WHERE status IN ('OPEN', 'PARTIAL');
    CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(trading_pair_id, executed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_buyer ON trades(buyer_id, executed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_seller ON trades(seller_id, executed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blockchain_events_unprocessed ON blockchain_events(processed, occurred_at) WHERE NOT processed;
    CREATE INDEX IF NOT EXISTS idx_blockchain_events_token ON blockchain_events(token_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_compliance_user_token ON compliance_records(user_id, token_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_price_candles_pair_interval ON price_candles(trading_pair_id, interval, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status) WHERE status IN ('PENDING', 'PROCESSING');
  `);
};

export const down = async (): Promise<void> => {
  const pool = getDatabasePool();
  await pool.query(`
    DROP TABLE IF EXISTS withdrawal_requests;
    DROP TABLE IF EXISTS market_stats;
    DROP TABLE IF EXISTS price_candles;
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS compliance_records;
    DROP TABLE IF EXISTS blockchain_events;
    DROP TABLE IF EXISTS trades;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS trading_pairs;
    DROP TABLE IF EXISTS user_balances;
    DROP TABLE IF EXISTS tokens;
  `);
};
