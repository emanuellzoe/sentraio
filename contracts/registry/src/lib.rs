//! Sentineli registry: a shared, evidence-backed blocklist that Preflight reads
//! as one counterparty signal.
//!
//! Anti-griefing rules: every report needs a deposit and an evidence hash; one
//! reporter only produces `warn`; `block_threshold` distinct reporters produce
//! `suspected`; only a moderator verdict produces `blocked`, so a handful of sybil
//! wallets cannot hard-block a legitimate account. The reported account can
//! dispute; moderators refund honest reporters and slash deposits of dismissed reports.

#[cfg(test)]
mod tests;

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const MAX_REPORTS_PER_TARGET: usize = 32;
const MAX_URL_LEN: usize = 256;
const MAX_NOTE_LEN: usize = 512;
const MAX_BATCH: usize = 50;

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Category {
    Phishing,
    Drainer,
    Honeypot,
    Impersonation,
    Scam,
    Other,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Report {
    pub reporter: AccountId,
    pub category: Category,
    /// sha256 (hex) of the evidence bundle, so the URL content can be checked later.
    pub evidence_hash: String,
    pub evidence_url: String,
    pub created_at_ns: U64,
    /// Held until a moderator confirms (refund) or dismisses (slash), or the reporter retracts.
    pub deposit: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Verdict {
    pub moderator: AccountId,
    pub reason: String,
    pub at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub note: String,
    pub at_ns: U64,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Status {
    Clean,
    /// Reported by fewer than `block_threshold` distinct accounts.
    Warn,
    /// Reported by at least `block_threshold` distinct accounts, not yet confirmed.
    Suspected,
    /// Confirmed by a moderator.
    Blocked,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct StatusView {
    pub account_id: AccountId,
    pub status: Status,
    pub reporters: u32,
    pub verdict: Option<Verdict>,
    pub dispute: Option<Dispute>,
    pub reports: Vec<Report>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Params {
    pub owner_id: AccountId,
    pub block_threshold: u32,
    pub report_deposit: U128,
    pub slashed: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner_id: AccountId,
    moderators: IterableSet<AccountId>,
    reports: LookupMap<AccountId, Vec<Report>>,
    verdicts: LookupMap<AccountId, Verdict>,
    disputes: LookupMap<AccountId, Dispute>,
    block_threshold: u32,
    report_deposit: u128,
    /// Deposits from dismissed reports, withdrawable by the owner.
    slashed: u128,
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner_id: AccountId, moderators: Vec<AccountId>, block_threshold: u32, report_deposit: U128) -> Self {
        require!(block_threshold >= 2, "block_threshold must be at least 2");
        let mut set = IterableSet::new(b"o");
        set.extend(moderators);
        Self {
            owner_id,
            moderators: set,
            reports: LookupMap::new(b"r"),
            verdicts: LookupMap::new(b"v"),
            disputes: LookupMap::new(b"d"),
            block_threshold,
            report_deposit: report_deposit.0,
            slashed: 0,
        }
    }

    // --------------------------------------------------------------- reporters

    /// One report per reporter per target; reporting again replaces the evidence.
    #[payable]
    pub fn report(&mut self, account_id: AccountId, category: Category, evidence_hash: String, evidence_url: String) {
        let reporter = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(reporter != account_id, "cannot report yourself");
        require!(deposit >= self.report_deposit, "attach the report deposit");
        require!(
            evidence_hash.len() == 64 && evidence_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "evidence_hash must be sha256 hex"
        );
        require!(!evidence_url.is_empty() && evidence_url.len() <= MAX_URL_LEN, "evidence_url required (max 256)");

        let mut list = self.reports.get(&account_id).cloned().unwrap_or_default();
        let report = Report {
            reporter: reporter.clone(),
            category,
            evidence_hash,
            evidence_url,
            created_at_ns: U64(env::block_timestamp()),
            deposit: U128(deposit),
        };
        match list.iter_mut().find(|r| r.reporter == reporter) {
            Some(existing) => {
                // keep the larger held deposit; refund the new one to avoid double-holding
                Promise::new(reporter.clone()).transfer(NearToken::from_yoctonear(deposit)).detach();
                let held = existing.deposit;
                *existing = Report { deposit: held, ..report };
            }
            None => {
                require!(list.len() < MAX_REPORTS_PER_TARGET, "report list full for this account");
                list.push(report);
            }
        }
        let reporters = list.len() as u32;
        self.reports.insert(account_id.clone(), list);
        emit("report_filed", json!({ "account_id": account_id, "reporter": reporter, "category": category, "reporters": reporters }));
    }

    pub fn retract(&mut self, account_id: AccountId) {
        let reporter = env::predecessor_account_id();
        let mut list = self.reports.get(&account_id).cloned().unwrap_or_default();
        let idx = list.iter().position(|r| r.reporter == reporter).unwrap_or_else(|| env::panic_str("no report to retract"));
        let removed = list.remove(idx);
        self.store_reports(&account_id, list);
        refund(&removed);
        emit("report_retracted", json!({ "account_id": account_id, "reporter": reporter }));
    }

    // ---------------------------------------------------------- reported party

    /// The reported account states its side; shown next to the evidence.
    pub fn dispute(&mut self, note: String) {
        let account_id = env::predecessor_account_id();
        require!(self.reports.contains_key(&account_id) || self.verdicts.contains_key(&account_id), "nothing to dispute");
        require!(!note.is_empty() && note.len() <= MAX_NOTE_LEN, "note required (max 512)");
        self.disputes.insert(account_id.clone(), Dispute { note, at_ns: U64(env::block_timestamp()) });
        emit("dispute_filed", json!({ "account_id": account_id }));
    }

    // -------------------------------------------------------------- moderators

    /// Confirm the reports: account is blocked and reporters get their deposits back.
    pub fn moderate_block(&mut self, account_id: AccountId, reason: String) {
        let moderator = self.assert_moderator();
        require!(reason.len() <= MAX_NOTE_LEN, "reason too long");
        if let Some(list) = self.reports.get_mut(&account_id) {
            for r in list.iter_mut() {
                refund(r);
                r.deposit = U128(0);
            }
        }
        self.verdicts.insert(account_id.clone(), Verdict { moderator: moderator.clone(), reason: reason.clone(), at_ns: U64(env::block_timestamp()) });
        emit("verdict_blocked", json!({ "account_id": account_id, "moderator": moderator, "reason": reason }));
    }

    /// Reject the reports (or lift a block): evidence removed, held deposits slashed.
    pub fn moderate_dismiss(&mut self, account_id: AccountId, reason: String) {
        let moderator = self.assert_moderator();
        if let Some(list) = self.reports.remove(&account_id) {
            self.slashed += list.iter().map(|r| r.deposit.0).sum::<u128>();
        }
        self.verdicts.remove(&account_id);
        self.disputes.remove(&account_id);
        emit("reports_dismissed", json!({ "account_id": account_id, "moderator": moderator, "reason": reason }));
    }

    // ------------------------------------------------------------------- owner

    #[payable]
    pub fn add_moderator(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.moderators.insert(account_id);
    }

    #[payable]
    pub fn remove_moderator(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.moderators.remove(&account_id);
    }

    #[payable]
    pub fn set_params(&mut self, block_threshold: u32, report_deposit: U128) {
        self.assert_owner();
        require!(block_threshold >= 2, "block_threshold must be at least 2");
        self.block_threshold = block_threshold;
        self.report_deposit = report_deposit.0;
    }

    #[payable]
    pub fn withdraw_slashed(&mut self) -> Promise {
        self.assert_owner();
        let amount = std::mem::take(&mut self.slashed);
        require!(amount > 0, "nothing slashed");
        Promise::new(self.owner_id.clone()).transfer(NearToken::from_yoctonear(amount))
    }

    // ------------------------------------------------------------------- views

    pub fn get_status(&self, account_id: AccountId) -> StatusView {
        let reports = self.reports.get(&account_id).cloned().unwrap_or_default();
        let verdict = self.verdicts.get(&account_id).cloned();
        StatusView {
            status: self.status_of(reports.len() as u32, verdict.is_some()),
            reporters: reports.len() as u32,
            dispute: self.disputes.get(&account_id).cloned(),
            account_id,
            verdict,
            reports,
        }
    }

    /// Compact batch lookup for Preflight: status per account, no evidence payload.
    pub fn get_statuses(&self, account_ids: Vec<AccountId>) -> Vec<(AccountId, Status)> {
        require!(account_ids.len() <= MAX_BATCH, "max 50 accounts per call");
        account_ids
            .into_iter()
            .map(|id| {
                let n = self.reports.get(&id).map_or(0, |l| l.len() as u32);
                let status = self.status_of(n, self.verdicts.contains_key(&id));
                (id, status)
            })
            .collect()
    }

    pub fn get_params(&self) -> Params {
        Params {
            owner_id: self.owner_id.clone(),
            block_threshold: self.block_threshold,
            report_deposit: U128(self.report_deposit),
            slashed: U128(self.slashed),
        }
    }

    pub fn get_moderators(&self) -> Vec<&AccountId> {
        self.moderators.iter().collect()
    }
}

impl Registry {
    fn status_of(&self, reporters: u32, has_verdict: bool) -> Status {
        if has_verdict {
            Status::Blocked
        } else if reporters >= self.block_threshold {
            Status::Suspected
        } else if reporters > 0 {
            Status::Warn
        } else {
            Status::Clean
        }
    }

    fn store_reports(&mut self, account_id: &AccountId, list: Vec<Report>) {
        if list.is_empty() {
            self.reports.remove(account_id);
        } else {
            self.reports.insert(account_id.clone(), list);
        }
    }

    fn assert_owner(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner_id, "only owner");
    }

    fn assert_moderator(&self) -> AccountId {
        let caller = env::predecessor_account_id();
        require!(self.moderators.contains(&caller), "only moderator");
        caller
    }
}

fn refund(r: &Report) {
    if r.deposit.0 > 0 {
        Promise::new(r.reporter.clone()).transfer(NearToken::from_yoctonear(r.deposit.0)).detach();
    }
}

fn emit(event: &str, data: Value) {
    let payload = json!({ "standard": "sentineli-registry", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
