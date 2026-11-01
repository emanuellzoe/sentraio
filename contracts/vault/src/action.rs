use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::{near, AccountId};

/// Asset id used for native NEAR in limits and balances.
pub const NATIVE: &str = "NEAR";

/// Everything an agent may ask the vault to do.
#[near(serializers = [json])]
#[serde(tag = "type", rename_all = "snake_case")]
#[derive(Clone, Debug)]
pub enum AgentAction {
    FtTransfer {
        token: AccountId,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
    },
    FtTransferCall {
        token: AccountId,
        receiver_id: AccountId,
        amount: U128,
        msg: String,
    },
    NearTransfer {
        receiver_id: AccountId,
        amount: U128,
    },
}

impl AgentAction {
    pub fn asset(&self) -> String {
        match self {
            Self::FtTransfer { token, .. } | Self::FtTransferCall { token, .. } => token.to_string(),
            Self::NearTransfer { .. } => NATIVE.to_string(),
        }
    }

    pub fn receiver(&self) -> &AccountId {
        match self {
            Self::FtTransfer { receiver_id, .. }
            | Self::FtTransferCall { receiver_id, .. }
            | Self::NearTransfer { receiver_id, .. } => receiver_id,
        }
    }

    pub fn amount(&self) -> u128 {
        match self {
            Self::FtTransfer { amount, .. }
            | Self::FtTransferCall { amount, .. }
            | Self::NearTransfer { amount, .. } => amount.0,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::FtTransfer { .. } => "ft_transfer",
            Self::FtTransferCall { .. } => "ft_transfer_call",
            Self::NearTransfer { .. } => "near_transfer",
        }
    }

    /// Unambiguous encoding: every field is `<byte length>:<value>`, so free-form
    /// memo/msg text can never make two different actions encode the same.
    pub fn canonical(&self) -> String {
        let (token, memo_or_msg) = match self {
            Self::FtTransfer { token, memo, .. } => (token.as_str(), memo.clone().unwrap_or_default()),
            Self::FtTransferCall { token, msg, .. } => (token.as_str(), msg.clone()),
            Self::NearTransfer { .. } => (NATIVE, String::new()),
        };
        encode(&[
            self.kind(),
            token,
            self.receiver().as_str(),
            &self.amount().to_string(),
            &memo_or_msg,
        ])
    }
}

/// Preflight's signed go-ahead for exactly one action.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Approval {
    /// ed25519 signature (64 bytes) over `approval_message(...)` bytes.
    pub signature: Base64VecU8,
    pub expires_at_ns: U64,
}

pub fn approval_message(
    vault: &AccountId,
    agent: &AccountId,
    nonce: u64,
    expires_at_ns: u64,
    action: &AgentAction,
) -> String {
    format!(
        "sentineli-approval:v1|{}",
        encode(&[
            vault.as_str(),
            agent.as_str(),
            &nonce.to_string(),
            &expires_at_ns.to_string(),
            &action.canonical(),
        ])
    )
}

fn encode(fields: &[&str]) -> String {
    fields
        .iter()
        .map(|f| format!("{}:{}", f.len(), f))
        .collect::<Vec<_>>()
        .join("|")
}
