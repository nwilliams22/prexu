//! Pure debug probe script validation, before any application state is opened.
//! Keep this contract aligned with scripts/hw-probe/driver/contract.py.
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fmt;

pub const MAX_BYTES: usize = 1024 * 1024;
type Result<T> = std::result::Result<T, &'static str>;

// Value's default deserializer silently keeps the last duplicate key. Reject
// duplicates recursively, including in argument objects, before validation.
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct Strict;
        impl<'de> Visitor<'de> for Strict {
            type Value = Unique;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("unique JSON fields")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> std::result::Result<Unique, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| Unique(Value::Number(n)))
                    .ok_or_else(|| E::custom("invalid_number"))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_none<E: de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_unit<E: de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut items = Vec::new();
                while let Some(Unique(value)) = seq.next_element()? {
                    items.push(value);
                }
                Ok(Unique(Value::Array(items)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut fields = Map::new();
                while let Some((key, Unique(value))) = map.next_entry::<String, Unique>()? {
                    if fields.insert(key, value).is_some() {
                        return Err(de::Error::custom("duplicate_field"));
                    }
                }
                Ok(Unique(Value::Object(fields)))
            }
        }
        deserializer.deserialize_any(Strict)
    }
}

fn require(ok: bool, code: &'static str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(code)
    }
}
fn fields(value: &Value, required: &[&str], optional: &[&str]) -> Result<()> {
    let map = value.as_object().ok_or("invalid_fields")?;
    require(
        required.iter().all(|k| map.contains_key(*k))
            && map
                .keys()
                .all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str())),
        "invalid_fields",
    )
}
fn number(value: &Value, min: f64, max: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|n| n.is_finite() && n >= min && n <= max)
}
fn identifier(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 64
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

pub fn parse(raw: &[u8]) -> Result<Value> {
    require(raw.len() <= MAX_BYTES, "input_size")?;
    let Unique(script) = serde_json::from_slice(raw).map_err(|_| "invalid_json")?;
    validate(&script)?;
    Ok(script)
}

fn validate(script: &Value) -> Result<()> {
    fields(
        script,
        &[
            "schema",
            "version",
            "runId",
            "fixture",
            "timeoutMs",
            "steps",
        ],
        &[],
    )?;
    require(
        script["schema"] == "prexu.probe.script" && script["version"].as_u64() == Some(1),
        "invalid_schema",
    )?;
    require(
        identifier(&script["runId"]) && script["fixture"] == "av-cues-v1",
        "invalid_identity",
    )?;
    require(number(&script["timeoutMs"], 1., 900000.), "invalid_timeout")?;
    let steps = script["steps"].as_array().ok_or("invalid_steps")?;
    require(!steps.is_empty() && steps.len() <= 256, "invalid_steps")?;
    let mut seen = HashSet::new();
    let mut active = false;
    let mut paused = false;
    let empty = Value::Object(Map::new());
    for (index, step) in steps.iter().enumerate() {
        fields(step, &["id", "action", "timeoutMs"], &["args"])?;
        require(
            identifier(&step["id"]) && seen.insert(step["id"].as_str().unwrap_or_default()),
            "invalid_step_id",
        )?;
        require(number(&step["timeoutMs"], 1., 120000.), "invalid_timeout")?;
        let args = step.get("args").unwrap_or(&empty);
        let action = step["action"].as_str().ok_or("unsupported_action")?;
        match action {
            "play" => {
                fields(args, &["mediaId"], &[])?;
                require(
                    args["mediaId"] == script["fixture"] && !active,
                    "invalid_sequence",
                )?;
                active = true;
                paused = false;
            }
            "seek" => {
                fields(args, &["positionMs", "toleranceMs"], &[])?;
                require(
                    number(&args["positionMs"], 0., 15000.)
                        && number(&args["toleranceMs"], 0., 2000.),
                    "invalid_args",
                )?;
                require(active, "invalid_sequence")?;
            }
            "pause" | "resume" | "stop" => {
                fields(args, &[], &[])?;
                require(active, "invalid_sequence")?;
                if action == "stop" {
                    active = false;
                } else {
                    require(paused == (action == "resume"), "invalid_sequence")?;
                    paused = action == "pause";
                }
            }
            "selectAudio" | "selectSubtitle" => {
                fields(args, &["trackId"], &[])?;
                let ids: &[u64] = if action == "selectAudio" {
                    &[1, 2]
                } else {
                    &[0, 1]
                };
                require(
                    args["trackId"].as_u64().is_some_and(|id| ids.contains(&id)),
                    "invalid_args",
                )?;
                require(active, "invalid_sequence")?;
            }
            "fullscreen" | "miniPlayer" | "popout" => {
                fields(args, &["enabled"], &[])?;
                require(args["enabled"].is_boolean(), "invalid_args")?;
                require(active, "invalid_sequence")?;
            }
            "wait" => {
                fields(args, &["durationMs"], &[])?;
                require(
                    number(&args["durationMs"], 1., step["timeoutMs"].as_f64().unwrap()),
                    "invalid_args",
                )?;
            }
            "navigate" => {
                fields(args, &["route"], &[])?;
                require(
                    args["route"] == "/" || args["route"] == "/settings",
                    "invalid_args",
                )?;
            }
            "setSetting" => {
                fields(args, &["name", "value"], &[])?;
                require(
                    args["name"] == "volume" && number(&args["value"], 0., 100.),
                    "invalid_args",
                )?;
            }
            "windowMinimize" | "windowRestore" | "quit" => {
                fields(args, &[], &[])?;
                if action == "quit" {
                    require(index == steps.len() - 1 && !active, "invalid_sequence")?;
                }
            }
            _ => return Err("unsupported_action"),
        }
    }
    require(steps.last().unwrap()["action"] == "quit", "missing_quit")
}
