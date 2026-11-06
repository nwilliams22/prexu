//! Ordered, fail-closed marker writer. Only validated observations reach logs.
use serde_json::{json, Value};
use std::io::Write;
use std::time::Instant;

type Result<T> = std::result::Result<T, &'static str>;

#[derive(PartialEq)]
enum Phase {
    Ready,
    Between,
    Step,
    Failed,
    Cleanup,
    Done,
    Broken,
}

pub struct Events<W: Write> {
    script: Value,
    sink: W,
    clock: Instant,
    step_clock: Instant,
    phase: Phase,
    index: usize,
    seq: u64,
    failed: bool,
}

impl<W: Write> Events<W> {
    pub fn new(script: Value, sink: W) -> Result<Self> {
        // Do not allow callers to bypass the preflight validator.
        super::probe_script::parse(&serde_json::to_vec(&script).map_err(|_| "invalid_script")?)
            .map_err(|_| "invalid_script")?;
        Ok(Self {
            script,
            sink,
            clock: Instant::now(),
            step_clock: Instant::now(),
            phase: Phase::Ready,
            index: 0,
            seq: 0,
            failed: false,
        })
    }

    fn emit(&mut self, event: &str, extra: Value) -> Result<()> {
        let mut marker = json!({"schema":"prexu.probe.event", "version":1,
            "runId":self.script["runId"], "seq":self.seq + 1,
            "elapsedMs":self.clock.elapsed().as_millis() as u64, "event":event});
        marker
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let line = serde_json::to_string(&marker).map_err(|_| "marker_io")?;
        // Any partial write or flush failure permanently poisons the writer.
        if writeln!(self.sink, "{line}")
            .and_then(|()| self.sink.flush())
            .is_err()
        {
            self.phase = Phase::Broken;
            return Err("marker_io");
        }
        self.seq += 1;
        log::info!("[probe] {line}");
        Ok(())
    }

    pub fn ready(&mut self) -> Result<Value> {
        if self.phase != Phase::Ready {
            return Err("invalid_sequence");
        }
        self.emit("run.begin", json!({}))?;
        self.phase = Phase::Between;
        Ok(self.script.clone())
    }

    pub fn begin(&mut self, id: &str) -> Result<()> {
        if self.phase != Phase::Between || self.script["steps"][self.index]["id"] != id {
            return Err("invalid_sequence");
        }
        self.deadline()?;
        let step = &self.script["steps"][self.index];
        self.emit(
            "step.begin",
            json!({"stepId":step["id"], "action":step["action"]}),
        )?;
        self.step_clock = Instant::now();
        self.phase = Phase::Step;
        Ok(())
    }

    fn deadline(&self) -> Result<()> {
        if self.clock.elapsed().as_secs_f64() * 1000. > self.script["timeoutMs"].as_f64().unwrap() {
            return Err("step_timeout");
        }
        Ok(())
    }

    pub fn end(&mut self, id: &str, observed: Value) -> Result<()> {
        if self.phase != Phase::Step || self.script["steps"][self.index]["id"] != id {
            return Err("invalid_sequence");
        }
        let step = &self.script["steps"][self.index];
        let check = self.deadline().and_then(|()| {
            if self.step_clock.elapsed().as_secs_f64() * 1000. > step["timeoutMs"].as_f64().unwrap()
            {
                Err("step_timeout")
            } else {
                observation(step, &observed)
            }
        });
        if let Err(code) = check {
            self.fail(code)?;
            return Err(code);
        }
        self.emit(
            "step.end",
            json!({"stepId":step["id"], "action":step["action"], "observed":observed}),
        )?;
        self.index += 1;
        self.phase = Phase::Between;
        Ok(())
    }

    pub fn fail(&mut self, code: &str) -> Result<()> {
        if ![
            "invalid_script",
            "unsupported_action",
            "step_timeout",
            "predicate_failed",
            "player_error",
            "cleanup_failed",
        ]
        .contains(&code)
        {
            return Err("invalid_error");
        }
        if !matches!(self.phase, Phase::Between | Phase::Step) {
            return Err("invalid_sequence");
        }
        let (kind, extra) = if self.phase == Phase::Step {
            let step = &self.script["steps"][self.index];
            (
                "step.error",
                json!({"stepId":step["id"], "action":step["action"], "code":code}),
            )
        } else {
            ("run.error", json!({"code":code}))
        };
        self.emit(kind, extra)?;
        self.failed = true;
        self.phase = Phase::Failed;
        Ok(())
    }

    pub fn cleanup(&mut self) -> Result<()> {
        if self.phase != Phase::Failed
            && !(self.phase == Phase::Between
                && self.index == self.script["steps"].as_array().unwrap().len())
        {
            return Err("invalid_sequence");
        }
        self.emit("cleanup.begin", json!({}))?;
        self.step_clock = Instant::now();
        self.phase = Phase::Cleanup;
        Ok(())
    }

