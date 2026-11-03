use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::Base64VecU8;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const T0: u64 = 1_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.testnet")
}
fn agent() -> AccountId {
    acc("agent.owner.testnet")
}
fn guardian_acc() -> AccountId {
    acc("clearance.testnet")
}
fn usdc() -> AccountId {
    acc("usdc.testnet")
}
fn shop() -> AccountId {
    acc("shop.testnet")
}
fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn guardian() -> Guardian {
    let mut bytes = vec![0u8]; // ed25519 curve tag
    bytes.extend_from_slice(signing_key().verifying_key().as_bytes());
    Guardian { account_id: guardian_acc(), public_key: PublicKey::try_from(bytes).unwrap() }
}

fn ctx(predecessor: AccountId, deposit: u128, now: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("vault.testnet"))
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now)
        .build());
}

fn ctx_with_result(result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc("vault.testnet"))
            .predecessor_account_id(acc("vault.testnet"))
            .block_timestamp(T0)
            .build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn usdc_limit(per_tx: u128, per_day: u128) -> AssetLimit {
    AssetLimit { asset: usdc().to_string(), per_tx: U128(per_tx), per_day: U128(per_day) }
}

/// Vault with 1000 USDC and an agent allowed 100/tx, 250/day, max 3 strikes.
fn setup(require_approval: bool, receivers: Option<Vec<AccountId>>) -> Vault {
    ctx(owner(), 0, T0);
    let mut v = Vault::new(owner(), Some(guardian()));
    ctx(owner(), 1, T0);
    v.set_mandate(
        agent(),
        MandateInput {
            limits: vec![usdc_limit(100, 250)],
            allowed_receivers: receivers,
            expires_at_ns: None,
            require_approval,
            max_strikes: 3,
        },
    );
    ctx(usdc(), 0, T0);
    let _ = v.ft_on_transfer(owner(), U128(1000), String::new());
    v
}

fn pay(amount: u128) -> AgentAction {
    AgentAction::FtTransfer { token: usdc(), receiver_id: shop(), amount: U128(amount), memo: None }
}

fn exec(v: &mut Vault, action: AgentAction, approval: Option<Approval>, now: u64) -> Option<ExecOutcome> {
    ctx(agent(), 0, now);
    match v.execute(action, approval) {
        PromiseOrValue::Value(o) => Some(o),
        PromiseOrValue::Promise(_) => None, // dispatched
    }
}

fn reason(o: Option<ExecOutcome>) -> Rejection {
    match o {
        Some(ExecOutcome::Rejected { reason, .. }) => reason,
        other => panic!("expected rejection, got {other:?}"),
    }
}

fn sign(v: &Vault, action: &AgentAction, expires: u64) -> Approval {
    let msg = v.get_approval_message(agent(), action.clone(), U64(expires));
    Approval {
        signature: Base64VecU8(signing_key().sign(msg.as_bytes()).to_bytes().to_vec()),
        expires_at_ns: U64(expires),
    }
}

#[test]
fn dispatches_within_limits_and_debits_balance() {
    let mut v = setup(false, None);
    assert!(exec(&mut v, pay(100), None, T0).is_none());
    assert_eq!(v.get_balance(usdc().to_string()).0, 900);
    assert_eq!(v.get_mandate(agent()).unwrap().spends[0].spent.0, 100);
}

#[test]
fn enforces_per_tx_and_daily_limit_with_window_reset() {
    let mut v = setup(false, None);
    assert_eq!(reason(exec(&mut v, pay(101), None, T0)), Rejection::OverPerTxLimit);
    assert!(exec(&mut v, pay(100), None, T0).is_none());
    assert!(exec(&mut v, pay(100), None, T0 + 1).is_none());
    assert_eq!(reason(exec(&mut v, pay(100), None, T0 + 2)), Rejection::OverDailyLimit);
    // next day the budget is back
    assert!(exec(&mut v, pay(100), None, T0 + DAY_NS).is_none());
}

