use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

pub const DAY_NS: u64 = 86_400 * 1_000_000_000;

/// Spending cap for one asset ("NEAR" or a NEP-141 token account id).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetLimit {
    pub asset: String,
    pub per_tx: U128,
    pub per_day: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetSpend {
    pub asset: String,
    pub window_start_ns: U64,
    pub spent: U128,
}

/// What the owner sends to `set_mandate`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MandateInput {
    pub limits: Vec<AssetLimit>,
    /// `None` = any receiver; otherwise only these accounts.
    pub allowed_receivers: Option<Vec<AccountId>>,
    pub expires_at_ns: Option<U64>,
    /// Require a Preflight approval signed by the guardian key on every action.
    pub require_approval: bool,
    /// Rejections before the agent is frozen automatically (0 = never).
    pub max_strikes: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Mandate {
    pub limits: Vec<AssetLimit>,
    pub allowed_receivers: Option<Vec<AccountId>>,
    pub expires_at_ns: Option<U64>,
    pub require_approval: bool,
    pub max_strikes: u32,
    pub strikes: u32,
    pub frozen: bool,
    pub frozen_reason: Option<String>,
    /// Consumed by every approved action; part of the signed approval message.
    pub nonce: u64,
    pub spends: Vec<AssetSpend>,
}

impl Mandate {
    pub fn new(input: MandateInput) -> Self {
        Self {
            limits: input.limits,
            allowed_receivers: input.allowed_receivers,
            expires_at_ns: input.expires_at_ns,
            require_approval: input.require_approval,
            max_strikes: input.max_strikes,
            strikes: 0,
            frozen: false,
            frozen_reason: None,
            nonce: 0,
            spends: Vec::new(),
        }
    }

    /// Replace the policy but keep counters, spend history and freeze state.
    pub fn update(&mut self, input: MandateInput) {
        self.limits = input.limits;
        self.allowed_receivers = input.allowed_receivers;
        self.expires_at_ns = input.expires_at_ns;
        self.require_approval = input.require_approval;
        self.max_strikes = input.max_strikes;
    }

    pub fn limit(&self, asset: &str) -> Option<&AssetLimit> {
        self.limits.iter().find(|l| l.asset == asset)
    }

    pub fn allows_receiver(&self, receiver: &AccountId) -> bool {
        self.allowed_receivers
            .as_ref()
            .map_or(true, |list| list.contains(receiver))
    }

    pub fn is_expired(&self, now_ns: u64) -> bool {
        self.expires_at_ns.is_some_and(|e| now_ns >= e.0)
    }

    /// Start of the 24h window that `now_ns` falls in for this asset.
    pub fn window_start(&self, asset: &str, now_ns: u64) -> u64 {
        match self.spends.iter().find(|s| s.asset == asset) {
            Some(s) if now_ns < s.window_start_ns.0 + DAY_NS => s.window_start_ns.0,
            _ => now_ns,
        }
    }

    pub fn spent_in_window(&self, asset: &str, now_ns: u64) -> u128 {
        let start = self.window_start(asset, now_ns);
        self.spends
            .iter()
            .find(|s| s.asset == asset && s.window_start_ns.0 == start)
            .map_or(0, |s| s.spent.0)
    }

    /// Returns the window the spend was booked in, so a failed action can be refunded into it.
    pub fn record_spend(&mut self, asset: &str, amount: u128, now_ns: u64) -> u64 {
        let start = self.window_start(asset, now_ns);
        match self.spends.iter_mut().find(|s| s.asset == asset) {
            Some(s) if s.window_start_ns.0 == start => s.spent = U128(s.spent.0 + amount),
            Some(s) => {
                s.window_start_ns = U64(start);
                s.spent = U128(amount);
            }
            None => self.spends.push(AssetSpend {
                asset: asset.to_string(),
                window_start_ns: U64(start),
                spent: U128(amount),
            }),
        }
        start
    }

    /// Give back budget for an action that failed, unless that window has already rolled over.
    pub fn refund_spend(&mut self, asset: &str, amount: u128, window_start_ns: u64) {
        if let Some(s) = self
            .spends
            .iter_mut()
            .find(|s| s.asset == asset && s.window_start_ns.0 == window_start_ns)
        {
            s.spent = U128(s.spent.0.saturating_sub(amount));
        }
    }

    pub fn freeze(&mut self, reason: String) {
        self.frozen = true;
        self.frozen_reason = Some(reason);
    }
}
