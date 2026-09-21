//! Bounded offline invites. One mutex makes quota checks and insertion atomic
//! across connections; removal and expiry release capacity in the same store.
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use crate::messages::PendingInviteInfo;
use crate::state::now_ms;

const MAX_PER_TARGET: usize = 20;
const MAX_PER_SENDER: usize = 100;
const MAX_TOTAL: usize = 10_000;
const MAX_INVITE_BYTES: usize = 8192;
const TTL_MS: u64 = 10 * 60 * 1000;

#[derive(Default)]
pub struct PendingInvites {
    invites: Mutex<HashMap<String, Vec<PendingInviteInfo>>>,
}

pub(crate) fn fits_size_limit(invite: &PendingInviteInfo) -> bool {
    serde_json::to_vec(invite).is_ok_and(|json| json.len() <= MAX_INVITE_BYTES)
}

impl PendingInvites {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Vec<PendingInviteInfo>>> {
        self.invites.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn insert(&self, target: &str, invite: PendingInviteInfo) -> Result<(), &'static str> {
        if target.is_empty()
            || target.len() > 256
            || target.chars().any(char::is_control)
            || !fits_size_limit(&invite)
        {
            return Err("Invalid or oversized invite");
        }
        let mut entries = self.lock();
        Self::expire(&mut entries, now_ms());
        if let Some(existing) = entries.get(target) {
            if existing.iter().any(|i| {
                i.session_id == invite.session_id && i.sender_username == invite.sender_username
            }) {
                return Ok(());
            }
            if existing.len() >= MAX_PER_TARGET {
                return Err("Recipient pending invite limit reached");
            }
        }
        let total: usize = entries.values().map(Vec::len).sum();
        if total >= MAX_TOTAL {
            return Err("Relay pending invite limit reached");
        }
        let by_sender = entries
            .values()
            .flatten()
            .filter(|i| i.sender_username == invite.sender_username)
            .count();
        if by_sender >= MAX_PER_SENDER {
            return Err("Sender pending invite limit reached");
        }
        entries.entry(target.to_string()).or_default().push(invite);
        Ok(())
    }

    pub fn take(&self, target: &str) -> Option<Vec<PendingInviteInfo>> {
        let mut entries = self.lock();
        Self::expire(&mut entries, now_ms());
        entries.remove(target)
    }

    pub fn cleanup(&self) {
        Self::expire(&mut self.lock(), now_ms());
    }

    fn expire(entries: &mut HashMap<String, Vec<PendingInviteInfo>>, now: u64) {
        entries.retain(|_, invites| {
            invites.retain(|i| now.saturating_sub(i.sent_at) < TTL_MS);
            !invites.is_empty()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invite(sender: &str, session: usize) -> PendingInviteInfo {
        PendingInviteInfo {
            session_id: session.to_string(),
            media_title: "Movie".into(),
            media_rating_key: "123".into(),
            media_type: "movie".into(),
            sender_username: sender.into(),
            sender_thumb: String::new(),
            sent_at: now_ms(),
            relay_url: "wss://relay.example/ws".into(),
        }
    }

    #[test]
    fn deduplicates_without_extending_expiry_and_caps_recipient() {
        let store = PendingInvites::default();
        let first = invite("host", 0);
        let sent_at = first.sent_at;
        store.insert("guest", first).unwrap();
        let mut duplicate = invite("host", 0);
        duplicate.sent_at += 100;
        store.insert("guest", duplicate).unwrap();
        for n in 1..MAX_PER_TARGET {
            store.insert("guest", invite("host", n)).unwrap();
        }
        assert!(store
            .insert("guest", invite("host", MAX_PER_TARGET))
            .is_err());
        let received = store.take("guest").unwrap();
        assert_eq!(received.len(), MAX_PER_TARGET);
        assert_eq!(received[0].sent_at, sent_at);
        assert!(store.take("guest").is_none());
    }

    #[test]
    fn caps_sender_across_targets_and_releases_capacity_on_delivery() {
        let store = PendingInvites::default();
        for n in 0..MAX_PER_SENDER {
            store
                .insert(&format!("guest{n}"), invite("host", n))
                .unwrap();
        }
        assert!(store.insert("overflow", invite("host", 999)).is_err());
        store.take("guest0").unwrap();
        store.insert("overflow", invite("host", 999)).unwrap();
    }

    #[test]
    fn global_limit_rejects_new_keys_and_expiry_releases_capacity() {
        let store = PendingInvites::default();
        // Seed a full store without quadratic setup; exercise the real insert guard.
        {
            let mut entries = store.lock();
            for n in 0..MAX_TOTAL {
                entries.insert(format!("guest{n}"), vec![invite(&format!("host{n}"), n)]);
            }
        }
        assert!(store.insert("overflow", invite("newhost", 0)).is_err());
        assert!(!store.lock().contains_key("overflow"));
        for invites in store.lock().values_mut() {
            invites[0].sent_at = now_ms() - TTL_MS;
        }
        store.insert("fresh", invite("newhost", 1)).unwrap();
        assert_eq!(store.lock().len(), 1);
        assert!(store.take("guest0").is_none());
    }

    #[test]
    fn rejects_oversized_payloads_and_drops_expired_on_delivery() {
        let store = PendingInvites::default();
        let mut large = invite("host", 0);
        large.media_title = "x".repeat(MAX_INVITE_BYTES);
        assert!(store.insert("guest", large).is_err());
        assert!(store.insert(&"x".repeat(257), invite("host", 1)).is_err());
        let mut expired = invite("host", 2);
        expired.sent_at = now_ms() - TTL_MS;
        store.lock().insert("guest".into(), vec![expired]);
        assert!(store.take("guest").is_none());
        assert!(store.lock().is_empty());
    }

    #[test]
    fn concurrent_senders_cannot_overfill_one_recipient() {
        let store = PendingInvites::default();
        std::thread::scope(|scope| {
            for n in 0..64 {
                let store = &store;
                scope.spawn(move || {
                    let _ = store.insert("guest", invite(&format!("host{n}"), n));
                });
            }
        });
        assert_eq!(store.take("guest").unwrap().len(), MAX_PER_TARGET);
    }
}
