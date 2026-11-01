//! Sentineli vault: holds funds for AI agents and only moves them inside an
//! owner-set mandate, optionally gated by a Preflight approval signature.
//!
//! The agent signs `execute` with a function-call key scoped to this contract,
//! so it can never move funds that are not here, nor bypass the checks below.

mod action;
mod events;
mod mandate;

#[cfg(test)]
mod tests;

pub use action::{approval_message, AgentAction, Approval, NATIVE};
pub use mandate::{AssetLimit, AssetSpend, Mandate, MandateInput, DAY_NS};

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, CurveType, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue, PublicKey,
};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(100);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Callback results we read are tiny (a JSON U128 at most).
const MAX_RESULT_LEN: usize = 128;
/// Approvals must be short-lived: limits the gap between simulation and execution.
pub const MAX_APPROVAL_TTL_NS: u64 = 10 * 60 * 1_000_000_000;

/// Signs Preflight approvals (`public_key`) and may freeze agents (`account_id`).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Guardian {
    pub account_id: AccountId,
    pub public_key: PublicKey,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Rejection {
    VaultPanicked,
    AgentFrozen,
    MandateExpired,
    AssetNotAllowed,
    ZeroAmount,
    OverPerTxLimit,
    OverDailyLimit,
    ReceiverNotAllowed,
    InsufficientVaultBalance,
    ApprovalMissing,
    ApprovalExpired,
    ApprovalTtlTooLong,
    NoGuardianKey,
    BadSignature,
}

#[near(serializers = [json])]
#[serde(tag = "status", rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq)]
pub enum ExecOutcome {
    Rejected { reason: Rejection, strikes: u32, frozen: bool },
    Executed { kind: String, amount: U128, refunded: U128 },
    Failed { kind: String, refunded: U128 },
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Preview {
    pub allowed: bool,
    pub reason: Option<Rejection>,
    pub requires_approval: bool,
    pub nonce: u64,
    pub spent_today: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner_id: AccountId,
    guardian: Option<Guardian>,
    mandates: IterableMap<AccountId, Mandate>,
    /// Owner-funded budget per asset ("NEAR" or token account id).
    balances: IterableMap<String, u128>,
    /// Tokens accepted by `ft_on_transfer`; filled from mandate limits.
    tokens: IterableSet<AccountId>,
    panicked: bool,
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner_id: AccountId, guardian: Option<Guardian>) -> Self {
        if let Some(g) = &guardian {
            require!(g.public_key.curve_type() == CurveType::ED25519, "guardian key must be ed25519");
        }
        Self {
            owner_id,
            guardian,
            mandates: IterableMap::new(b"m"),
            balances: IterableMap::new(b"b"),
            tokens: IterableSet::new(b"t"),
            panicked: false,
        }
    }

    // ------------------------------------------------------------------ agent