#[test]
fn rejects_unknown_asset_and_receiver() {
    let mut v = setup(false, Some(vec![shop()]));
    let other = AgentAction::FtTransfer { token: usdc(), receiver_id: acc("attacker.testnet"), amount: U128(1), memo: None };
    assert_eq!(reason(exec(&mut v, other, None, T0)), Rejection::ReceiverNotAllowed);
    let native = AgentAction::NearTransfer { receiver_id: shop(), amount: U128(1) };
    assert_eq!(reason(exec(&mut v, native, None, T0)), Rejection::AssetNotAllowed);
}

#[test]
fn strikes_auto_freeze_and_only_owner_unfreezes() {
    let mut v = setup(false, None);
    for _ in 0..3 {
        exec(&mut v, pay(500), None, T0);
    }
    let m = v.get_mandate(agent()).unwrap();
    assert!(m.frozen);
    assert_eq!(reason(exec(&mut v, pay(1), None, T0)), Rejection::AgentFrozen);
    assert!(get_logs().iter().any(|l| l.contains("action_rejected")));

    ctx(owner(), 1, T0);
    v.unfreeze(agent());
    assert!(exec(&mut v, pay(1), None, T0).is_none());
}

#[test]
#[should_panic(expected = "only owner")]
fn agent_cannot_unfreeze_itself() {
    let mut v = setup(false, None);
    ctx(agent(), 1, T0);
    v.unfreeze(agent());
}

#[test]
fn approval_required_valid_signature_passes_once() {
    let mut v = setup(true, None);
    assert_eq!(reason(exec(&mut v, pay(10), None, T0)), Rejection::ApprovalMissing);

    let a = sign(&v, &pay(10), T0 + 60_000_000_000);
    assert!(exec(&mut v, pay(10), Some(a.clone()), T0).is_none());
    // same approval again: nonce moved on, signature no longer matches (no replay)
    assert_eq!(reason(exec(&mut v, pay(10), Some(a), T0)), Rejection::BadSignature);
}

#[test]
fn approval_for_one_action_cannot_be_reused_for_another() {
    let mut v = setup(true, None);
    let a = sign(&v, &pay(10), T0 + 60_000_000_000);
    assert_eq!(reason(exec(&mut v, pay(99), Some(a), T0)), Rejection::BadSignature);
}

#[test]
fn approval_expiry_and_ttl_are_enforced() {
    let mut v = setup(true, None);
    let expired = sign(&v, &pay(10), T0);
    assert_eq!(reason(exec(&mut v, pay(10), Some(expired), T0)), Rejection::ApprovalExpired);
    let too_long = sign(&v, &pay(10), T0 + MAX_APPROVAL_TTL_NS + 1);
    assert_eq!(reason(exec(&mut v, pay(10), Some(too_long), T0)), Rejection::ApprovalTtlTooLong);
}

#[test]
fn failed_transfer_refunds_balance_and_budget() {
    let mut v = setup(false, None);
    exec(&mut v, pay(100), None, T0);
    ctx_with_result(PromiseResult::Failed);
    let out = v.on_action_resolved(agent(), "ft_transfer".into(), usdc().to_string(), U128(100), U64(T0));
    assert_eq!(out, ExecOutcome::Failed { kind: "ft_transfer".into(), refunded: U128(100) });
    assert_eq!(v.get_balance(usdc().to_string()).0, 1000);
    assert_eq!(v.get_mandate(agent()).unwrap().spends[0].spent.0, 0);
}

#[test]
fn transfer_call_refunds_unused_part() {
    let mut v = setup(false, None);
    exec(&mut v, pay(100), None, T0);
    ctx_with_result(PromiseResult::Successful(b"\"60\"".to_vec()));
    let out = v.on_action_resolved(agent(), "ft_transfer_call".into(), usdc().to_string(), U128(100), U64(T0));
    assert_eq!(out, ExecOutcome::Executed { kind: "ft_transfer_call".into(), amount: U128(100), refunded: U128(40) });
    assert_eq!(v.get_balance(usdc().to_string()).0, 940);
}

