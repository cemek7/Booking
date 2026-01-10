-- Payment System Infrastructure - Production Grade
-- This migration creates comprehensive payment and financial management tables

-- Create transactions table for all payment operations
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    parent_transaction_id UUID REFERENCES transactions(id), -- For refunds/related transactions
    amount INTEGER NOT NULL CHECK (amount > 0), -- Amount in cents
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    type VARCHAR(20) NOT NULL CHECK (type IN ('payment', 'refund', 'partial_refund', 'chargeback', 'fee', 'adjustment', 'transfer')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'disputed', 'expired')),
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('stripe', 'paystack', 'flutterwave')),
    provider_transaction_id VARCHAR(255) NOT NULL,
    payment_method VARCHAR(50) CHECK (payment_method IN ('card', 'bank_transfer', 'mobile_money', 'crypto')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient querying
CREATE INDEX idx_transactions_booking ON transactions (booking_id);
CREATE INDEX idx_transactions_tenant ON transactions (tenant_id);
CREATE INDEX idx_transactions_status ON transactions (status);
CREATE INDEX idx_transactions_provider ON transactions (provider, provider_transaction_id);
CREATE INDEX idx_transactions_type ON transactions (type);
CREATE INDEX idx_transactions_parent ON transactions (parent_transaction_id);
CREATE INDEX idx_transactions_created ON transactions (created_at);
CREATE INDEX idx_transactions_amount ON transactions (amount, currency);

-- Create unique index for provider transactions
CREATE UNIQUE INDEX idx_transactions_provider_unique ON transactions (provider, provider_transaction_id);

-- Create ledger_entries table for double-entry bookkeeping
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    account VARCHAR(100) NOT NULL, -- revenue, customer_payments, fees, refunds, etc.
    type VARCHAR(10) NOT NULL CHECK (type IN ('debit', 'credit')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for ledger
CREATE INDEX idx_ledger_transaction ON ledger_entries (transaction_id);
CREATE INDEX idx_ledger_tenant ON ledger_entries (tenant_id);
CREATE INDEX idx_ledger_account ON ledger_entries (account);
CREATE INDEX idx_ledger_type ON ledger_entries (type);
CREATE INDEX idx_ledger_created ON ledger_entries (created_at);

-- Create payment_methods table for stored customer payment methods
CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id VARCHAR(255) NOT NULL, -- External customer ID from provider
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_payment_method_id VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('card', 'bank_account', 'mobile_money')),
    is_default BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}', -- Masked details like last 4 digits, expiry, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for payment methods
CREATE INDEX idx_payment_methods_customer ON payment_methods (customer_id, tenant_id);
CREATE INDEX idx_payment_methods_provider ON payment_methods (provider, provider_payment_method_id);
CREATE UNIQUE INDEX idx_payment_methods_provider_unique ON payment_methods (provider, provider_payment_method_id);

-- Create fraud_analysis table for fraud detection results
CREATE TABLE fraud_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    recommendation VARCHAR(20) NOT NULL CHECK (recommendation IN ('approve', 'review', 'decline')),
    indicators JSONB DEFAULT '[]', -- Array of fraud indicators
    ip_address INET,
    user_agent TEXT,
    device_fingerprint VARCHAR(255),
    geographic_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fraud analysis
CREATE INDEX idx_fraud_analysis_transaction ON fraud_analysis (transaction_id);
CREATE INDEX idx_fraud_analysis_risk_score ON fraud_analysis (risk_score);
CREATE INDEX idx_fraud_analysis_risk_level ON fraud_analysis (risk_level);
CREATE INDEX idx_fraud_analysis_ip ON fraud_analysis (ip_address);
CREATE INDEX idx_fraud_analysis_created ON fraud_analysis (created_at);

-- Create payment_reconciliation table for tracking reconciliation with providers
CREATE TABLE payment_reconciliation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    reconciliation_date DATE NOT NULL,
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    matched_transactions INTEGER DEFAULT 0,
    unmatched_transactions INTEGER DEFAULT 0,
    discrepancies INTEGER DEFAULT 0,
    total_amount INTEGER DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    reconciliation_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for reconciliation
CREATE INDEX idx_payment_reconciliation_provider ON payment_reconciliation (provider);
CREATE INDEX idx_payment_reconciliation_date ON payment_reconciliation (reconciliation_date);
CREATE INDEX idx_payment_reconciliation_status ON payment_reconciliation (status);