    /// Called by the agent. Rejections are returned (not panicked) so the strike
    /// counter and auto-freeze persist on-chain.
    pub fn execute(&mut self, action: AgentAction, approval: Option<Approval>) -> PromiseOrValue<ExecOutcome> {
        let agent = env::predecessor_account_id();
        let mut mandate = self
            .mandates
            .get(&agent)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no mandate for this agent"));
        let now = env::block_timestamp();

        if let Err(reason) = self.check(&agent, &mandate, &action, approval.as_ref(), now, true) {
            mandate.strikes += 1;
            if !mandate.frozen && mandate.max_strikes > 0 && mandate.strikes >= mandate.max_strikes {
                mandate.freeze(format!("auto-frozen after {} rejected actions", mandate.strikes));
                events::emit("agent_frozen", json!({ "agent_id": agent, "by": "auto", "reason": mandate.frozen_reason }));
            }
            events::emit(
                "action_rejected",
                json!({ "agent_id": agent, "kind": action.kind(), "receiver_id": action.receiver(),
                        "amount": U128(action.amount()), "reason": reason, "strikes": mandate.strikes }),
            );
            let outcome = ExecOutcome::Rejected { reason, strikes: mandate.strikes, frozen: mandate.frozen };
            self.mandates.insert(agent, mandate);
            return PromiseOrValue::Value(outcome);
        }

        let asset = action.asset();
        let amount = action.amount();
        let window = mandate.record_spend(&asset, amount, now);
        mandate.nonce += 1;
        self.mandates.insert(agent.clone(), mandate);
        self.debit(&asset, amount);

        events::emit(
            "action_dispatched",
            json!({ "agent_id": agent, "kind": action.kind(), "asset": asset,
                    "receiver_id": action.receiver(), "amount": U128(amount), "approved": approval.is_some() }),
        );

        let call = match &action {
            AgentAction::FtTransfer { token, receiver_id, amount, memo } => Promise::new(token.clone())
                .function_call(
                    "ft_transfer",
                    json!({ "receiver_id": receiver_id, "amount": amount, "memo": memo }).to_string().into_bytes(),
                    ONE_YOCTO,
                    GAS_FT_TRANSFER,
                ),
            AgentAction::FtTransferCall { token, receiver_id, amount, msg } => Promise::new(token.clone())
                .function_call(
                    "ft_transfer_call",
                    json!({ "receiver_id": receiver_id, "amount": amount, "msg": msg }).to_string().into_bytes(),
                    ONE_YOCTO,
                    GAS_FT_TRANSFER_CALL,
                ),
            AgentAction::NearTransfer { receiver_id, amount } => {
                Promise::new(receiver_id.clone()).transfer(NearToken::from_yoctonear(amount.0))
            }
        };
        PromiseOrValue::Promise(
            call.then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_action_resolved(agent, action.kind().to_string(), asset, U128(amount), U64(window)),
            ),
        )
    }

    /// Restores budget + balance for whatever did not actually leave the vault.
    #[private]
    pub fn on_action_resolved(
        &mut self,
        agent_id: AccountId,
        kind: String,
        asset: String,
        amount: U128,
        window_start_ns: U64,
    ) -> ExecOutcome {
        let result = env::promise_result_checked(0, MAX_RESULT_LEN);
        let failed = matches!(result, Err(PromiseError::Failed));
        let refund = match result {
            Err(PromiseError::Failed) => amount.0,
            // ft_transfer_call resolves to the amount the receiver kept; if unreadable,
            // assume all of it left (ledger may under-count, never over-count).
            Ok(bytes) if kind == "ft_transfer_call" => {
                let used = serde_json::from_slice::<U128>(&bytes).map_or(amount.0, |u| u.0.min(amount.0));
                amount.0 - used
            }
            _ => 0,
        };

        if refund > 0 {
            self.credit(&asset, refund);
            if let Some(m) = self.mandates.get_mut(&agent_id) {
                m.refund_spend(&asset, refund, window_start_ns.0);
            }
        }
        events::emit(
            if failed { "action_failed" } else { "action_executed" },
            json!({ "agent_id": agent_id, "kind": kind, "asset": asset, "amount": amount, "refunded": U128(refund) }),
        );
        if failed {
            ExecOutcome::Failed { kind, refunded: U128(refund) }
        } else {
            ExecOutcome::Executed { kind, amount, refunded: U128(refund) }
        }
    }

    // ---------------------------------------------------------------- funding

    /// NEP-141 receiver: credits the sending token's balance. Unknown tokens are refunded.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let _ = msg;
        let token = env::predecessor_account_id();
        if !self.tokens.contains(&token) {
            return PromiseOrValue::Value(amount);
        }
        self.credit(token.as_str(), amount.0);
        events::emit("deposit", json!({ "asset": token, "from": sender_id, "amount": amount }));
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn deposit_near(&mut self) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach NEAR to deposit");
        self.credit(NATIVE, amount);
        events::emit("deposit", json!({ "asset": NATIVE, "from": env::predecessor_account_id(), "amount": U128(amount) }));
    }

    // ------------------------------------------------------------------ owner

    #[payable]
    pub fn set_mandate(&mut self, agent_id: AccountId, mandate: MandateInput) {
        self.assert_owner();
        for l in &mandate.limits {
            require!(l.per_tx.0 <= l.per_day.0, "per_tx cannot exceed per_day");
            if l.asset != NATIVE {
                let token: AccountId = l.asset.parse().unwrap_or_else(|_| env::panic_str("asset must be NEAR or a token account id"));
                self.tokens.insert(token);
            }
        }
        match self.mandates.get_mut(&agent_id) {
            Some(m) => m.update(mandate),
            None => {
                self.mandates.insert(agent_id.clone(), Mandate::new(mandate));
            }
        }
        events::emit("mandate_set", json!({ "agent_id": agent_id }));
    }

    #[payable]
    pub fn remove_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        self.mandates.remove(&agent_id);
        events::emit("agent_removed", json!({ "agent_id": agent_id }));
    }

    #[payable]
    pub fn unfreeze(&mut self, agent_id: AccountId) {
        self.assert_owner();
        let m = self.mandates.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("unknown agent"));
        m.frozen = false;
        m.frozen_reason = None;
        m.strikes = 0;
        events::emit("agent_unfrozen", json!({ "agent_id": agent_id }));
    }

    #[payable]
    pub fn set_guardian(&mut self, guardian: Option<Guardian>) {
        self.assert_owner();
        if let Some(g) = &guardian {
            require!(g.public_key.curve_type() == CurveType::ED25519, "guardian key must be ed25519");
        }
        self.guardian = guardian;
        events::emit("guardian_set", json!({ "guardian": self.guardian }));
    }

    #[payable]
    pub fn withdraw(&mut self, asset: String, amount: U128) -> Promise {
        self.assert_owner();
        self.debit(&asset, amount.0);
        self.send_to_owner(asset, amount.0)
    }

    /// Emergency stop: freezes every agent and sends every balance back to the owner.
    /// Removing the agent's access key happens in the same owner transaction, client-side
    /// (a contract cannot delete keys on another account).
    #[payable]
    pub fn trigger_panic(&mut self) {
        let caller = env::predecessor_account_id();
        if caller == self.owner_id {
            assert_one_yocto();
        } else {
            require!(self.is_guardian(&caller), "only owner or guardian");
        }
        self.panicked = true;
        for (_, m) in self.mandates.iter_mut() {
            if !m.frozen {
                m.freeze("panic".to_string());
            }
        }
        let drained: Vec<(String, u128)> = self.balances.iter().filter(|(_, v)| **v > 0).map(|(k, v)| (k.clone(), *v)).collect();
        for (asset, amount) in &drained {
            self.balances.insert(asset.clone(), 0);
            self.send_to_owner(asset.clone(), *amount).detach();
        }
        events::emit(
            "panic",
            json!({ "by": caller, "withdrawn": drained.iter().map(|(a, v)| json!({ "asset": a, "amount": U128(*v) })).collect::<Vec<_>>() }),
        );
    }

    #[payable]
    pub fn clear_panic(&mut self) {
        self.assert_owner();
        self.panicked = false;
        events::emit("panic_cleared", json!({}));
    }

    /// Guardian (e.g. the Preflight service) or owner. No deposit so a function-call key works.
    pub fn freeze(&mut self, agent_id: AccountId, reason: String) {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner_id || self.is_guardian(&caller), "only owner or guardian");
        let m = self.mandates.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("unknown agent"));
        m.freeze(reason.clone());
        events::emit("agent_frozen", json!({ "agent_id": agent_id, "by": caller, "reason": reason }));
    }

    #[private]
    pub fn on_withdraw_resolved(&mut self, asset: String, amount: U128) {
        if matches!(env::promise_result_checked(0, MAX_RESULT_LEN), Err(PromiseError::Failed)) {
            self.credit(&asset, amount.0);
            events::emit("withdraw_failed", json!({ "asset": asset, "amount": amount }));
        }
    }

    // ------------------------------------------------------------------ views

    /// Dry run of `execute` without signature check: what would happen, and the nonce to sign.
    pub fn preview(&self, agent_id: AccountId, action: AgentAction) -> Preview {
        let m = self.mandates.get(&agent_id).unwrap_or_else(|| env::panic_str("no mandate for this agent"));
        let now = env::block_timestamp();
        let reason = self.check(&agent_id, m, &action, None, now, false).err();
        Preview {
            allowed: reason.is_none(),
            reason,
            requires_approval: m.require_approval,
            nonce: m.nonce,
            spent_today: U128(m.spent_in_window(&action.asset(), now)),
        }
    }

    /// Exact bytes the guardian must sign for the agent's next action.
    pub fn get_approval_message(&self, agent_id: AccountId, action: AgentAction, expires_at_ns: U64) -> String {
        let m = self.mandates.get(&agent_id).unwrap_or_else(|| env::panic_str("no mandate for this agent"));
        approval_message(&env::current_account_id(), &agent_id, m.nonce, expires_at_ns.0, &action)
    }

    pub fn get_mandate(&self, agent_id: AccountId) -> Option<&Mandate> {
        self.mandates.get(&agent_id)
    }

    pub fn list_agents(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<(&AccountId, &Mandate)> {
        self.mandates
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .collect()
    }

    pub fn get_balance(&self, asset: String) -> U128 {
        U128(self.balances.get(&asset).copied().unwrap_or(0))
    }

    pub fn get_balances(&self) -> Vec<(&String, U128)> {
        self.balances.iter().map(|(k, v)| (k, U128(*v))).collect()
    }

    pub fn get_owner(&self) -> &AccountId {
        &self.owner_id
    }

    pub fn get_guardian(&self) -> Option<&Guardian> {
        self.guardian.as_ref()
    }

    pub fn is_panicked(&self) -> bool {
        self.panicked
    }
}