#[test]
fn unknown_token_deposits_are_bounced() {
    let mut v = setup(false, None);
    ctx(acc("scam-token.testnet"), 0, T0);
    match v.ft_on_transfer(owner(), U128(5), String::new()) {
        PromiseOrValue::Value(refund) => assert_eq!(refund.0, 5),
        _ => panic!("expected value"),
    }
    assert_eq!(v.get_balance("scam-token.testnet".into()).0, 0);
}

#[test]
fn panic_freezes_agents_drains_balances_and_blocks_execution() {
    let mut v = setup(false, None);
    ctx(guardian_acc(), 0, T0);
    v.trigger_panic();
    assert!(v.is_panicked());
    assert_eq!(v.get_balance(usdc().to_string()).0, 0);
    assert_eq!(reason(exec(&mut v, pay(1), None, T0)), Rejection::VaultPanicked);
}

#[test]
#[should_panic(expected = "only owner or guardian")]
fn agent_cannot_trigger_panic() {
    let mut v = setup(false, None);
    ctx(agent(), 0, T0);
    v.trigger_panic();
}

#[test]
fn preview_reports_without_side_effects() {
    let v = setup(true, None);
    ctx(agent(), 0, T0);
    let p = v.preview(agent(), pay(10));
    assert!(p.allowed && p.requires_approval && p.nonce == 0);
    let p = v.preview(agent(), pay(500));
    assert_eq!(p.reason, Some(Rejection::OverPerTxLimit));
    assert_eq!(v.get_mandate(agent()).unwrap().strikes, 0);
}

#[test]
fn canonical_encoding_is_unambiguous() {
    let a = AgentAction::FtTransfer { token: usdc(), receiver_id: shop(), amount: U128(1), memo: Some("a|1:b".into()) };
    let b = AgentAction::FtTransfer { token: usdc(), receiver_id: shop(), amount: U128(1), memo: Some("a".into()) };
    assert_ne!(a.canonical(), b.canonical());
}

#[test]
#[should_panic(expected = "too many receivers")]
fn mandate_receiver_list_is_capped() {
    let mut v = setup(false, None);
    ctx(owner(), 1, T0);
    let receivers = (0..=MAX_RECEIVERS).map(|i| acc(&format!("r{i}.testnet"))).collect();
    v.set_mandate(
        agent(),
        MandateInput { limits: vec![usdc_limit(1, 1)], allowed_receivers: Some(receivers), expires_at_ns: None, require_approval: false, max_strikes: 0 },
    );
}

#[test]
#[should_panic(expected = "vault token list full")]
fn vault_token_list_is_capped() {
    let mut v = setup(false, None);
    for batch in 0..2 {
        let limits = (0..MAX_LIMITS)
            .map(|i| AssetLimit { asset: format!("t{batch}-{i}.testnet"), per_tx: U128(1), per_day: U128(1) })
            .collect();
        ctx(owner(), 1, T0);
        v.set_mandate(
            acc(&format!("agent{batch}.testnet")),
            MandateInput { limits, allowed_receivers: None, expires_at_ns: None, require_approval: false, max_strikes: 0 },
        );
    }
}

#[test]
fn sync_balance_recovers_untracked_tokens() {
    let mut v = setup(false, None);
    ctx(owner(), 1, T0);
    v.trigger_panic(); // ledger -> 0; the mock never runs promises, so pretend the tokens are still there
    ctx_with_result(PromiseResult::Successful(b"\"1000\"".to_vec()));
    assert_eq!(v.on_sync_balance(usdc()).0, 1000);
    assert_eq!(v.get_balance(usdc().to_string()).0, 1000);
}

#[test]
#[should_panic(expected = "trigger_panic first")]
fn sync_balance_requires_panic_mode() {
    let mut v = setup(false, None);
    ctx(owner(), 1, T0);
    let _ = v.sync_balance(usdc());
}

#[test]
#[should_panic(expected = "only owner")]
fn agent_cannot_sync_balance() {
    let mut v = setup(false, None);
    ctx(owner(), 1, T0);
    v.trigger_panic();
    ctx(agent(), 1, T0);
    let _ = v.sync_balance(usdc());
}