-- Create payment_disputes table for chargeback and dispute management
CREATE TABLE payment_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    provider_dispute_id VARCHAR(255) NOT NULL,
    dispute_type VARCHAR(50) NOT NULL CHECK (dispute_type IN ('chargeback', 'inquiry', 'retrieval', 'fraud')),
    reason_code VARCHAR(20),
    reason_description TEXT,
    amount INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('received', 'under_review', 'accepted', 'disputed', 'won', 'lost')),
    due_date TIMESTAMP WITH TIME ZONE,
    evidence_due_date TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for disputes
CREATE INDEX idx_payment_disputes_transaction ON payment_disputes (transaction_id);
CREATE INDEX idx_payment_disputes_provider ON payment_disputes (provider_dispute_id);
CREATE INDEX idx_payment_disputes_status ON payment_disputes (status);
CREATE INDEX idx_payment_disputes_due_date ON payment_disputes (due_date);

-- Create payment_fees table for tracking fees charged by payment providers
CREATE TABLE payment_fees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    fee_type VARCHAR(50) NOT NULL CHECK (fee_type IN ('processing', 'international', 'chargeback', 'refund', 'subscription')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    rate DECIMAL(5,4), -- Fee rate as decimal (e.g., 0.029 for 2.9%)
    fixed_amount INTEGER DEFAULT 0, -- Fixed fee amount in cents
    provider VARCHAR(50) NOT NULL,
    provider_fee_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fees
CREATE INDEX idx_payment_fees_transaction ON payment_fees (transaction_id);
CREATE INDEX idx_payment_fees_tenant ON payment_fees (tenant_id);
CREATE INDEX idx_payment_fees_type ON payment_fees (fee_type);
CREATE INDEX idx_payment_fees_provider ON payment_fees (provider);
CREATE INDEX idx_payment_fees_created ON payment_fees (created_at);

-- Enable RLS on all payment tables
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_fees ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
CREATE POLICY "transactions_tenant_isolation" ON transactions
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "ledger_entries_tenant_isolation" ON ledger_entries
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "payment_methods_tenant_isolation" ON payment_methods
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

-- Service role has full access
CREATE POLICY "transactions_service_access" ON transactions
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "fraud_analysis_service_access" ON fraud_analysis
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "payment_reconciliation_admin_access" ON payment_reconciliation
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "payment_disputes_admin_access" ON payment_disputes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM tenant_users tu
            JOIN transactions t ON t.tenant_id = tu.tenant_id
            WHERE tu.user_id = auth.uid()
            AND t.id = payment_disputes.transaction_id
            AND tu.role IN ('admin', 'superadmin')
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "payment_fees_tenant_isolation" ON payment_fees
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

-- ===============================
-- STORED PROCEDURES
-- ===============================

-- Function to calculate net revenue for a tenant
CREATE OR REPLACE FUNCTION get_tenant_revenue(
    p_tenant_id UUID,
    p_start_date TIMESTAMP WITH TIME ZONE,
    p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    gross_revenue BIGINT,
    refunds BIGINT,
    fees BIGINT,
    net_revenue BIGINT,
    transaction_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH revenue_data AS (
        SELECT 
            COALESCE(SUM(CASE WHEN t.type = 'payment' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) as gross,
            COALESCE(SUM(CASE WHEN t.type IN ('refund', 'partial_refund') AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) as refunded,
            COALESCE(SUM(pf.amount), 0) as total_fees,
            COUNT(CASE WHEN t.type = 'payment' AND t.status = 'completed' THEN 1 END)::INTEGER as txn_count
        FROM transactions t
        LEFT JOIN payment_fees pf ON pf.transaction_id = t.id
        WHERE t.tenant_id = p_tenant_id
        AND t.created_at >= p_start_date
        AND t.created_at <= p_end_date
    )
    SELECT 
        rd.gross,
        rd.refunded,
        rd.total_fees,
        (rd.gross - rd.refunded - rd.total_fees),
        rd.txn_count
    FROM revenue_data rd;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get payment metrics
CREATE OR REPLACE FUNCTION get_payment_metrics(
    p_tenant_id UUID DEFAULT NULL,
    p_time_range INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS JSONB AS $$
DECLARE
    start_time TIMESTAMP WITH TIME ZONE;
    result JSONB;
BEGIN
    start_time := NOW() - p_time_range;
    
    SELECT jsonb_build_object(
        'transactions', jsonb_build_object(
            'total', COUNT(*),
            'by_status', jsonb_object_agg(status, status_count),
            'by_provider', jsonb_object_agg(provider, provider_count),
            'total_volume', SUM(amount),
            'avg_transaction_size', AVG(amount)
        ),
        'success_rate', (
            COUNT(*) FILTER (WHERE status = 'completed')::FLOAT / 
            NULLIF(COUNT(*), 0)
        ),
        'fraud', jsonb_build_object(
            'high_risk_transactions', (
                SELECT COUNT(*) 
                FROM fraud_analysis fa 
                JOIN transactions t ON t.id = fa.transaction_id
                WHERE fa.risk_level IN ('high', 'critical')
                AND t.created_at >= start_time
                AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
            ),
            'avg_risk_score', (
                SELECT AVG(fa.risk_score) 
                FROM fraud_analysis fa 
                JOIN transactions t ON t.id = fa.transaction_id
                WHERE t.created_at >= start_time
                AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
            )
        )
    ) INTO result
    FROM (
        SELECT 
            t.*,
            COUNT(*) OVER (PARTITION BY t.status) as status_count,
            COUNT(*) OVER (PARTITION BY t.provider) as provider_count
        FROM transactions t
        WHERE t.created_at >= start_time
        AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
    ) grouped;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to validate ledger balance
CREATE OR REPLACE FUNCTION validate_ledger_balance(
    p_tenant_id UUID DEFAULT NULL
)
RETURNS TABLE (
    account VARCHAR(100),
    balance BIGINT,
    debit_total BIGINT,
    credit_total BIGINT,
    is_balanced BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        le.account,
        (SUM(CASE WHEN le.type = 'debit' THEN le.amount ELSE -le.amount END)) as balance,
        SUM(CASE WHEN le.type = 'debit' THEN le.amount ELSE 0 END) as debit_total,
        SUM(CASE WHEN le.type = 'credit' THEN le.amount ELSE 0 END) as credit_total,
        (SUM(CASE WHEN le.type = 'debit' THEN le.amount ELSE -le.amount END) = 0) as is_balanced
    FROM ledger_entries le
    WHERE (p_tenant_id IS NULL OR le.tenant_id = p_tenant_id)
    GROUP BY le.account
    ORDER BY le.account;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to process automatic refund
CREATE OR REPLACE FUNCTION process_automatic_refund(
    p_transaction_id UUID,
    p_refund_amount INTEGER DEFAULT NULL,
    p_reason TEXT DEFAULT 'Automatic refund'
)
RETURNS UUID AS $$
DECLARE
    original_txn RECORD;
    refund_id UUID;
    refund_amount INTEGER;
BEGIN
    -- Get original transaction
    SELECT * INTO original_txn
    FROM transactions 
    WHERE id = p_transaction_id 
    AND type = 'payment' 
    AND status = 'completed';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original transaction not found or not eligible for refund';
    END IF;
    
    -- Calculate refund amount
    refund_amount := COALESCE(p_refund_amount, original_txn.amount);
    
    -- Validate refund amount doesn't exceed available balance
    IF refund_amount > original_txn.amount THEN
        RAISE EXCEPTION 'Refund amount exceeds original transaction amount';
    END IF;
    
    -- Create refund transaction
    INSERT INTO transactions (
        booking_id, tenant_id, parent_transaction_id,
        amount, currency, type, status, provider,
        provider_transaction_id, payment_method,
        metadata
    ) VALUES (
        original_txn.booking_id, original_txn.tenant_id, original_txn.id,
        refund_amount, original_txn.currency, 
        CASE WHEN refund_amount = original_txn.amount THEN 'refund' ELSE 'partial_refund' END,
        'processing', original_txn.provider,
        'auto_refund_' || original_txn.provider_transaction_id || '_' || EXTRACT(EPOCH FROM NOW()),
        original_txn.payment_method,
        jsonb_build_object(
            'reason', p_reason,
            'automatic', true,
            'original_transaction_id', original_txn.id
        )
    ) RETURNING id INTO refund_id;
    
    RETURN refund_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old payment data
CREATE OR REPLACE FUNCTION cleanup_payment_data(
    retention_days INTEGER DEFAULT 2555 -- 7 years for financial records
)
RETURNS TABLE (
    deleted_transactions INTEGER,
    deleted_ledger_entries INTEGER,
    deleted_fraud_analysis INTEGER
) AS $$
DECLARE
    cutoff_date TIMESTAMP WITH TIME ZONE;
    txn_deleted INTEGER;
    ledger_deleted INTEGER;
    fraud_deleted INTEGER;
BEGIN
    cutoff_date := NOW() - INTERVAL '1 day' * retention_days;
    
    -- Delete old fraud analysis records
    DELETE FROM fraud_analysis 
    WHERE created_at < cutoff_date;
    GET DIAGNOSTICS fraud_deleted = ROW_COUNT;
    
    -- Archive old completed transactions (don't delete for audit purposes)
    -- This would typically move to an archive table instead of deleting
    -- DELETE FROM transactions 
    -- WHERE created_at < cutoff_date 
    -- AND status IN ('completed', 'failed', 'cancelled');
    -- GET DIAGNOSTICS txn_deleted = ROW_COUNT;
    
    txn_deleted := 0; -- No deletion for audit compliance
    ledger_deleted := 0; -- Never delete ledger entries
    
    RETURN QUERY SELECT txn_deleted, ledger_deleted, fraud_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================
-- TRIGGERS
-- ===============================

-- Trigger to update transaction updated_at timestamp
CREATE OR REPLACE FUNCTION update_transaction_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    
    -- Set completion timestamp
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        NEW.completed_at = NOW();
    END IF;
    
    -- Set failure timestamp
    IF NEW.status = 'failed' AND OLD.status != 'failed' THEN
        NEW.failed_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_transaction_timestamp
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_transaction_timestamp();

-- Trigger to automatically create ledger entries
CREATE OR REPLACE FUNCTION create_automatic_ledger_entries()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create ledger entries for completed payments and refunds
    IF NEW.status = 'completed' AND NEW.type IN ('payment', 'refund', 'partial_refund') THEN
        IF NEW.type = 'payment' THEN
            -- Debit customer payments, credit revenue
            INSERT INTO ledger_entries (
                transaction_id, tenant_id, account, type, amount, currency, description
            ) VALUES 
            (NEW.id, NEW.tenant_id, 'customer_payments', 'debit', NEW.amount, NEW.currency, 'Customer payment received'),
            (NEW.id, NEW.tenant_id, 'revenue', 'credit', NEW.amount, NEW.currency, 'Revenue from booking payment');
        ELSIF NEW.type IN ('refund', 'partial_refund') THEN
            -- Debit revenue, credit customer refunds
            INSERT INTO ledger_entries (
                transaction_id, tenant_id, account, type, amount, currency, description
            ) VALUES 
            (NEW.id, NEW.tenant_id, 'revenue', 'debit', NEW.amount, NEW.currency, 'Refund processed'),
            (NEW.id, NEW.tenant_id, 'customer_refunds', 'credit', NEW.amount, NEW.currency, 'Customer refund issued');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_ledger_entries
    AFTER UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION create_automatic_ledger_entries();

-- ===============================
-- INITIAL DATA
-- ===============================

-- Insert default chart of accounts
-- This would typically be configured per tenant, but we'll add some defaults

-- ===============================
-- COMMENTS
-- ===============================

COMMENT ON TABLE transactions IS 'All payment transactions including payments, refunds, and fees';
COMMENT ON TABLE ledger_entries IS 'Double-entry bookkeeping ledger for financial integrity';
COMMENT ON TABLE payment_methods IS 'Stored customer payment methods from providers';
COMMENT ON TABLE fraud_analysis IS 'Fraud detection results for transaction risk assessment';
COMMENT ON TABLE payment_reconciliation IS 'Reconciliation tracking with payment providers';
COMMENT ON TABLE payment_disputes IS 'Chargeback and dispute management';
COMMENT ON TABLE payment_fees IS 'Payment processing fees charged by providers';

COMMENT ON FUNCTION get_tenant_revenue IS 'Calculate net revenue for a tenant over a time period';
COMMENT ON FUNCTION get_payment_metrics IS 'Get comprehensive payment system metrics';
COMMENT ON FUNCTION validate_ledger_balance IS 'Validate double-entry ledger balance integrity';
COMMENT ON FUNCTION process_automatic_refund IS 'Process automatic refunds with validation';
COMMENT ON FUNCTION cleanup_payment_data IS 'Clean up old payment data while maintaining audit compliance';