impl Vault {
    fn check(
        &self,
        agent: &AccountId,
        m: &Mandate,
        action: &AgentAction,
        approval: Option<&Approval>,
        now: u64,
        verify_approval: bool,
    ) -> Result<(), Rejection> {
        use Rejection::*;
        if self.panicked {
            return Err(VaultPanicked);
        }
        if m.frozen {
            return Err(AgentFrozen);
        }
        if m.is_expired(now) {
            return Err(MandateExpired);
        }
        let asset = action.asset();
        let limit = m.limit(&asset).ok_or(AssetNotAllowed)?;
        let amount = action.amount();
        if amount == 0 {
            return Err(ZeroAmount);
        }
        if amount > limit.per_tx.0 {
            return Err(OverPerTxLimit);
        }
        if m.spent_in_window(&asset, now) + amount > limit.per_day.0 {
            return Err(OverDailyLimit);
        }
        if !m.allows_receiver(action.receiver()) {
            return Err(ReceiverNotAllowed);
        }
        if self.balances.get(&asset).copied().unwrap_or(0) < amount {
            return Err(InsufficientVaultBalance);
        }
        if m.require_approval && verify_approval {
            let a = approval.ok_or(ApprovalMissing)?;
            if now >= a.expires_at_ns.0 {
                return Err(ApprovalExpired);
            }
            if a.expires_at_ns.0 > now + MAX_APPROVAL_TTL_NS {
                return Err(ApprovalTtlTooLong);
            }
            let g = self.guardian.as_ref().ok_or(NoGuardianKey)?;
            let msg = approval_message(&env::current_account_id(), agent, m.nonce, a.expires_at_ns.0, action);
            let sig: [u8; 64] = a.signature.0.as_slice().try_into().map_err(|_| BadSignature)?;
            let pk: [u8; 32] = g.public_key.as_bytes()[1..].try_into().map_err(|_| NoGuardianKey)?;
            if !env::ed25519_verify(&sig, msg.as_bytes(), &pk) {
                return Err(BadSignature);
            }
        }
        Ok(())
    }

