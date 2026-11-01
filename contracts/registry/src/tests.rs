use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const DEPOSIT: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR
const HASH: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn scammer() -> AccountId {
    acc("drainer.testnet")
}

fn ctx(predecessor: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("registry.testnet"))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build());
}

fn setup() -> Registry {
    ctx("owner.testnet", 0);
    Registry::new(acc("owner.testnet"), vec![acc("mod.testnet")], 3, U128(DEPOSIT))
}

fn report(r: &mut Registry, reporter: &str) {
    ctx(reporter, DEPOSIT);
    r.report(scammer(), Category::Drainer, HASH.into(), "https://example.com/evidence.json".into());
}

fn status(r: &Registry) -> Status {
    r.get_status(scammer()).status
}

#[test]
fn one_report_warns_threshold_suspects() {
    let mut r = setup();
    assert_eq!(status(&r), Status::Clean);
    report(&mut r, "alice.testnet");
    assert_eq!(status(&r), Status::Warn);
    report(&mut r, "bob.testnet");
    assert_eq!(status(&r), Status::Warn);
    report(&mut r, "carol.testnet");
    assert_eq!(status(&r), Status::Suspected);
}

#[test]
fn same_reporter_counts_once() {
    let mut r = setup();
    for _ in 0..3 {
        report(&mut r, "alice.testnet");
    }
    let s = r.get_status(scammer());
    assert_eq!((s.status, s.reporters), (Status::Warn, 1));
}

#[test]
#[should_panic(expected = "attach the report deposit")]
fn report_needs_deposit() {
    let mut r = setup();
    ctx("alice.testnet", 1);
    r.report(scammer(), Category::Scam, HASH.into(), "https://x".into());
}

#[test]
#[should_panic(expected = "evidence_hash must be sha256 hex")]
fn report_needs_evidence_hash() {
    let mut r = setup();
    ctx("alice.testnet", DEPOSIT);
    r.report(scammer(), Category::Scam, "not-a-hash".into(), "https://x".into());
}

#[test]
#[should_panic(expected = "cannot report yourself")]
fn cannot_self_report() {
    let mut r = setup();
    ctx("drainer.testnet", DEPOSIT);
    r.report(scammer(), Category::Scam, HASH.into(), "https://x".into());
}

#[test]
fn moderator_block_and_dismiss() {
    let mut r = setup();
    report(&mut r, "alice.testnet");
    ctx("mod.testnet", 0);
    r.moderate_block(scammer(), "confirmed drainer".into());
    let s = r.get_status(scammer());
    assert_eq!(s.status, Status::Blocked);
    assert_eq!(s.reports[0].deposit.0, 0, "honest reporter refunded");

    r.moderate_dismiss(scammer(), "appeal accepted".into());
    assert_eq!(status(&r), Status::Clean);
    assert_eq!(r.get_params().slashed.0, 0, "already-refunded deposits are not slashed");
}

#[test]
fn dismissing_false_reports_slashes_deposits() {
    let mut r = setup();
    report(&mut r, "sybil1.testnet");
    report(&mut r, "sybil2.testnet");
    report(&mut r, "sybil3.testnet");
    assert_eq!(status(&r), Status::Suspected);

    ctx("drainer.testnet", 0);
    r.dispute("these accounts were created today to grief me".into());
    assert!(r.get_status(scammer()).dispute.is_some());

    ctx("mod.testnet", 0);
    r.moderate_dismiss(scammer(), "sybil reports".into());
    assert_eq!(status(&r), Status::Clean);
    assert_eq!(r.get_params().slashed.0, 3 * DEPOSIT);
}

#[test]
fn reporter_can_retract() {
    let mut r = setup();
    report(&mut r, "alice.testnet");
    ctx("alice.testnet", 0);
    r.retract(scammer());
    assert_eq!(status(&r), Status::Clean);
}

#[test]
#[should_panic(expected = "only moderator")]
fn non_moderator_cannot_block() {
    let mut r = setup();
    ctx("alice.testnet", 0);
    r.moderate_block(scammer(), "x".into());
}

#[test]
#[should_panic(expected = "nothing to dispute")]
fn clean_account_cannot_dispute() {
    let mut r = setup();
    ctx("drainer.testnet", 0);
    r.dispute("hi".into());
}

#[test]
fn batch_statuses() {
    let mut r = setup();
    report(&mut r, "alice.testnet");
    let out = r.get_statuses(vec![scammer(), acc("shop.testnet")]);
    assert_eq!(out, vec![(scammer(), Status::Warn), (acc("shop.testnet"), Status::Clean)]);
}

#[test]
fn sybil_swarm_cannot_hard_block() {
    let mut r = setup();
    for i in 0..32 {
        report(&mut r, &format!("bot{i}.testnet"));
    }
    let s = r.get_status(scammer());
    assert_eq!((s.status, s.reporters), (Status::Suspected, 32));
}

#[test]
fn moderator_block_overrides_report_count() {
    let mut r = setup();
    ctx("mod.testnet", 0);
    r.moderate_block(scammer(), "known drainer from incident report".into());
    assert_eq!(status(&r), Status::Blocked);
}