    pub fn finish(&mut self, clean: bool) -> Result<bool> {
        if self.phase != Phase::Cleanup {
            return Err("invalid_sequence");
        }
        if !clean || self.step_clock.elapsed().as_secs() >= 10 {
            self.failed = true;
            self.emit("run.error", json!({"code":"cleanup_failed"}))?;
        } else {
            self.emit("cleanup.end", json!({}))?;
        }
        self.emit(
            "run.end",
            json!({"status":if self.failed {"fail"} else {"pass"}}),
        )?;
        self.phase = Phase::Done;
        Ok(!self.failed)
    }
}

fn number(v: &Value, min: f64, max: f64) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && n >= min && n <= max)
}

pub fn observation(step: &Value, o: &Value) -> Result<()> {
    let args = &step["args"];
    let (keys, ok): (&[&str], bool) = match step["action"].as_str().ok_or("unsupported_action")? {
        "play" => (
            &["loaded", "positionMs"],
            o["loaded"] == true && number(&o["positionMs"], 1., 15000.),
        ),
        "seek" => (
            &["positionMs"],
            number(&o["positionMs"], 0., 17000.)
                && (o["positionMs"].as_f64().unwrap_or(f64::INFINITY)
                    - args["positionMs"].as_f64().unwrap())
                .abs()
                    <= args["toleranceMs"].as_f64().unwrap(),
        ),
        "pause" | "resume" => (&["paused"], o["paused"] == (step["action"] == "pause")),
        "selectAudio" | "selectSubtitle" => (
            &["trackId"],
            o["trackId"].as_u64().is_some() && o["trackId"] == args["trackId"],
        ),
        "fullscreen" | "miniPlayer" | "popout" => (&["enabled"], o["enabled"] == args["enabled"]),
        "windowMinimize" | "windowRestore" => (
            &["minimized"],
            o["minimized"] == (step["action"] == "windowMinimize"),
        ),
        "stop" => (
            &["sessionCleared", "idle"],
            o["sessionCleared"] == true && o["idle"] == true,
        ),
        "wait" => (
            &["durationMs"],
            number(
                &o["durationMs"],
                args["durationMs"].as_f64().unwrap(),
                step["timeoutMs"].as_f64().unwrap(),
            ),
        ),
        "navigate" => (&["route"], o["route"] == args["route"]),
        "setSetting" => (
            &["name", "value"],
            o["name"] == args["name"]
                && number(&o["value"], 0., 100.)
                && o["value"].as_f64() == args["value"].as_f64(),
        ),
        "quit" => (&["ready"], o["ready"] == true),
        _ => return Err("unsupported_action"),
    };
    if !o
        .as_object()
        .is_some_and(|map| map.len() == keys.len() && keys.iter().all(|k| map.contains_key(*k)))
    {
        return Err("predicate_failed");
    }
    if ok {
        Ok(())
    } else {
        Err("predicate_failed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn script() -> Value {
        json!({"schema":"prexu.probe.script","version":1,"runId":"test","fixture":"av-cues-v1","timeoutMs":1000,"steps":[{"id":"quit","action":"quit","timeoutMs":1000}]})
    }

    #[test]
    fn expired_step_fails_and_cleanup_cannot_pass() {
        let mut bytes = Vec::new();
        let mut writer = Events::new(script(), &mut bytes).unwrap();
        writer.ready().unwrap();
        writer.begin("quit").unwrap();
        writer.step_clock = Instant::now() - Duration::from_secs(2);
        assert_eq!(
            writer.end("quit", json!({"ready":true})),
            Err("step_timeout")
        );
        writer.cleanup().unwrap();
        writer.finish(true).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("step_timeout"));
        assert!(!text.contains("step.end"));
        assert!(text.contains("\"status\":\"fail\""));
    }

    #[test]
    fn expired_cleanup_fails() {
        let mut bytes = Vec::new();
        let mut writer = Events::new(script(), &mut bytes).unwrap();
        writer.ready().unwrap();
        writer.begin("quit").unwrap();
        writer.end("quit", json!({"ready":true})).unwrap();
        writer.cleanup().unwrap();
        writer.step_clock = Instant::now() - Duration::from_secs(10);
        writer.finish(true).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("cleanup_failed"));
        assert!(!text.contains("cleanup.end"));
        assert!(text.contains("\"status\":\"fail\""));
    }

    #[test]
    fn flush_failure_is_terminal() {
        struct Unflushed(Vec<u8>);
        impl Write for Unflushed {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.write(buf)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Err(std::io::Error::other("flush failed"))
            }
        }
        let mut writer = Events::new(script(), Unflushed(Vec::new())).unwrap();
        assert_eq!(writer.ready(), Err("marker_io"));
        assert!(writer.ready().is_err());
        assert!(writer.begin("quit").is_err());
        assert!(writer.fail("player_error").is_err());
    }
}