    fn assert_owner(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner_id, "only owner");
    }

    fn is_guardian(&self, account: &AccountId) -> bool {
        self.guardian.as_ref().is_some_and(|g| &g.account_id == account)
    }

    fn credit(&mut self, asset: &str, amount: u128) {
        let bal = self.balances.get(asset).copied().unwrap_or(0);
        self.balances.insert(asset.to_string(), bal + amount);
    }

    fn debit(&mut self, asset: &str, amount: u128) {
        let bal = self.balances.get(asset).copied().unwrap_or(0);
        require!(bal >= amount, "insufficient vault balance");
        self.balances.insert(asset.to_string(), bal - amount);
    }

    fn send_to_owner(&self, asset: String, amount: u128) -> Promise {
        if asset == NATIVE {
            return Promise::new(self.owner_id.clone()).transfer(NearToken::from_yoctonear(amount));
        }
        let token: AccountId = asset.parse().unwrap_or_else(|_| env::panic_str("bad asset id"));
        Promise::new(token)
            .function_call(
                "ft_transfer",
                json!({ "receiver_id": self.owner_id, "amount": U128(amount) }).to_string().into_bytes(),
                ONE_YOCTO,
                GAS_FT_TRANSFER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_withdraw_resolved(asset, U128(amount)),
            )
    }
}
